// Server-side bots. A bot is an ordinary player whose commands are produced
// here instead of arriving over a socket, so it goes through exactly the same
// movement, hit detection and scoring code as a human.

import { KEY, PLAYER_EYE } from '../shared/constants.js';
import { traceWorld, hasLineOfSight, eyeHeight } from '../shared/physics.js';

// Points bots roam towards when they have nothing to shoot at.
const POIS = [
  { x: 0, z: 0 },
  { x: 0, z: 14 },
  { x: 0, z: -14 },
  { x: -25, z: 17 },
  { x: 25, z: 17 },
  { x: -25, z: -17 },
  { x: 25, z: -17 },
  { x: -34, z: 0 },
  { x: 34, z: 0 },
  { x: -13, z: 11 },
  { x: 13, z: -11 },
  { x: 0, z: 26 },
  { x: 0, z: -26 },
];

export function createBotBrain(skill = 0.5) {
  return {
    skill,
    seq: 0,
    thinkAt: 0,
    targetId: 0,
    targetLostAt: 0,
    aimYaw: 0,
    aimPitch: 0,
    errYaw: 0,
    errPitch: 0,
    strafe: Math.random() < 0.5 ? -1 : 1,
    strafeUntil: 0,
    jumpUntil: 0,
    nextJumpAt: 0,
    burstUntil: 0,
    holdUntil: 0,
    nextFireAt: 0,
    poi: POIS[Math.floor(Math.random() * POIS.length)],
    poiUntil: 0,
    stuckTicks: 0,
    lastPos: { x: 0, z: 0 },
    avoid: 0,
  };
}

function preferredRange(heroId) {
  switch (heroId) {
    case 'sentinel':
      return 7;
    case 'marksman':
      return 34;
    case 'medic':
      return 12;
    default:
      return 18;
  }
}

/** Rotates a 2D direction by `a` radians. */
function rotate(dx, dz, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

function keysFromDirection(yaw, dx, dz) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const f = dx * fx + dz * fz;
  const r = dx * rx + dz * rz;
  let keys = 0;
  if (f > 0.3) keys |= KEY.FORWARD;
  else if (f < -0.3) keys |= KEY.BACK;
  if (r > 0.3) keys |= KEY.RIGHT;
  else if (r < -0.3) keys |= KEY.LEFT;
  return keys;
}

function pickTarget(bot, room) {
  let best = null;
  let bestScore = -Infinity;
  const eye = { x: bot.x, y: bot.y + eyeHeight(bot.crouching), z: bot.z };
  for (const o of room.players.values()) {
    if (o.id === bot.id || !o.alive || o.team === bot.team) continue;
    const d = Math.hypot(o.x - bot.x, o.z - bot.z);
    if (d > 90) continue;
    const oEye = { x: o.x, y: o.y + PLAYER_EYE * 0.85, z: o.z };
    const visible = hasLineOfSight(room.world, eye, oEye);
    const score = (visible ? 200 : 0) - d;
    if (score > bestScore) {
      bestScore = score;
      best = { player: o, visible, dist: d };
    }
  }
  return best;
}

export function updateBot(bot, room, dt) {
  const brain = bot.brain;
  const now = Date.now();
  const w = bot.hero.weapon;
  const skill = brain.skill;

  let target = brain.targetId ? room.players.get(brain.targetId) : null;
  if (target && (!target.alive || target.team === bot.team)) target = null;

  const eye = { x: bot.x, y: bot.y + eyeHeight(bot.crouching), z: bot.z };
  let visible = false;
  let dist = Infinity;
  if (target) {
    dist = Math.hypot(target.x - bot.x, target.z - bot.z);
    visible = hasLineOfSight(room.world, eye, { x: target.x, y: target.y + PLAYER_EYE * 0.85, z: target.z });
  }

  // ---- periodic decisions ------------------------------------------------
  if (now >= brain.thinkAt) {
    brain.thinkAt = now + 110 + Math.random() * 140;

    const found = pickTarget(bot, room);
    if (found && (!target || found.player.id !== target.id)) {
      const better = !target || !visible || (found.visible && found.dist < dist * 0.7);
      if (better) {
        brain.targetId = found.player.id;
        target = found.player;
        visible = found.visible;
        dist = found.dist;
        // Reaction time before the first shot at a new target.
        brain.nextFireAt = Math.max(brain.nextFireAt, now + 90 + (1 - skill) * 420);
      }
    }
    if (!found) brain.targetId = 0;

    // Fresh aim error, small for good bots.
    const err = (1 - skill) * 0.085 + 0.006;
    brain.errYaw = (Math.random() * 2 - 1) * err;
    brain.errPitch = (Math.random() * 2 - 1) * err * 0.6;

    if (now >= brain.strafeUntil) {
      brain.strafe = Math.random() < 0.5 ? -1 : 1;
      brain.strafeUntil = now + 500 + Math.random() * 900;
    }

    // Re-pick a roam destination when we arrive or time out.
    const distToPoi = Math.hypot(brain.poi.x - bot.x, brain.poi.z - bot.z);
    if (distToPoi < 5 || now >= brain.poiUntil) {
      const enemyMid = enemyCentroid(bot, room);
      const candidates = POIS.filter((p) => Math.hypot(p.x - bot.x, p.z - bot.z) > 12);
      let pick = candidates[Math.floor(Math.random() * candidates.length)] || POIS[0];
      if (enemyMid && Math.random() < 0.6) {
        // Bias towards the fight.
        let bestD = Infinity;
        for (const c of candidates) {
          const d = Math.hypot(c.x - enemyMid.x, c.z - enemyMid.z);
          if (d < bestD) {
            bestD = d;
            pick = c;
          }
        }
      }
      brain.poi = pick;
      brain.poiUntil = now + 9000 + Math.random() * 5000;
    }

    // Stuck detection: alternate the avoidance side, then give up on the
    // destination entirely rather than grinding along a wall.
    const moved = Math.hypot(bot.x - brain.lastPos.x, bot.z - brain.lastPos.z);
    if (moved < 0.35) {
      brain.stuckTicks++;
      brain.avoid = brain.stuckTicks % 2 ? 1 : -1;
      if (now >= brain.nextJumpAt) {
        brain.jumpUntil = now + 220;
        brain.nextJumpAt = now + 800;
      }
      if (brain.stuckTicks >= 3) {
        brain.poi = POIS[Math.floor(Math.random() * POIS.length)];
        brain.poiUntil = now + 8000;
        brain.stuckTicks = 0;
      }
    } else {
      brain.stuckTicks = 0;
      brain.avoid = 0;
    }
    brain.lastPos = { x: bot.x, z: bot.z };

    // Abilities: heal when hurt, shield when engaged, otherwise on cooldown.
    if (now >= bot.abilityReadyAt) {
      const hpFrac = bot.hp / bot.hero.hp;
      const engaged = target && visible && dist < 30;
      if (bot.hero.id === 'medic' && (hpFrac < 0.7 || alliesHurtNearby(bot, room))) room.onAbility(bot);
      else if (bot.hero.id === 'sentinel' && engaged) room.onAbility(bot);
      else if (bot.hero.id === 'ranger' && (engaged || Math.random() < 0.2)) room.onAbility(bot);
      else if (bot.hero.id === 'marksman' && (engaged || Math.random() < 0.15)) room.onAbility(bot);
    }
  }

  // ---- aiming ------------------------------------------------------------
  let desiredYaw = brain.aimYaw;
  let desiredPitch = brain.aimPitch;
  if (target) {
    const aimAt = {
      x: target.x + target.vx * 0.08 * skill,
      y: target.y + (target.crouching ? 0.85 : 1.25) + (skill > 0.7 ? 0.2 : 0),
      z: target.z + target.vz * 0.08 * skill,
    };
    const dx = aimAt.x - eye.x;
    const dy = aimAt.y - eye.y;
    const dz = aimAt.z - eye.z;
    const flat = Math.hypot(dx, dz) || 0.001;
    desiredYaw = Math.atan2(-dx, -dz) + brain.errYaw;
    desiredPitch = Math.atan2(dy, flat) + brain.errPitch;
  } else {
    const dx = brain.poi.x - bot.x;
    const dz = brain.poi.z - bot.z;
    if (Math.hypot(dx, dz) > 0.5) desiredYaw = Math.atan2(-dx, -dz);
    desiredPitch *= 0.9;
  }

  const turnRate = (4 + skill * 9) * (target && visible ? 1.6 : 1);
  brain.aimYaw = approachAngle(brain.aimYaw, desiredYaw, turnRate * dt);
  brain.aimPitch += (desiredPitch - brain.aimPitch) * Math.min(1, turnRate * dt);
  brain.aimPitch = Math.max(-1.2, Math.min(1.2, brain.aimPitch));

  // ---- movement ----------------------------------------------------------
  let moveX;
  let moveZ;
  let sprint = false;
  if (target && visible) {
    const dx = target.x - bot.x;
    const dz = target.z - bot.z;
    const len = Math.hypot(dx, dz) || 1;
    const toward = { x: dx / len, z: dz / len };
    const want = preferredRange(bot.hero.id);
    // Close, hold or back off, plus a constant strafe so bots are not free kills.
    let radial = 0;
    if (dist > want * 1.25) radial = 1;
    else if (dist < want * 0.65) radial = -1;
    const side = rotate(toward.x, toward.z, Math.PI / 2);
    moveX = toward.x * radial + side.x * brain.strafe * 0.9;
    moveZ = toward.z * radial + side.z * brain.strafe * 0.9;
  } else {
    const dx = brain.poi.x - bot.x;
    const dz = brain.poi.z - bot.z;
    const len = Math.hypot(dx, dz) || 1;
    moveX = dx / len;
    moveZ = dz / len;
    sprint = true;
  }

  // Push away from the outer walls so nobody grinds into a corner.
  const edge = room.map.half - 7;
  if (Math.abs(bot.x) > edge) moveX -= Math.sign(bot.x) * 1.1;
  if (Math.abs(bot.z) > edge) moveZ -= Math.sign(bot.z) * 1.1;

  // Obstacle probe: rotate the desired direction until it is clear.
  const probe = { x: bot.x, y: bot.y + 0.9, z: bot.z };
  const moveLen = Math.hypot(moveX, moveZ) || 1;
  let mx = moveX / moveLen;
  let mz = moveZ / moveLen;
  if (brain.avoid) {
    const r = rotate(mx, mz, brain.avoid * 0.9);
    mx = r.x;
    mz = r.z;
  }
  const blocker = probeAhead(room.world, probe, mx, mz);
  if (blocker) {
    const options = [0.6, -0.6, 1.2, -1.2, 2.0, -2.0, 2.6];
    for (const a of options) {
      const r = rotate(mx, mz, a);
      if (clearAhead(room.world, probe, r.x, r.z)) {
        mx = r.x;
        mz = r.z;
        break;
      }
    }
    // Only hop when the obstacle is a low ledge that a jump actually clears —
    // step height handles anything smaller, and walls cannot be jumped at all.
    const rise = blocker.box.max[1] - bot.y;
    if (rise > 0.6 && rise < 1.35 && now >= brain.nextJumpAt) {
      brain.jumpUntil = now + 200;
      brain.nextJumpAt = now + 900;
    }
  }

  let keys = keysFromDirection(brain.aimYaw, mx, mz);
  if (sprint) keys |= KEY.SPRINT;
  if (now < brain.jumpUntil && bot.onGround) keys |= KEY.JUMP;
  if (bot.hero.id === 'marksman' && target && visible && dist > 22) keys |= KEY.ZOOM;

  brain.seq++;
  bot.cmds.push({ seq: brain.seq, keys, yaw: brain.aimYaw, pitch: brain.aimPitch });

  // ---- shooting ----------------------------------------------------------
  if (bot.ammo <= 0) {
    room.onReload(bot);
    return;
  }
  if (!target || !visible || bot.reloadEndsAt) return;
  if (dist > w.range * 0.9) return;
  if (now < brain.nextFireAt || now < brain.holdUntil) return;

  // Only shoot when actually pointing at the target.
  const dx = target.x - eye.x;
  const dz = target.z - eye.z;
  const wantYaw = Math.atan2(-dx, -dz);
  if (Math.abs(angleDelta(brain.aimYaw, wantYaw)) > 0.09 + (1 - skill) * 0.06) return;

  const zoomed = (keys & KEY.ZOOM) !== 0;
  room.onFire(bot, {
    d: dirFrom(brain.aimYaw, brain.aimPitch),
    sd: (Math.random() * 0xffff) | 0,
    rt: now,
    z: zoomed ? 1 : 0,
  });
  brain.nextFireAt = now + w.interval;

  // Burst discipline for automatics so they are beatable.
  if (w.kind === 'auto') {
    if (now > brain.burstUntil) {
      brain.burstUntil = now + 350 + skill * 500;
      brain.holdUntil = 0;
    } else if (now > brain.burstUntil - 40) {
      brain.holdUntil = now + 220 + (1 - skill) * 420;
      brain.burstUntil = 0;
    }
  }
}

function dirFrom(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

function probeAhead(world, origin, dx, dz, dist = 2.2) {
  const len = Math.hypot(dx, dz) || 1;
  return traceWorld(world, origin, { x: dx / len, y: 0, z: dz / len }, dist);
}

function clearAhead(world, origin, dx, dz, dist = 2.2) {
  return !probeAhead(world, origin, dx, dz, dist);
}

function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function approachAngle(from, to, maxStep) {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

function enemyCentroid(bot, room) {
  let n = 0;
  let x = 0;
  let z = 0;
  for (const o of room.players.values()) {
    if (o.team === bot.team || !o.alive) continue;
    x += o.x;
    z += o.z;
    n++;
  }
  return n ? { x: x / n, z: z / n } : null;
}

function alliesHurtNearby(bot, room) {
  for (const o of room.players.values()) {
    if (o.team !== bot.team || !o.alive || o.id === bot.id) continue;
    if (o.hp < o.hero.hp * 0.65 && Math.hypot(o.x - bot.x, o.z - bot.z) < bot.hero.ability.radius) return true;
  }
  return false;
}
