// Authoritative game room. Runs a fixed 60Hz simulation, applies client
// commands, resolves hitscan with lag compensation and broadcasts snapshots.

import {
  TICK_RATE,
  TICK_DT,
  SNAPSHOT_RATE,
  MAX_REWIND_MS,
  HISTORY_MS,
  MATCH_DURATION_MS,
  SCORE_LIMIT,
  RESPAWN_MS,
  WARMUP_MS,
  POST_MATCH_MS,
  MIN_PLAYERS,
  ROOM_SIZE_MIN,
  ROOM_SIZE_MAX,
  ROOM_SIZE_DEFAULT,
  MSG,
  EV,
  KEY,
  MOVE_UNIT,
  MATCH_STATE,
  TEAMS,
  FALL_DAMAGE_SPEED,
  FALL_DAMAGE_PER_SPEED,
  PLAYER_HEIGHT,
} from '../shared/constants.js';
import { buildMap } from '../shared/map.js';
import { getHero, rangeFalloff, HEROES } from '../shared/heroes.js';
import {
  makeWorld,
  stepPlayer,
  traceWorld,
  traceEntity,
  applySpread,
  mulberry32,
  eyeHeight,
  isBlocked,
} from '../shared/physics.js';
import { createBotBrain, updateBot } from './bot.js';

const SPAWN_INVULN_MS = 1200;
const MAX_QUEUED_COMMANDS = 12;

let nextPlayerId = 1;

export class Room {
  constructor(name, opts = {}) {
    this.name = name;
    this.map = buildMap();
    this.world = makeWorld(this.map);
    this.players = new Map();
    this.tick = 0;
    this.events = [];
    this.scores = [0, 0];
    this.state = MATCH_STATE.WAITING;
    this.stateEndsAt = 0;
    this.size = clampRoomSize(opts.size);
    this.startedEarly = false;
    this.botTarget = opts.bots ?? 0;
    this.lastBotCheck = 0;
    this.rosterDirty = true;
    this.snapAccumulator = 0;
    this.interval = setInterval(() => this.update(), 1000 / TICK_RATE);
  }

  get humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  get count() {
    return this.players.size;
  }

  destroy() {
    clearInterval(this.interval);
  }

  // ---------------------------------------------------------------- players

  pickTeam() {
    const counts = [0, 0];
    for (const p of this.players.values()) counts[p.team]++;
    if (counts[0] === counts[1]) return Math.random() < 0.5 ? 0 : 1;
    return counts[0] < counts[1] ? 0 : 1;
  }

  addPlayer({ name, heroId, socket, bot = false, team = null, skill = 0.5 }) {
    const hero = getHero(heroId);
    const id = nextPlayerId++;
    const p = {
      id,
      name,
      bot,
      socket,
      team: team === null ? this.pickTeam() : team,
      heroId: hero.id,
      hero,
      pendingHero: null,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: false,
      crouching: false,
      yaw: 0,
      pitch: 0,
      hp: hero.hp,
      alive: false,
      // Join spawns happen on the very next tick; only deaths get a delay.
      respawnAt: 0,
      autoSpawnAt: 0,
      invulnUntil: 0,
      ammo: hero.weapon.mag,
      reloadEndsAt: 0,
      lastShotAt: 0,
      spread: hero.weapon.spread,
      abilityReadyAt: 0,
      abilityUntil: 0,
      kills: 0,
      deaths: 0,
      damage: 0,
      streak: 0,
      cmds: [],
      lastCmd: { seq: 0, keys: 0, yaw: 0, pitch: 0 },
      ackSeq: 0,
      history: [],
      ping: 0,
      lastDamageFrom: null,
      brain: bot ? createBotBrain(skill) : null,
    };
    this.players.set(id, p);
    this.rosterDirty = true;
    return p;
  }

  removePlayer(id) {
    if (this.players.delete(id)) this.rosterDirty = true;
  }

  syncBots() {
    const now = Date.now();
    if (now - this.lastBotCheck < 1500) return;
    this.lastBotCheck = now;

    const humans = this.humanCount;
    let bots = this.count - humans;
    const want = Math.max(0, Math.min(this.botTarget, this.size - humans));

    while (bots < want) {
      const heroIds = Object.keys(HEROES);
      this.addPlayer({
        name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + '-' + Math.floor(Math.random() * 90 + 10),
        heroId: heroIds[Math.floor(Math.random() * heroIds.length)],
        socket: null,
        bot: true,
        skill: 0.35 + Math.random() * 0.5,
      });
      bots++;
    }
    while (bots > want) {
      for (const p of this.players.values()) {
        if (p.bot) {
          this.removePlayer(p.id);
          bots--;
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------- spawning

  spawnPoint(team) {
    const list = this.map.spawns[team];
    let best = null;
    let bestScore = -Infinity;
    for (const s of list) {
      let nearestEnemy = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive || p.team === team) continue;
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < nearestEnemy) nearestEnemy = d;
      }
      const score = Math.min(nearestEnemy, 60) + Math.random() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best || list[0];
  }

  respawn(p) {
    if (p.pendingHero && HEROES[p.pendingHero]) {
      p.heroId = p.pendingHero;
      p.hero = getHero(p.pendingHero);
      p.pendingHero = null;
      this.rosterDirty = true;
    }
    const s = this.spawnPoint(p.team);
    p.x = s.x + (Math.random() - 0.5) * 1.5;
    p.z = s.z + (Math.random() - 0.5) * 1.5;
    p.y = 0.2;
    // Nudge up if the spawn pad is somehow occupied by geometry.
    let guard = 0;
    while (isBlocked(this.world, p.x, p.y, p.z, PLAYER_HEIGHT) && guard++ < 20) p.y += 0.5;
    p.vx = p.vy = p.vz = 0;
    p.onGround = false;
    p.crouching = false;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.hp = p.hero.hp;
    p.alive = true;
    p.ammo = p.hero.weapon.mag;
    p.reloadEndsAt = 0;
    p.spread = p.hero.weapon.spread;
    p.abilityUntil = 0;
    p.abilityReadyAt = Date.now() + 1500;
    p.invulnUntil = Date.now() + SPAWN_INVULN_MS;
    p.history.length = 0;
    p.lastCmd = { seq: p.lastCmd.seq, keys: 0, yaw: s.yaw, pitch: 0 };
    p.cmds.length = 0;
    this.pushEvent({ e: EV.SPAWN, id: p.id, x: p.x, y: p.y, z: p.z, team: p.team });
  }

  // ------------------------------------------------------------- messaging

  pushEvent(ev) {
    this.events.push(ev);
  }

  send(p, obj) {
    if (!p.socket || p.socket.readyState !== 1) return;
    try {
      p.socket.send(JSON.stringify(obj));
    } catch {
      /* socket died mid-send; the close handler will clean up */
    }
  }

  broadcast(obj) {
    const raw = JSON.stringify(obj);
    for (const p of this.players.values()) {
      if (!p.socket || p.socket.readyState !== 1) continue;
      try {
        p.socket.send(raw);
      } catch {
        /* ignore */
      }
    }
  }

  roster() {
    const list = [];
    for (const p of this.players.values()) {
      list.push({
        id: p.id,
        name: p.name,
        team: p.team,
        hero: p.heroId,
        k: p.kills,
        d: p.deaths,
        dmg: Math.round(p.damage),
        bot: p.bot ? 1 : 0,
        ping: p.ping,
      });
    }
    return list;
  }

  matchInfo() {
    return {
      t: MSG.MATCH,
      state: this.state,
      scores: this.scores,
      endsIn: Math.max(0, this.stateEndsAt - Date.now()),
      limit: SCORE_LIMIT,
      map: this.map.name,
      humans: this.humanCount,
      need: this.size,
      canStart: this.canStartEarly ? 1 : 0,
      roster: this.roster(),
    };
  }

  // ------------------------------------------------------------ client input

  onCommands(p, cmds) {
    if (!Array.isArray(cmds)) return;
    for (const c of cmds) {
      if (!Array.isArray(c) || c.length < 4) continue;
      const seq = c[0] | 0;
      if (seq <= p.lastCmd.seq && p.cmds.length === 0) continue;
      p.cmds.push({
        seq,
        keys: c[1] | 0,
        yaw: clampNum(c[2]),
        pitch: Math.max(-1.54, Math.min(1.54, clampNum(c[3]))),
        // Optional analog stick from touch controls, clamped to the same
        // integer range the client quantised to.
        mx: clampUnit(c[4]),
        mz: clampUnit(c[5]),
      });
    }
    if (p.cmds.length > MAX_QUEUED_COMMANDS) {
      p.cmds.splice(0, p.cmds.length - MAX_QUEUED_COMMANDS);
    }
  }

  onReload(p) {
    const w = p.hero.weapon;
    if (!p.alive || p.reloadEndsAt || p.ammo >= w.mag) return;
    const surge = p.hero.id === 'ranger' && p.abilityUntil > Date.now() ? 0.6 : 1;
    p.reloadEndsAt = Date.now() + w.reload * surge;
    this.pushEvent({ e: EV.RELOAD, id: p.id });
  }

  onAbility(p) {
    const now = Date.now();
    if (!p.alive || now < p.abilityReadyAt) return;
    const a = p.hero.ability;
    p.abilityReadyAt = now + a.cooldown;
    p.abilityUntil = now + (a.duration || 0);

    if (p.hero.id === 'medic') {
      const healed = [];
      for (const o of this.players.values()) {
        if (!o.alive || o.team !== p.team) continue;
        if (Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z) > a.radius) continue;
        const before = o.hp;
        o.hp = Math.min(o.hero.hp, o.hp + a.heal);
        if (o.hp > before) healed.push([o.id, Math.round(o.hp - before)]);
      }
      this.pushEvent({ e: EV.HEAL, id: p.id, x: p.x, y: p.y, z: p.z, r: a.radius, targets: healed });
    }

    this.pushEvent({
      e: EV.ABILITY,
      id: p.id,
      hero: p.hero.id,
      team: p.team,
      until: p.abilityUntil,
      x: p.x,
      y: p.y,
      z: p.z,
    });
  }

  onRespawnRequest(p, heroId) {
    if (heroId && HEROES[heroId]) p.pendingHero = heroId;
    if (!p.alive && Date.now() >= p.respawnAt) this.respawn(p);
  }

  onChat(p, text) {
    const msg = String(text || '').slice(0, 120).trim();
    if (!msg) return;
    this.pushEvent({ e: EV.CHAT, id: p.id, name: p.name, team: p.team, msg });
  }

  // ----------------------------------------------------------------- combat

  /** Interpolated position of a player `ms` milliseconds ago. */
  rewound(p, ms) {
    if (ms <= 0 || p.history.length === 0) {
      return { x: p.x, y: p.y, z: p.z, crouching: p.crouching };
    }
    const target = Date.now() - ms;
    const h = p.history;
    if (target <= h[0].t) return h[0];
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].t <= target) {
        const a = h[i];
        const b = h[i + 1] || { ...a, t: a.t + 1 };
        const span = b.t - a.t || 1;
        const f = Math.max(0, Math.min(1, (target - a.t) / span));
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
          crouching: a.crouching,
        };
      }
    }
    return { x: p.x, y: p.y, z: p.z, crouching: p.crouching };
  }

  onFire(p, msg) {
    const now = Date.now();
    const w = p.hero.weapon;
    if (!p.alive) return;
    if (p.reloadEndsAt) return;
    if (p.ammo <= 0) {
      this.onReload(p);
      return;
    }
    // Rate limit with a small tolerance for jitter.
    if (now - p.lastShotAt < w.interval * 0.88) return;

    const dir = normalize(msg.d);
    if (!dir) return;

    p.lastShotAt = now;
    p.ammo--;
    p.invulnUntil = 0;

    const zoomed = !!msg.z;
    const seed = ((msg.sd | 0) ^ (p.id * 2654435761)) >>> 0;
    const rand = mulberry32(seed);
    const rewind = Math.max(0, Math.min(MAX_REWIND_MS, now - (Number(msg.rt) || now)));

    // Snapshot enemy positions once, rewound to what the shooter could see.
    const targets = [];
    for (const o of this.players.values()) {
      if (o.id === p.id || !o.alive || o.team === p.team) continue;
      if (now < o.invulnUntil) continue;
      const pos = this.rewound(o, rewind);
      targets.push({ player: o, x: pos.x, y: pos.y, z: pos.z, crouching: pos.crouching });
    }

    const eye = { x: p.x, y: p.y + eyeHeight(p.crouching), z: p.z };
    const baseSpread = zoomed && w.zoomSpread !== undefined ? w.zoomSpread : p.spread;
    const tracers = [];
    const damageByTarget = new Map();

    for (let pellet = 0; pellet < (w.pellets || 1); pellet++) {
      const spread = w.pellets > 1 ? w.spread : baseSpread;
      const d = applySpread(dir, spread, rand);
      const wallHit = traceWorld(this.world, eye, d, w.range);
      let bestDist = wallHit ? wallHit.dist : w.range;
      let victim = null;
      let head = false;
      let point = wallHit ? wallHit.point : addScaled(eye, d, w.range);

      for (const t of targets) {
        const hit = traceEntity(eye, d, t, bestDist);
        if (hit && hit.dist < bestDist) {
          bestDist = hit.dist;
          victim = t.player;
          head = hit.head;
          point = hit.point;
        }
      }

      tracers.push([round2(point.x), round2(point.y), round2(point.z), victim ? 1 : 0]);

      if (victim) {
        let dmg = w.damage * rangeFalloff(w, bestDist);
        if (head) dmg *= w.headMult;
        const acc = damageByTarget.get(victim) || { dmg: 0, head: false };
        acc.dmg += dmg;
        acc.head = acc.head || head;
        damageByTarget.set(victim, acc);
      } else if (wallHit) {
        this.pushEvent({
          e: EV.HIT,
          by: p.id,
          x: round2(point.x),
          y: round2(point.y),
          z: round2(point.z),
          nx: wallHit.normal.x,
          ny: wallHit.normal.y,
          nz: wallHit.normal.z,
          surf: wallHit.box.kind,
        });
      }
    }

    // Bloom for the next shot.
    p.spread = Math.min(w.spreadMax ?? w.spread, p.spread + (w.spreadPerShot || 0));

    this.pushEvent({
      e: EV.SHOT,
      id: p.id,
      hero: p.hero.id,
      x: round2(eye.x),
      y: round2(eye.y),
      z: round2(eye.z),
      tr: tracers,
      z2: zoomed ? 1 : 0,
    });

    let totalDealt = 0;
    let anyHead = false;
    let killed = false;
    for (const [victim, acc] of damageByTarget) {
      const wasAlive = victim.alive;
      totalDealt += this.applyDamage(victim, p, acc.dmg, acc.head, w.name);
      anyHead = anyHead || acc.head;
      if (wasAlive && !victim.alive) killed = true;
    }
    if (totalDealt > 0 && p.socket) {
      this.send(p, {
        t: MSG.EVENTS,
        ev: [{ e: 'confirm', dmg: Math.round(totalDealt), head: anyHead ? 1 : 0, kill: killed ? 1 : 0 }],
      });
    }
  }

  /** Returns the damage actually applied (after shields / overkill clamp). */
  applyDamage(victim, attacker, amount, head, weaponName) {
    const now = Date.now();
    if (!victim.alive || now < victim.invulnUntil) return 0;

    let dmg = amount;
    let shielded = false;
    if (victim.hero.id === 'sentinel' && victim.abilityUntil > now) {
      dmg *= 0.45;
      shielded = true;
    }
    dmg = Math.min(dmg, victim.hp);
    victim.hp -= dmg;
    if (attacker && attacker.id !== victim.id) {
      attacker.damage += dmg;
      victim.lastDamageFrom = attacker.id;
    }

    if (victim.socket) {
      this.send(victim, {
        t: MSG.EVENTS,
        ev: [
          {
            e: EV.DAMAGE,
            dmg: Math.round(dmg),
            hp: Math.round(victim.hp),
            from: attacker ? attacker.id : 0,
            fx: attacker ? round2(attacker.x) : 0,
            fy: attacker ? round2(attacker.y) : 0,
            fz: attacker ? round2(attacker.z) : 0,
            sh: shielded ? 1 : 0,
          },
        ],
      });
    }

    if (victim.hp <= 0) this.kill(victim, attacker, head, weaponName);
    return dmg;
  }

  kill(victim, attacker, head, weaponName) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = Date.now() + RESPAWN_MS;
    // Humans get an extra moment on the death screen to switch hero; bots and
    // the manual respawn button are not held back by it.
    victim.autoSpawnAt = victim.respawnAt + (victim.bot ? 0 : 1200);
    victim.abilityUntil = 0;

    const selfKill = !attacker || attacker.id === victim.id;
    if (!selfKill) {
      attacker.kills++;
      attacker.streak++;
      if (this.state === MATCH_STATE.LIVE) this.scores[attacker.team]++;
    }

    this.pushEvent({
      e: EV.KILL,
      killer: selfKill ? 0 : attacker.id,
      killerName: selfKill ? '' : attacker.name,
      killerTeam: selfKill ? victim.team : attacker.team,
      killerHero: selfKill ? '' : attacker.hero.id,
      victim: victim.id,
      victimName: victim.name,
      victimTeam: victim.team,
      head: head ? 1 : 0,
      weapon: weaponName || '',
      streak: selfKill ? 0 : attacker.streak,
      x: round2(victim.x),
      y: round2(victim.y),
      z: round2(victim.z),
    });
    this.rosterDirty = true;

    if (this.state === MATCH_STATE.LIVE && this.scores.some((s) => s >= SCORE_LIMIT)) {
      this.endMatch();
    }
  }

  // ------------------------------------------------------------- match flow

  endMatch() {
    this.state = MATCH_STATE.OVER;
    this.stateEndsAt = Date.now() + POST_MATCH_MS;
    this.broadcast(this.matchInfo());
  }

  /** Wipes the scoreboard and puts everyone back at spawn for a fresh match. */
  resetMatch() {
    this.scores = [0, 0];
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.damage = 0;
      p.streak = 0;
      p.alive = false;
      p.respawnAt = Date.now() + 500;
      p.autoSpawnAt = p.respawnAt;
    }
    this.rosterDirty = true;
  }

  setState(state, durationMs) {
    // Falling back to waiting retires the early-start decision: the next match
    // has to be started deliberately again.
    if (state === MATCH_STATE.WAITING) this.startedEarly = false;
    this.state = state;
    this.stateEndsAt = Date.now() + durationMs;
    this.rosterDirty = true;
    this.broadcast(this.matchInfo());
  }

  /**
   * A match runs once the room is full. Players who do not want to wait for
   * the last seat can start early, as long as there are at least two of them.
   */
  get canPlay() {
    if (this.count >= this.size) return true;
    return this.startedEarly && this.count >= MIN_PLAYERS;
  }

  /** Can the people currently in the room choose to start without waiting? */
  get canStartEarly() {
    return this.state === MATCH_STATE.WAITING && this.count >= MIN_PLAYERS && this.count < this.size;
  }

  onStartRequest(p) {
    if (!this.canStartEarly) return;
    this.startedEarly = true;
    this.pushEvent({ e: EV.CHAT, id: 0, name: '', team: p.team, msg: `${p.name} 님이 경기를 시작했습니다`, system: 1 });
  }

  /**
   * A match only runs with real opponents in the room. On your own you can
   * still spawn and move around, but nothing is scored — the room sits in
   * WAITING until someone else joins, and drops back there if they leave.
   */
  updateMatchState() {
    const now = Date.now();
    const ready = this.canPlay;

    switch (this.state) {
      case MATCH_STATE.WAITING:
        if (ready) {
          this.resetMatch();
          this.setState(MATCH_STATE.WARMUP, WARMUP_MS);
        }
        break;

      case MATCH_STATE.WARMUP:
        if (!ready) this.setState(MATCH_STATE.WAITING, 0);
        else if (now >= this.stateEndsAt) {
          this.resetMatch();
          this.setState(MATCH_STATE.LIVE, MATCH_DURATION_MS);
        }
        break;

      case MATCH_STATE.LIVE:
        // The last opponent leaving abandons the match rather than handing out
        // a win against nobody.
        if (!ready) this.setState(MATCH_STATE.WAITING, 0);
        else if (now >= this.stateEndsAt) this.endMatch();
        break;

      case MATCH_STATE.OVER:
        if (now >= this.stateEndsAt) {
          this.resetMatch();
          this.setState(ready ? MATCH_STATE.WARMUP : MATCH_STATE.WAITING, ready ? WARMUP_MS : 0);
        }
        break;

      default:
        this.setState(MATCH_STATE.WAITING, 0);
        break;
    }
  }

  // ------------------------------------------------------------------ tick

  update() {
    const now = Date.now();
    const dt = TICK_DT;
    this.tick++;
    this.updateMatchState();
    this.syncBots();

    for (const p of this.players.values()) {
      // Reload completion.
      if (p.reloadEndsAt && now >= p.reloadEndsAt) {
        p.ammo = p.hero.weapon.mag;
        p.reloadEndsAt = 0;
        p.spread = p.hero.weapon.spread;
      }
      // Spread recovery.
      const w = p.hero.weapon;
      if (p.spread > w.spread) {
        p.spread = Math.max(w.spread, p.spread - (w.spreadMax - w.spread) * dt * 1.6);
      }

      if (!p.alive) {
        if (now >= p.autoSpawnAt) this.respawn(p);
        continue;
      }

      if (p.bot) updateBot(p, this, dt);

      // Consume queued commands. Draining slightly faster than one per tick
      // keeps latency low when a client's packets arrive bunched up.
      const toRun = p.cmds.length > 4 ? 2 : 1;
      for (let i = 0; i < toRun; i++) {
        const cmd = p.cmds.shift();
        let active;
        if (cmd) {
          p.lastCmd = cmd;
          p.ackSeq = cmd.seq;
          active = cmd;
        } else {
          // No fresh input: repeat the last one but never re-trigger a jump.
          active = { ...p.lastCmd, keys: p.lastCmd.keys & ~KEY.JUMP };
        }
        p.yaw = active.yaw;
        p.pitch = active.pitch;
        const landed = stepPlayer(p, active, this.world, dt, {
          speed: p.hero.speed,
          speedMult: p.hero.id === 'ranger' && p.abilityUntil > now ? 1.28 : 1,
        });
        if (landed > FALL_DAMAGE_SPEED) {
          this.applyDamage(p, null, (landed - FALL_DAMAGE_SPEED) * FALL_DAMAGE_PER_SPEED, false, 'GRAVITY');
        }
        if (!p.alive) break;
      }

      // Out-of-bounds safety net.
      if (p.y < -12) this.applyDamage(p, null, 9999, false, 'THE VOID');

      p.history.push({ t: now, x: p.x, y: p.y, z: p.z, crouching: p.crouching });
      while (p.history.length > 2 && now - p.history[0].t > HISTORY_MS) p.history.shift();
    }

    // Snapshots at a lower rate than the simulation.
    this.snapAccumulator += 1;
    if (this.snapAccumulator >= TICK_RATE / SNAPSHOT_RATE) {
      this.snapAccumulator = 0;
      this.sendSnapshots();
      this.events.length = 0;
    }

    if (this.rosterDirty && this.tick % 12 === 0) {
      this.rosterDirty = false;
      this.broadcast(this.matchInfo());
    }
  }

  sendSnapshots() {
    const now = Date.now();
    const packed = [];
    for (const p of this.players.values()) {
      let flags = 0;
      if (p.alive) flags |= 1;
      if (p.crouching) flags |= 2;
      if (Math.hypot(p.vx, p.vz) > 1.2) flags |= 4;
      if (p.abilityUntil > now) flags |= 8;
      if ((p.lastCmd.keys & KEY.SPRINT) && (p.lastCmd.keys & KEY.FORWARD)) flags |= 16;
      if (p.lastCmd.keys & KEY.ZOOM) flags |= 32;
      packed.push([
        p.id,
        round2(p.x),
        round2(p.y),
        round2(p.z),
        round3(p.yaw),
        round3(p.pitch),
        flags,
        Math.round(p.hp),
        p.hero.hp,
        p.team,
      ]);
    }

    // Team-wide reveal from the marksman ability.
    const revealed = [false, false];
    for (const p of this.players.values()) {
      if (p.hero.id === 'marksman' && p.abilityUntil > now && p.alive) revealed[p.team] = true;
    }

    for (const p of this.players.values()) {
      if (!p.socket) continue;
      const others = packed.filter((row) => row[0] !== p.id);
      this.send(p, {
        t: MSG.SNAPSHOT,
        k: this.tick,
        ts: now,
        ack: p.ackSeq,
        rev: revealed[p.team] ? 1 : 0,
        me: {
          x: p.x,
          y: p.y,
          z: p.z,
          vx: p.vx,
          vy: p.vy,
          vz: p.vz,
          g: p.onGround ? 1 : 0,
          c: p.crouching ? 1 : 0,
          hp: Math.round(p.hp),
          mhp: p.hero.hp,
          am: p.ammo,
          mag: p.hero.weapon.mag,
          rl: p.reloadEndsAt ? Math.max(0, p.reloadEndsAt - now) : 0,
          ab: Math.max(0, p.abilityReadyAt - now),
          abu: Math.max(0, p.abilityUntil - now),
          al: p.alive ? 1 : 0,
          rs: p.alive ? 0 : Math.max(0, p.respawnAt - now),
          sp: p.spread,
          inv: now < p.invulnUntil ? 1 : 0,
          hero: p.heroId,
        },
        ps: others,
        ev: this.events,
      });
    }
  }
}

function clampRoomSize(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return ROOM_SIZE_DEFAULT;
  return Math.max(ROOM_SIZE_MIN, Math.min(ROOM_SIZE_MAX, n));
}

function clampUnit(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MOVE_UNIT, Math.min(MOVE_UNIT, n));
}

function clampNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalize(d) {
  if (!d || typeof d !== 'object') return null;
  const x = clampNum(d.x);
  const y = clampNum(d.y);
  const z = clampNum(d.z);
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return null;
  return { x: x / len, y: y / len, z: z / len };
}

function addScaled(o, d, s) {
  return { x: o.x + d.x * s, y: o.y + d.y * s, z: o.z + d.z * s };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

export const BOT_NAMES = [
  'VIPER', 'ECHO', 'RAZOR', 'NOVA', 'ZEPHYR', 'ONYX', 'BLITZ', 'KILO',
  'TALON', 'HAVOC', 'DRIFT', 'CINDER', 'ORACLE', 'VANTA', 'RIFT', 'SABLE',
];
