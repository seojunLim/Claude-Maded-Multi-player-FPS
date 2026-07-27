// Client game loop: input -> prediction -> reconciliation -> render.
//
// The local player is simulated immediately with the shared physics code and
// corrected whenever the server disagrees. Everyone else is drawn 100ms in the
// past so their motion can be interpolated between two snapshots.

import * as THREE from 'three';
import {
  MSG,
  EV,
  TICK_DT,
  COMMAND_SEND_RATE,
  INTERP_DELAY_MS,
  MATCH_STATE,
  TEAMS,
} from '/shared/constants.js';
import { buildMap } from '/shared/map.js';
import {
  makeWorld,
  stepPlayer,
  lookDir,
  traceWorld,
  traceEntity,
  applySpread,
  mulberry32,
  eyeHeight,
  hasLineOfSight,
} from '/shared/physics.js';
import { getHero } from '/shared/heroes.js';
import { Stage } from './world.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { Avatar } from './avatars.js';
import { Minimap } from './minimap.js';

const MAX_SNAPSHOTS = 24;

export class Game {
  constructor({ canvas, net, welcome, hud, sfx, input, settings }) {
    this.net = net;
    this.hud = hud;
    this.sfx = sfx;
    this.input = input;
    this.settings = settings;

    this.selfId = welcome.id;
    this.selfTeam = welcome.team;
    this.heroId = welcome.hero;
    this.roomName = welcome.room;

    this.map = buildMap();
    this.world = makeWorld(this.map);

    this.stage = new Stage(canvas, {
      fov: settings.fov,
      shadows: settings.shadows,
      mobile: !!settings.mobile,
    });
    this.stage.buildLevel(this.map);
    this.effects = new Effects(this.stage.scene);
    this.viewmodel = new ViewModel(this.stage.weaponScene, this.stage.camera);
    this.viewmodel.setHero(this.heroId);
    this.minimap = new Minimap(document.getElementById('minimap'), this.map);

    // Predicted local state.
    this.self = { x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, crouching: false };
    this.me = { hp: 100, mhp: 100, am: 30, mag: 30, rl: 0, ab: 0, abu: 0, al: 0, rs: 0, sp: 0.01, hero: this.heroId };
    this.pending = [];
    this.unsent = [];
    this.seq = 0;
    this.errorOffset = new THREE.Vector3();
    this.eyeSmooth = eyeHeight(false);

    this.snapshots = [];
    this.avatars = new Map();
    this.remote = new Map(); // id -> last interpolated state
    this.revealed = false;
    this.pings = new Map();
    this.crosshairEnemy = 0;

    this.lastFireAt = 0;
    this.localSpread = getHero(this.heroId).weapon.spread;
    this.recoilDebt = 0;
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.landDip = 0;
    this.matchState = MATCH_STATE.WARMUP;
    this.matchEndsAt = Date.now();
    this.scores = [0, 0];
    this.scoreboardOpen = false;
    this.alive = false;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.sendTimer = 0;
    this.running = false;

    this.tmpVec = new THREE.Vector3();
    this.bindNet();
    this.bindKeys();
    window.addEventListener('resize', () => this.stage.resize());
  }

  /* ------------------------------------------------------------ plumbing */

  bindNet() {
    this.net.on(MSG.SNAPSHOT, (m) => this.onSnapshot(m));
    this.net.on(MSG.EVENTS, (m) => this.handleEvents(m.ev || []));
    this.net.on(MSG.MATCH, (m) => this.onMatch(m));
  }

  bindKeys() {
    this.input.onKey = (code, e) => {
      if (this.input.typing) {
        if (code === 'Enter') {
          const text = this.hud.closeChat();
          this.input.typing = false;
          if (text) this.net.send({ t: MSG.CHAT, msg: text });
          this.input.requestLock();
          return true;
        }
        if (code === 'Escape') {
          this.hud.closeChat();
          this.input.typing = false;
          return true;
        }
        return true; // swallow everything else while typing
      }
      if (code === 'Enter') {
        this.input.releaseLock();
        this.hud.openChat();
        this.input.typing = true;
        e.preventDefault();
        return true;
      }
      if (code === 'Tab') {
        e.preventDefault();
        this.scoreboardOpen = true;
        this.hud.toggleScoreboard(true);
        return true;
      }
      return false;
    };

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab' && this.scoreboardOpen) {
        this.scoreboardOpen = false;
        this.hud.toggleScoreboard(false);
      }
    });

    this.input.onLockChange = (locked) => {
      document.body.classList.toggle('playing', locked);
      this.hud.setLockHint(!locked && !this.input.typing && !this.input.touchMode);
    };

    // The on-screen buttons stand in for Tab and Enter.
    this.input.onTouchUi = (what, on) => {
      if (what === 'scoreboard') {
        this.scoreboardOpen = on;
        this.hud.toggleScoreboard(on);
      } else if (what === 'chat') {
        if (on) {
          this.hud.openChat();
          this.input.typing = true;
        } else {
          const text = this.hud.closeChat();
          this.input.typing = false;
          if (text) this.net.send({ t: MSG.CHAT, msg: text });
        }
      }
    };
    this.hud.onChatSend(() => {
      const text = this.hud.closeChat();
      this.input.typing = false;
      this.hud.setChatButtonOff();
      if (text) this.net.send({ t: MSG.CHAT, msg: text });
    });

    this.hud.onRespawn(() => {
      if (this.me.rs <= 0) this.net.send({ t: MSG.RESPAWN, hero: this.pendingHero });
    });

    this.hud.onHeroPick((heroId) => {
      this.pendingHero = heroId;
      this.hud.markPendingHero(heroId);
      this.net.send({ t: MSG.RESPAWN, hero: heroId });
    });
  }

  start() {
    this.running = true;
    this.hud.show();
    this.hud.setSelf(this.selfId, this.selfTeam);
    this.hud.setRoomName(this.roomName);
    this.hud.setHero(this.heroId);
    this.hud.setLockHint(!this.input.locked && !this.input.touchMode);
    this.loop();
  }

  stop() {
    this.running = false;
  }

  /* ------------------------------------------------------------ snapshots */

  onMatch(m) {
    this.scores = m.scores;
    this.matchState = m.state;
    this.matchEndsAt = Date.now() + m.endsIn;
    const prev = this.matchOverShown;
    this.hud.match(m);
    if (m.state === MATCH_STATE.OVER && !prev) {
      this.matchOverShown = true;
      const mine = m.scores[this.selfTeam];
      const theirs = m.scores[1 - this.selfTeam];
      this.sfx.ui(mine >= theirs ? 'win' : 'lose');
    } else if (m.state !== MATCH_STATE.OVER) {
      this.matchOverShown = false;
    }
    // Keep avatars in sync with roster hero/team changes.
    for (const r of m.roster) {
      if (r.id === this.selfId) continue;
      const av = this.avatars.get(r.id);
      if (av) av.setInfo(r);
    }
    for (const [id, av] of this.avatars) {
      if (!m.roster.some((r) => r.id === id)) {
        av.dispose(this.stage.scene);
        this.avatars.delete(id);
        this.remote.delete(id);
      }
    }
  }

  onSnapshot(m) {
    this.revealed = !!m.rev;

    // ---- reconcile the local player -------------------------------------
    const me = m.me;
    const wasAlive = this.alive;
    this.me = me;
    this.alive = !!me.al;
    if (me.hero !== this.heroId) {
      this.heroId = me.hero;
      this.viewmodel.setHero(me.hero);
      this.hud.setHero(me.hero);
      this.localSpread = getHero(me.hero).weapon.spread;
    }

    if (this.alive) {
      const before = { x: this.self.x, y: this.self.y, z: this.self.z };
      const authoritative = {
        x: me.x,
        y: me.y,
        z: me.z,
        vx: me.vx,
        vy: me.vy,
        vz: me.vz,
        onGround: !!me.g,
        crouching: !!me.c,
      };
      // Drop acknowledged commands, then replay the rest on top of the
      // authoritative state.
      while (this.pending.length && this.pending[0].seq <= m.ack) this.pending.shift();
      const hero = getHero(this.heroId);
      for (const cmd of this.pending) {
        stepPlayer(authoritative, cmd, this.world, TICK_DT, {
          speed: hero.speed,
          speedMult: me.abu > 0 && hero.id === 'ranger' ? 1.28 : 1,
        });
      }
      const err = Math.hypot(authoritative.x - before.x, authoritative.y - before.y, authoritative.z - before.z);
      Object.assign(this.self, authoritative);
      if (err > 2.5 || !wasAlive) {
        this.errorOffset.set(0, 0, 0); // hard snap (teleport / respawn)
      } else if (err > 0.005) {
        // Smooth the correction out over a few frames instead of popping.
        this.errorOffset.set(before.x - authoritative.x, before.y - authoritative.y, before.z - authoritative.z);
        if (this.errorOffset.length() > 1.2) this.errorOffset.setLength(1.2);
      }
    } else {
      this.self.x = me.x;
      this.self.y = me.y;
      this.self.z = me.z;
      this.pending.length = 0;
    }

    // ---- store remote states for interpolation --------------------------
    const players = new Map();
    for (const row of m.ps) {
      players.set(row[0], {
        id: row[0],
        x: row[1],
        y: row[2],
        z: row[3],
        yaw: row[4],
        pitch: row[5],
        flags: row[6],
        hp: row[7],
        mhp: row[8],
        team: row[9],
      });
    }
    this.snapshots.push({ ts: m.ts, players });
    while (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();

    this.handleEvents(m.ev || []);
  }

  /* --------------------------------------------------------------- events */

  handleEvents(events) {
    for (const ev of events) {
      switch (ev.e) {
        case EV.SHOT:
          if (ev.id !== this.selfId) this.remoteShot(ev);
          break;
        case EV.HIT:
          if (ev.by !== this.selfId) {
            this.effects.impact({ x: ev.x, y: ev.y, z: ev.z }, { x: ev.nx, y: ev.ny, z: ev.nz }, ev.surf);
            this.sfx.impact({ x: ev.x, y: ev.y, z: ev.z }, this.listener(), ev.surf);
          }
          break;
        case EV.KILL:
          this.onKill(ev);
          break;
        case EV.DAMAGE:
          this.onDamaged(ev);
          break;
        case EV.HEAL:
          this.effects.heal({ x: ev.x, y: ev.y, z: ev.z }, ev.r);
          if (ev.targets?.some((t) => t[0] === this.selfId)) this.hud.banner('회복됨');
          break;
        case EV.SPAWN:
          this.onSpawn(ev);
          break;
        case EV.ABILITY:
          this.onAbility(ev);
          break;
        case EV.CHAT:
          this.hud.chat(ev);
          this.sfx.ui('blip');
          break;
        case EV.RELOAD:
          break;
        case 'confirm':
          this.hud.hitmarker(!!ev.kill);
          this.sfx.hitmarker(!!ev.kill);
          break;
        default:
          break;
      }
    }
  }

  remoteShot(ev) {
    const origin = { x: ev.x, y: ev.y, z: ev.z };
    const hero = getHero(ev.hero);
    for (const t of ev.tr || []) {
      const end = { x: t[0], y: t[1], z: t[2] };
      this.effects.tracer(origin, end, hero.color);
      if (t[3]) this.effects.blood(end, { x: 0, y: 0, z: 0 });
    }
    const dir = ev.tr?.length
      ? normalizeTo(origin, { x: ev.tr[0][0], y: ev.tr[0][1], z: ev.tr[0][2] })
      : { x: 0, y: 0, z: 1 };
    this.effects.muzzle(origin, dir, ev.hero === 'sentinel' ? 1.5 : 1);
    this.sfx.shot(ev.hero, origin, this.listener(), false);

    const team = this.hud.teamOf(ev.id);
    if (team !== undefined && team !== this.selfTeam) {
      this.pings.set(ev.id, { x: ev.x, z: ev.z, until: performance.now() + 2200 });
    }
  }

  onKill(ev) {
    this.hud.killfeed(ev);
    const teamColor = TEAMS[ev.victimTeam]?.color ?? 0xffffff;
    this.effects.death({ x: ev.x, y: ev.y, z: ev.z }, teamColor);

    const av = this.avatars.get(ev.victim);
    if (av) av.group.visible = false;

    if (ev.victim === this.selfId) {
      this.alive = false;
      this.sfx.die();
      this.hud.showDead(ev.killerName, 5000);
    } else if (ev.killer === this.selfId) {
      this.hud.banner(`${ev.victimName} 제거${ev.head ? ' · 헤드샷' : ''}`);
      if (ev.streak >= 3) this.hud.banner(`${ev.streak} 연속 킬!`, true);
    }
  }

  onDamaged(ev) {
    this.sfx.hurt();
    if (ev.from && ev.from !== this.selfId) {
      const dx = ev.fx - this.self.x;
      const dz = ev.fz - this.self.z;
      // Angle of the attacker relative to where we are looking.
      const rel = Math.atan2(dx, dz) + this.input.yaw;
      this.hud.damageFrom(rel + Math.PI);
    }
  }

  onSpawn(ev) {
    this.effects.ring({ x: ev.x, y: ev.y, z: ev.z }, { color: TEAMS[ev.team].color, from: 0.4, to: 2.6, life: 0.5 });
    const av = this.avatars.get(ev.id);
    if (av) av.group.visible = true;
    if (ev.id === this.selfId) {
      this.self.x = ev.x;
      this.self.y = ev.y;
      this.self.z = ev.z;
      this.self.vx = this.self.vy = this.self.vz = 0;
      this.self.crouching = false;
      this.pending.length = 0;
      this.errorOffset.set(0, 0, 0);
      this.alive = true;
      this.hud.hideDead();
      this.sfx.spawn();
      this.recoilDebt = 0;
    }
  }

  onAbility(ev) {
    const hero = getHero(ev.hero);
    this.effects.abilityBurst({ x: ev.x, y: ev.y, z: ev.z }, hero.color);
    this.sfx.ability(ev.hero, { x: ev.x, y: ev.y, z: ev.z }, this.listener(), ev.id === this.selfId);
    if (ev.id === this.selfId) this.hud.banner(hero.ability.name);
    else if (ev.team === this.selfTeam) this.hud.chat({ system: true, msg: `${this.hud.nameOf(ev.id)} — ${hero.ability.name}` });
  }

  /* ------------------------------------------------------------ main loop */

  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());

    const now = performance.now();
    let frameDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (frameDt > 0.25) frameDt = 0.25; // tab was backgrounded

    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      this.hud.setStats(Math.round(this.fpsFrames / this.fpsTime), Math.round(this.net.rtt));
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    // Aim assist nudges the view before the commands for this frame are built.
    this.updateAimAssist(frameDt);
    this.crosshairEnemy = this.findCrosshairEnemy();

    // Fixed-step prediction so the client and server integrate identically.
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= TICK_DT && steps < 8) {
      this.stepLocal(TICK_DT);
      this.accumulator -= TICK_DT;
      steps++;
    }
    if (steps === 8) this.accumulator = 0;

    this.sendTimer += frameDt;
    if (this.sendTimer >= 1 / COMMAND_SEND_RATE) {
      this.sendTimer = 0;
      this.flushCommands();
    }

    this.updateWeapon(frameDt);
    this.updateRemotes(frameDt);
    this.updateCamera(frameDt);
    this.effects.update(frameDt);
    this.updateHud(frameDt);
    this.stage.render();
  }

  stepLocal(dt) {
    const yaw = this.input.yaw;
    const pitch = this.input.pitch;
    this.yawDelta = yaw - this.lastYaw;
    this.pitchDelta = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;

    if (!this.alive) return;

    // The analog stick is already quantised to integers, so the server derives
    // the identical direction from the same numbers.
    const stick = this.input.analog();
    const cmd = {
      seq: ++this.seq,
      keys: this.input.bitmask,
      yaw,
      pitch,
      mx: stick ? stick.mx : 0,
      mz: stick ? stick.mz : 0,
    };
    this.pending.push(cmd);
    if (this.pending.length > 90) this.pending.shift();
    this.unsent.push(cmd);

    const hero = getHero(this.heroId);
    const wasGround = this.self.onGround;
    const landed = stepPlayer(this.self, cmd, this.world, dt, {
      speed: hero.speed,
      speedMult: this.me.abu > 0 && hero.id === 'ranger' ? 1.28 : 1,
    });
    if (!wasGround && this.self.onGround && landed > 3) {
      this.landDip = Math.min(0.14, landed * 0.008);
    }

    // Footsteps while grounded and moving.
    const speed = Math.hypot(this.self.vx, this.self.vz);
    if (this.self.onGround && speed > 1.5) this.sfx.footstep(speed, this.self.crouching);
  }

  flushCommands() {
    if (!this.unsent.length) {
      return;
    }
    // The analog pair is only appended when a stick is actually in use, so
    // keyboard players keep sending the shorter four-element form.
    const c = this.unsent.map((cmd) => {
      const row = [cmd.seq, cmd.keys, round4(cmd.yaw), round4(cmd.pitch)];
      if (cmd.mx || cmd.mz) row.push(cmd.mx, cmd.mz);
      return row;
    });
    this.unsent.length = 0;
    this.net.send({ t: MSG.COMMANDS, c, ping: Math.round(this.net.rtt) });
  }

  /* --------------------------------------------------------------- combat */

  /**
   * Console-style aim assist for touch play: a thumb on glass cannot track a
   * moving target the way a mouse can, so the view is gently pulled towards an
   * enemy near the crosshair and look sensitivity eases off while it does.
   * Never runs for mouse players.
   */
  updateAimAssist(dt) {
    const input = this.input;
    if (!input.touchMode || !this.alive) {
      input.aimAssist = 0;
      return;
    }
    const eye = { x: this.self.x, y: this.self.y + this.eyeSmooth, z: this.self.z };
    const dir = lookDir(input.yaw, input.pitch);
    const CONE = Math.cos(0.14); // ~8 degrees
    let best = null;
    let bestDot = CONE;

    for (const s of this.remote.values()) {
      if (s.team === this.selfTeam || !s.alive) continue;
      const tx = s.x - eye.x;
      const ty = s.y + (s.crouching ? 0.85 : 1.15) - eye.y;
      const tz = s.z - eye.z;
      const dist = Math.hypot(tx, ty, tz);
      if (dist < 1.5 || dist > 90) continue;
      const dot = (tx * dir.x + ty * dir.y + tz * dir.z) / dist;
      if (dot <= bestDot) continue;
      if (!hasLineOfSight(this.world, eye, { x: s.x, y: s.y + 1.15, z: s.z })) continue;
      bestDot = dot;
      best = { x: tx / dist, y: ty / dist, z: tz / dist };
    }

    if (!best) {
      input.aimAssist *= Math.max(0, 1 - dt * 6);
      return;
    }
    // Stronger the closer the target already is to the centre of the screen.
    const closeness = Math.min(1, (bestDot - CONE) / (1 - CONE));
    input.aimAssist = closeness;
    const wantYaw = Math.atan2(-best.x, -best.z);
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, best.y)));
    const rate = Math.min(1, dt * 3.2 * closeness);
    input.yaw = approachAngle(input.yaw, wantYaw, Math.abs(angleDelta(input.yaw, wantYaw)) * rate);
    input.pitch += (wantPitch - input.pitch) * rate;
  }

  updateWeapon(dt) {
    const hero = getHero(this.heroId);
    const w = hero.weapon;
    const now = performance.now();

    // Spread recovery mirrors the server's.
    if (this.localSpread > w.spread) {
      this.localSpread = Math.max(w.spread, this.localSpread - (w.spreadMax - w.spread) * dt * 1.6);
    }
    // Recoil recovery pulls the view back down.
    if (this.recoilDebt > 0) {
      const r = Math.min(this.recoilDebt, dt * 1.1);
      this.input.pitch -= r;
      this.recoilDebt -= r;
    }

    if (this.input.take('reload')) this.requestReload();
    if (this.input.take('ability')) this.net.send({ t: MSG.ABILITY });

    if (!this.alive) {
      if (this.input.take('respawn') && this.me.rs <= 0) {
        this.net.send({ t: MSG.RESPAWN, hero: this.pendingHero });
      }
      return;
    }

    const reloading = this.me.rl > 0;
    const auto = w.kind === 'auto';
    // Touch players can let the weapon fire itself while an enemy is centred —
    // holding a fire button and aiming with the same thumb is not realistic.
    const autoFire =
      this.settings.autoFire &&
      this.input.touchMode &&
      this.crosshairEnemy &&
      this.input.aimAssist > 0.25;
    // `firePressed` is latched on press, so a tap shorter than one frame still
    // fires exactly once — important for touch, and for anyone on a low frame
    // rate. Held automatics keep firing from `firing`.
    const clicked = this.input.firePressed;
    const wants = (auto ? this.input.firing || clicked : clicked) || autoFire;
    const ready = now - this.lastFireAt >= w.interval;

    if (wants && ready && !reloading) {
      this.input.firePressed = false;
      if (this.me.am <= 0) {
        this.sfx.dryFire();
        this.requestReload();
        this.lastFireAt = now - w.interval + 350;
      } else {
        this.fire(w, hero);
      }
    }
  }

  requestReload() {
    const w = getHero(this.heroId).weapon;
    if (this.me.rl > 0 || this.me.am >= w.mag || !this.alive) return;
    this.net.send({ t: MSG.RELOAD });
    this.viewmodel.startReload(w.reload);
    this.sfx.reload(w.reload > 2200);
    this.me.rl = w.reload; // predict so the HUD reacts instantly
  }

  fire(w, hero) {
    const now = performance.now();
    this.lastFireAt = now;
    this.me.am = Math.max(0, this.me.am - 1);

    const dir = lookDir(this.input.yaw, this.input.pitch);
    const seed = (Math.random() * 0xffff) | 0;
    const zoomed = this.input.zooming;

    this.net.send({
      t: MSG.FIRE,
      d: { x: round4(dir.x), y: round4(dir.y), z: round4(dir.z) },
      sd: seed,
      rt: Math.round(this.net.serverNow() - INTERP_DELAY_MS),
      z: zoomed ? 1 : 0,
    });

    // Local effects. The seed matches the server's, so tracers agree.
    const rand = mulberry32(((seed | 0) ^ (this.selfId * 2654435761)) >>> 0);
    const eye = { x: this.self.x, y: this.self.y + eyeHeight(this.self.crouching), z: this.self.z };
    const muzzle = this.viewmodel.muzzleWorld(this.tmpVec).clone();
    const baseSpread = zoomed && w.zoomSpread !== undefined ? w.zoomSpread : this.localSpread;

    for (let i = 0; i < (w.pellets || 1); i++) {
      const spread = w.pellets > 1 ? w.spread : baseSpread;
      const d = applySpread(dir, spread, rand);
      const hit = this.localTrace(eye, d, w.range);
      const end = hit ? hit.point : { x: eye.x + d.x * w.range, y: eye.y + d.y * w.range, z: eye.z + d.z * w.range };
      this.effects.tracer(muzzle, end, hero.color, 0.06);
      if (hit?.player) {
        this.effects.blood(end, d);
        this.sfx.fleshHit(end, this.listener());
      } else if (hit) {
        this.effects.impact(end, hit.normal, hit.surf);
        this.sfx.impact(end, this.listener(), hit.surf);
      }
    }

    this.effects.muzzle(muzzle, dir, hero.id === 'sentinel' ? 1.6 : 1);
    this.viewmodel.kick(w.recoil);
    this.sfx.shot(hero.id, null, null, true);

    // View punch, recovered over the next moments.
    const kick = w.recoil * 0.0042 * (zoomed ? 0.6 : 1);
    this.input.pitch = Math.min(Math.PI / 2 - 0.02, this.input.pitch + kick);
    this.recoilDebt += kick;
    this.localSpread = Math.min(w.spreadMax ?? w.spread, this.localSpread + (w.spreadPerShot || 0));
  }

  /** Enemy id directly under the crosshair, or 0. Drives the red crosshair
   *  and, on touch, auto-fire. */
  findCrosshairEnemy() {
    if (!this.alive) return 0;
    const eye = { x: this.self.x, y: this.self.y + this.eyeSmooth, z: this.self.z };
    const hit = this.localTrace(eye, lookDir(this.input.yaw, this.input.pitch), 140);
    return hit?.player || 0;
  }

  /** Visual-only trace against the level and the interpolated enemies. */
  localTrace(origin, dir, range) {
    const wallHit = traceWorld(this.world, origin, dir, range);
    let best = wallHit
      ? { point: wallHit.point, normal: wallHit.normal, surf: wallHit.box.kind, dist: wallHit.dist, player: null }
      : null;
    let limit = best ? best.dist : range;
    for (const [id, s] of this.remote) {
      if (s.team === this.selfTeam || !s.alive) continue;
      const hit = traceEntity(origin, dir, { x: s.x, y: s.y, z: s.z, crouching: s.crouching }, limit);
      if (hit && hit.dist < limit) {
        limit = hit.dist;
        best = { point: hit.point, normal: { x: 0, y: 1, z: 0 }, surf: 'body', dist: hit.dist, player: id };
      }
    }
    return best;
  }

  /* ------------------------------------------------------------- remotes */

  updateRemotes(dt) {
    const renderTime = this.net.serverNow() - INTERP_DELAY_MS;
    const snaps = this.snapshots;
    if (snaps.length === 0) return;

    // Find the pair of snapshots bracketing the render time.
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].ts <= renderTime) {
        a = snaps[i];
        b = snaps[i + 1] || snaps[i];
        break;
      }
    }
    const span = b.ts - a.ts;
    const f = span > 0 ? Math.max(0, Math.min(1, (renderTime - a.ts) / span)) : 0;
    const now = performance.now();

    const seen = new Set();
    for (const [id, sa] of a.players) {
      const sb = b.players.get(id) || sa;
      seen.add(id);

      const state = {
        x: lerp(sa.x, sb.x, f),
        y: lerp(sa.y, sb.y, f),
        z: lerp(sa.z, sb.z, f),
        yaw: lerpAngle(sa.yaw, sb.yaw, f),
        pitch: lerp(sa.pitch, sb.pitch, f),
        crouching: !!(sb.flags & 2),
        alive: !!(sb.flags & 1),
        shield: !!(sb.flags & 8),
        team: sb.team,
        hp: sb.hp,
        mhp: sb.mhp,
      };
      // Speed for the walk cycle, taken straight from the two samples.
      state.speed = span > 0 ? Math.hypot(sb.x - sa.x, sb.z - sa.z) / (span / 1000) : 0;
      this.remote.set(id, state);

      let av = this.avatars.get(id);
      if (!av) {
        const info = this.hud.roster.get(id);
        av = new Avatar({ id, team: state.team, hero: info?.hero || 'ranger', name: info?.name || '' });
        this.avatars.set(id, av);
        this.stage.scene.add(av.group);
        if (info) av.setInfo(info);
      }
      av.group.visible = state.alive;
      av.setHealth(state.hp, state.mhp);
      const friendly = state.team === this.selfTeam;
      av.update(state, {
        camera: this.stage.camera,
        dt,
        revealed: this.revealed && !friendly,
        friendly,
      });

      if (state.alive && av.wantsStepSound(now, state.speed)) {
        this.sfx.remoteStep({ x: state.x, y: state.y, z: state.z }, this.listener());
      }
    }

    for (const [id, av] of this.avatars) {
      if (!seen.has(id)) av.group.visible = false;
    }
  }

  /* -------------------------------------------------------------- camera */

  updateCamera(dt) {
    const cam = this.stage.camera;
    const hero = getHero(this.heroId);
    const w = hero.weapon;

    // Decay the reconciliation offset.
    if (this.errorOffset.lengthSq() > 1e-8) {
      this.errorOffset.multiplyScalar(Math.max(0, 1 - dt * 12));
      if (this.errorOffset.lengthSq() < 1e-8) this.errorOffset.set(0, 0, 0);
    }

    const targetEye = eyeHeight(this.self.crouching);
    this.eyeSmooth += (targetEye - this.eyeSmooth) * Math.min(1, dt * 14);
    this.landDip *= Math.max(0, 1 - dt * 7);

    const speed = Math.hypot(this.self.vx, this.self.vz);
    // Subtle head bob, disabled while scoped.
    const zoom = this.input.zooming && this.alive;
    this.bobPhase = (this.bobPhase || 0) + (this.self.onGround ? dt * (4.2 + speed * 1.05) : 0);
    const bobAmount = zoom ? 0 : Math.min(speed / 8, 1) * 0.028;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmount;
    const bobX = Math.cos(this.bobPhase) * bobAmount * 0.6;

    if (this.alive) {
      cam.position.set(
        this.self.x + this.errorOffset.x + bobX * 0.4,
        this.self.y + this.errorOffset.y + this.eyeSmooth + bobY - this.landDip,
        this.self.z + this.errorOffset.z,
      );
    } else {
      // Death cam: hover slightly above the body and keep looking around.
      cam.position.set(this.self.x, this.self.y + 1.9, this.self.z);
    }
    cam.rotation.set(this.input.pitch, this.input.yaw, this.alive ? bobX * 0.35 : 0);

    // FOV: zoom per weapon, small sprint widening.
    const sprinting = this.self.onGround && speed > hero.speed * 1.15;
    const targetFov = zoom ? w.zoomFov : this.stage.baseFov + (sprinting ? 4 : 0);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 12);
    cam.updateProjectionMatrix();

    this.viewmodel.update(dt, {
      speed,
      onGround: this.self.onGround,
      zoom,
      yawDelta: this.yawDelta,
      pitchDelta: this.pitchDelta,
      alive: this.alive,
    });
    this.hud.setScope(!!(zoom && w.scope));
  }

  listener() {
    return {
      x: this.stage.camera.position.x,
      y: this.stage.camera.position.y,
      z: this.stage.camera.position.z,
      yaw: this.input.yaw,
    };
  }

  /* ----------------------------------------------------------------- hud */

  updateHud(dt) {
    this.hud.vitals(this.me);
    this.hud.setClock(this.matchEndsAt - Date.now());

    // The crosshair target was already resolved once at the top of the frame.
    this.hud.crosshairSpread(
      this.input.zooming && getHero(this.heroId).weapon.zoomSpread !== undefined ? 0.002 : this.localSpread,
      this.input.zooming && getHero(this.heroId).weapon.scope,
      !!this.crosshairEnemy,
    );

    if (!this.alive && this.me.rs >= 0) this.hud.updateRespawn(this.me.rs);

    // Minimap: allies always, enemies when revealed or when they just fired.
    const blips = [{ x: this.self.x, z: this.self.z, team: this.selfTeam, alive: this.alive, self: true }];
    const now = performance.now();
    for (const [id, s] of this.remote) {
      const friendly = s.team === this.selfTeam;
      const ping = this.pings.get(id);
      const pingK = ping && ping.until > now ? (ping.until - now) / 2200 : 0;
      if (friendly || this.revealed || pingK > 0) {
        blips.push({
          x: pingK > 0 && !friendly && !this.revealed ? ping.x : s.x,
          z: pingK > 0 && !friendly && !this.revealed ? ping.z : s.z,
          team: s.team,
          alive: s.alive && (friendly || this.revealed || pingK > 0),
          revealed: !friendly && this.revealed,
          ping: friendly ? 0 : pingK,
        });
      }
    }
    for (const [id, p] of this.pings) if (p.until < now) this.pings.delete(id);
    this.minimap.draw({ x: this.self.x, z: this.self.z, yaw: this.input.yaw, team: this.selfTeam }, blips);
  }
}

function lerp(a, b, f) {
  return a + (b - a) * f;
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

function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function normalizeTo(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}
