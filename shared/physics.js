// Deterministic movement + hitscan shared by server and client.
// The client runs this for prediction; the server runs it as the authority.

import {
  KEY,
  GRAVITY,
  JUMP_SPEED,
  GROUND_ACCEL,
  AIR_ACCEL,
  GROUND_FRICTION,
  STEP_HEIGHT,
  SPRINT_MULT,
  CROUCH_MULT,
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_EYE,
  PLAYER_CROUCH_EYE,
  HEAD_HEIGHT,
  AIR_SPEED_CAP,
} from './constants.js';

const EPS = 1e-4;

/** Precomputes a broadphase grid over the level boxes. */
export function makeWorld(map) {
  const cell = 8;
  const half = map.half + 4;
  const size = Math.ceil((half * 2) / cell);
  const grid = new Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = [];

  const toCell = (v) => {
    const c = Math.floor((v + half) / cell);
    return c < 0 ? 0 : c >= size ? size - 1 : c;
  };

  map.boxes.forEach((b, index) => {
    const x0 = toCell(b.min[0]);
    const x1 = toCell(b.max[0]);
    const z0 = toCell(b.min[2]);
    const z1 = toCell(b.max[2]);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) grid[cx * size + cz].push(index);
    }
  });

  return { map, boxes: map.boxes, grid, size, cell, half, toCell };
}

/** Box indices possibly overlapping an xz-rectangle. */
function candidates(world, minX, minZ, maxX, maxZ) {
  const { grid, size, toCell } = world;
  const x0 = toCell(minX);
  const x1 = toCell(maxX);
  const z0 = toCell(minZ);
  const z1 = toCell(maxZ);
  if (x0 === x1 && z0 === z1) return grid[x0 * size + z0];
  const out = [];
  const seen = new Set();
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      for (const i of grid[cx * size + cz]) {
        if (!seen.has(i)) {
          seen.add(i);
          out.push(i);
        }
      }
    }
  }
  return out;
}

export function playerHeight(crouching) {
  return crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
}

export function eyeHeight(crouching) {
  return crouching ? PLAYER_CROUCH_EYE : PLAYER_EYE;
}

function overlaps(world, x, y, z, height, out) {
  const minX = x - PLAYER_RADIUS;
  const maxX = x + PLAYER_RADIUS;
  const minZ = z - PLAYER_RADIUS;
  const maxZ = z + PLAYER_RADIUS;
  const minY = y;
  const maxY = y + height;
  const list = candidates(world, minX, minZ, maxX, maxZ);
  let hit = false;
  for (const i of list) {
    const b = world.boxes[i];
    if (
      minX < b.max[0] - EPS &&
      maxX > b.min[0] + EPS &&
      minZ < b.max[2] - EPS &&
      maxZ > b.min[2] + EPS &&
      minY < b.max[1] - EPS &&
      maxY > b.min[1] + EPS
    ) {
      hit = true;
      if (!out) return true;
      out.push(b);
    }
  }
  return hit;
}

export function isBlocked(world, x, y, z, height) {
  return overlaps(world, x, y, z, height, null);
}

/** Highest surface directly under a point, searching down from `fromY`. */
export function groundHeightAt(world, x, z, fromY) {
  const list = candidates(world, x - PLAYER_RADIUS, z - PLAYER_RADIUS, x + PLAYER_RADIUS, z + PLAYER_RADIUS);
  let best = -Infinity;
  for (const i of list) {
    const b = world.boxes[i];
    if (
      x + PLAYER_RADIUS > b.min[0] &&
      x - PLAYER_RADIUS < b.max[0] &&
      z + PLAYER_RADIUS > b.min[2] &&
      z - PLAYER_RADIUS < b.max[2] &&
      b.max[1] <= fromY + EPS &&
      b.max[1] > best
    ) {
      best = b.max[1];
    }
  }
  return best;
}

function accelerate(state, dirX, dirZ, wishSpeed, accel, dt) {
  const current = state.vx * dirX + state.vz * dirZ;
  const add = wishSpeed - current;
  if (add <= 0) return;
  let a = accel * wishSpeed * dt;
  if (a > add) a = add;
  state.vx += dirX * a;
  state.vz += dirZ * a;
}

function applyFriction(state, dt) {
  const speed = Math.hypot(state.vx, state.vz);
  if (speed < 0.05) {
    state.vx = 0;
    state.vz = 0;
    return;
  }
  const drop = Math.max(speed, 2.5) * GROUND_FRICTION * dt;
  const scale = Math.max(0, speed - drop) / speed;
  state.vx *= scale;
  state.vz *= scale;
}

/**
 * Advances one player one fixed step. Mutates `state` and returns info the
 * caller may act on (landing impact for fall damage).
 *
 * state: { x,y,z, vx,vy,vz, onGround, crouching }
 * cmd:   { keys, yaw }
 * mods:  { speed, speedMult }
 */
export function stepPlayer(state, cmd, world, dt, mods = {}) {
  const keys = cmd.keys | 0;
  const baseSpeed = mods.speed || 6;
  const wantCrouch = !!(keys & KEY.CROUCH);

  // Crouch/stand transition — standing up is refused when there is no room.
  if (wantCrouch !== state.crouching) {
    if (wantCrouch) {
      state.crouching = true;
    } else if (!isBlocked(world, state.x, state.y, state.z, PLAYER_HEIGHT)) {
      state.crouching = false;
    }
  }
  const height = playerHeight(state.crouching);

  // Desired direction in world space.
  let fx = 0;
  let fz = 0;
  if (keys & KEY.FORWARD) fz -= 1;
  if (keys & KEY.BACK) fz += 1;
  if (keys & KEY.LEFT) fx -= 1;
  if (keys & KEY.RIGHT) fx += 1;
  const len = Math.hypot(fx, fz);
  let dirX = 0;
  let dirZ = 0;
  if (len > 0) {
    fx /= len;
    fz /= len;
    const sin = Math.sin(cmd.yaw);
    const cos = Math.cos(cmd.yaw);
    // Must match lookDir(): at yaw=0 the view looks down -z, so
    // forward = (-sin, -cos) and right = (cos, -sin). `fz` is -1 for the
    // forward key, hence the sign flip on the fz terms.
    dirX = fx * cos + fz * sin;
    dirZ = fx * -sin + fz * cos;
  }

  let speed = baseSpeed * (mods.speedMult || 1);
  const sprinting = !!(keys & KEY.SPRINT) && !state.crouching && (keys & KEY.FORWARD) && !(keys & KEY.ZOOM);
  if (sprinting) speed *= SPRINT_MULT;
  if (state.crouching) speed *= CROUCH_MULT;
  if (keys & KEY.ZOOM) speed *= 0.55;
  state.speedNow = speed;

  if (state.onGround) {
    applyFriction(state, dt);
    if (len > 0) accelerate(state, dirX, dirZ, speed, GROUND_ACCEL, dt);
    if (keys & KEY.JUMP) {
      state.vy = JUMP_SPEED;
      state.onGround = false;
    }
  } else if (len > 0) {
    accelerate(state, dirX, dirZ, speed, AIR_ACCEL, dt);
  }

  // Accelerating along a turning wish direction can stack speed sideways
  // (classic air-strafing). Cap horizontal speed so movement stays readable
  // and identical on both sides of the wire.
  const cap = speed * (state.onGround ? 1.02 : AIR_SPEED_CAP);
  const horizontal = Math.hypot(state.vx, state.vz);
  if (horizontal > cap) {
    const scale = cap / horizontal;
    state.vx *= scale;
    state.vz *= scale;
  }

  if (!state.onGround) state.vy -= GRAVITY * dt;

  const landed = integrate(state, world, dt, height);
  return landed;
}

function integrate(state, world, dt, height) {
  let landedSpeed = 0;

  // ---- vertical ----
  const dy = state.vy * dt;
  if (dy !== 0) {
    const ny = state.y + dy;
    const hits = [];
    if (overlaps(world, state.x, ny, state.z, height, hits)) {
      if (dy < 0) {
        let top = -Infinity;
        for (const b of hits) if (b.max[1] > top && b.max[1] <= state.y + STEP_HEIGHT + EPS) top = b.max[1];
        if (top === -Infinity) for (const b of hits) top = Math.max(top, b.max[1]);
        state.y = top;
        if (!state.onGround) landedSpeed = -state.vy;
        state.vy = 0;
        state.onGround = true;
      } else {
        let bottom = Infinity;
        for (const b of hits) bottom = Math.min(bottom, b.min[1]);
        state.y = bottom - height - EPS;
        state.vy = 0;
      }
    } else {
      state.y = ny;
      if (dy > 0) state.onGround = false;
    }
  }

  // ---- horizontal, one axis at a time so we slide along walls ----
  moveAxis(state, world, height, state.vx * dt, 0);
  moveAxis(state, world, height, 0, state.vz * dt);

  // ---- ground check ----
  if (state.vy <= 0) {
    const probe = 0.06;
    if (isBlocked(world, state.x, state.y - probe, state.z, probe)) {
      if (!state.onGround) {
        const surface = groundHeightAt(world, state.x, state.z, state.y + EPS);
        if (surface > -Infinity) state.y = surface;
        landedSpeed = Math.max(landedSpeed, -state.vy);
        state.vy = 0;
      }
      state.onGround = true;
    } else {
      state.onGround = false;
    }
  }

  return landedSpeed;
}

function moveAxis(state, world, height, dx, dz) {
  if (dx === 0 && dz === 0) return;
  const nx = state.x + dx;
  const nz = state.z + dz;
  const hits = [];
  if (!overlaps(world, nx, state.y, nz, height, hits)) {
    state.x = nx;
    state.z = nz;
    return;
  }

  // Try to step up onto low obstacles (stairs, crates, curbs).
  let top = -Infinity;
  for (const b of hits) top = Math.max(top, b.max[1]);
  const rise = top - state.y;
  if (rise > 0 && rise <= STEP_HEIGHT && !isBlocked(world, nx, top + EPS, nz, height)) {
    state.x = nx;
    state.z = nz;
    state.y = top + EPS;
    if (state.vy < 0) state.vy = 0;
    state.onGround = true;
    return;
  }

  // Blocked: kill velocity on the blocked axis so we slide instead of sticking.
  if (dx !== 0) state.vx = 0;
  if (dz !== 0) state.vz = 0;
}

/** Direction vector for a yaw/pitch pair. */
export function lookDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Ray versus axis-aligned box. Returns entry distance or -1. */
export function rayBox(ox, oy, oz, dx, dy, dz, min, max, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  let axis = -1;
  let sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < min[i] || o[i] > max[i]) return { t: -1 };
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (min[i] - o[i]) * inv;
    let t2 = (max[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return { t: -1 };
  }
  return { t: tmin, axis, sign };
}

/** First level surface hit by a ray. */
export function traceWorld(world, origin, dir, maxDist) {
  let best = null;
  const boxes = world.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const r = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, b.min, b.max, best ? best.t : maxDist);
    if (r.t >= 0 && (!best || r.t < best.t)) {
      const normal = { x: 0, y: 0, z: 0 };
      if (r.axis === 0) normal.x = r.sign;
      else if (r.axis === 1) normal.y = r.sign;
      else if (r.axis === 2) normal.z = r.sign;
      best = { t: r.t, box: b, normal };
    }
  }
  if (!best) return null;
  return {
    dist: best.t,
    point: {
      x: origin.x + dir.x * best.t,
      y: origin.y + dir.y * best.t,
      z: origin.z + dir.z * best.t,
    },
    normal: best.normal,
    box: best.box,
  };
}

/** Ray versus a player's hit box. Returns { dist, head } or null. */
export function traceEntity(origin, dir, ent, maxDist) {
  const height = playerHeight(ent.crouching);
  const min = [ent.x - PLAYER_RADIUS, ent.y, ent.z - PLAYER_RADIUS];
  const max = [ent.x + PLAYER_RADIUS, ent.y + height, ent.z + PLAYER_RADIUS];
  const r = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, min, max, maxDist);
  if (r.t < 0) return null;
  const hy = origin.y + dir.y * r.t;
  const headLine = ent.y + (ent.crouching ? PLAYER_CROUCH_HEIGHT - 0.3 : HEAD_HEIGHT);
  return {
    dist: r.t,
    head: hy >= headLine,
    point: { x: origin.x + dir.x * r.t, y: hy, z: origin.z + dir.z * r.t },
  };
}

/** True when nothing in the level blocks the segment a->b. */
export function hasLineOfSight(world, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  const hit = traceWorld(world, a, dir, dist);
  return !hit || hit.dist >= dist - 0.05;
}

/** Deterministic spread cone: rotates `dir` by a seeded random offset. */
export function applySpread(dir, spread, rand) {
  if (spread <= 0) return dir;
  const ang = rand() * Math.PI * 2;
  const r = Math.sqrt(rand()) * spread;
  // Build an orthonormal basis around dir.
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(dir.y) > 0.99) {
    ux = 1;
    uy = 0;
  }
  let rx = uy * dir.z - uz * dir.y;
  let ry = uz * dir.x - ux * dir.z;
  let rz = ux * dir.y - uy * dir.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const upx = dir.y * rz - dir.z * ry;
  const upy = dir.z * rx - dir.x * rz;
  const upz = dir.x * ry - dir.y * rx;
  const ox = Math.cos(ang) * r;
  const oy = Math.sin(ang) * r;
  const nx = dir.x + rx * ox + upx * oy;
  const ny = dir.y + ry * ox + upy * oy;
  const nz = dir.z + rz * ox + upz * oy;
  const nl = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / nl, y: ny / nl, z: nz / nl };
}

/** Small deterministic PRNG so client and server can agree on pellet spread. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
