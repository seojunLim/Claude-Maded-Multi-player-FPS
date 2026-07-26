// Server-authoritative combat: damage, head shots, friendly fire, ammo,
// abilities, scoring and lag compensation.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Room } from '../server/room.js';
import { MATCH_STATE, PLAYER_EYE, RESPAWN_MS } from '../shared/constants.js';
import { getHero } from '../shared/heroes.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A room with two hand-placed players and no bots. */
function duel({ attackerHero = 'ranger', victimHero = 'ranger' } = {}) {
  const room = new Room('test-' + Math.random().toString(36).slice(2), { bots: 0 });
  room.state = MATCH_STATE.LIVE;
  room.stateEndsAt = Date.now() + 60000;

  const a = room.addPlayer({ name: 'ATK', heroId: attackerHero, socket: null, team: 0 });
  const v = room.addPlayer({ name: 'VIC', heroId: victimHero, socket: null, team: 1 });
  for (const p of [a, v]) {
    room.respawn(p);
    p.invulnUntil = 0;
    p.abilityReadyAt = 0;
  }
  // Face each other across open ground in a spawn area.
  place(a, 0, 30);
  place(v, 0, 22);
  a.yaw = 0; // looking down -z, towards the victim
  return { room, a, v };
}

function place(p, x, z, y = 0) {
  p.x = x;
  p.y = y;
  p.z = z;
  p.vx = p.vy = p.vz = 0;
  p.onGround = true;
  p.history.length = 0;
  p.history.push({ t: Date.now(), x, y, z, crouching: false });
}

/** Direction from the attacker's eye to a point on the victim. */
function aimAt(a, v, height = 1.0) {
  const dx = v.x - a.x;
  const dy = v.y + height - (a.y + PLAYER_EYE);
  const dz = v.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  return { x: dx / len, y: dy / len, z: dz / len };
}

test('a body shot damages the victim and consumes ammo', async (t) => {
  const { room, a, v } = duel();
  t.after(() => room.destroy());

  const hp0 = v.hp;
  const ammo0 = a.ammo;
  room.onFire(a, { d: aimAt(a, v, 1.0), sd: 1, rt: Date.now() });

  assert.ok(v.hp < hp0, `victim should take damage (${hp0} -> ${v.hp})`);
  assert.equal(a.ammo, ammo0 - 1);
  assert.ok(a.damage > 0);
});

test('head shots do more damage than body shots', async (t) => {
  const bodyCase = duel();
  const headCase = duel();
  bodyCase.room.onFire(bodyCase.a, { d: aimAt(bodyCase.a, bodyCase.v, 1.0), sd: 1, rt: Date.now() });
  headCase.room.onFire(headCase.a, { d: aimAt(headCase.a, headCase.v, 1.68), sd: 1, rt: Date.now() });

  const bodyDamage = bodyCase.v.hero.hp - bodyCase.v.hp;
  const headDamage = headCase.v.hero.hp - headCase.v.hp;
  assert.ok(headDamage > bodyDamage * 1.5, `head ${headDamage} vs body ${bodyDamage}`);

  bodyCase.room.destroy();
  headCase.room.destroy();
});

test('teammates cannot damage each other', async (t) => {
  const { room, a, v } = duel();
  t.after(() => room.destroy());
  v.team = a.team;

  const hp0 = v.hp;
  room.onFire(a, { d: aimAt(a, v, 1.0), sd: 1, rt: Date.now() });
  assert.equal(v.hp, hp0, 'friendly fire must be ignored');
});

test('walls block shots', async (t) => {
  const { room, a, v } = duel();
  t.after(() => room.destroy());
  // Put the victim on the far side of the centre platform.
  place(a, 0, 20);
  place(v, 0, -20);
  const hp0 = v.hp;
  room.onFire(a, { d: aimAt(a, v, 1.0), sd: 1, rt: Date.now() });
  assert.equal(v.hp, hp0, 'the centre platform should have stopped the bullet');
});

test('killing scores a point, ends the life and schedules a respawn', async (t) => {
  const { room, a, v } = duel({ attackerHero: 'marksman' });
  t.after(() => room.destroy());

  const kills = [];
  const original = room.pushEvent.bind(room);
  room.pushEvent = (ev) => {
    if (ev.e === 'kill') kills.push(ev);
    original(ev);
  };

  // Two scoped head shots from the sniper are lethal.
  for (let i = 0; i < 3 && v.alive; i++) {
    a.lastShotAt = 0;
    room.onFire(a, { d: aimAt(a, v, 1.68), sd: 1 + i, rt: Date.now(), z: 1 });
  }

  assert.equal(v.alive, false, 'victim should be dead');
  assert.equal(a.kills, 1);
  assert.equal(v.deaths, 1);
  assert.deepEqual(room.scores, [1, 0]);
  assert.equal(kills.length, 1);
  assert.equal(kills[0].killer, a.id);
  assert.ok(v.respawnAt - Date.now() > RESPAWN_MS - 200);
});

test('spawn protection blocks damage until the player acts', async (t) => {
  const { room, a, v } = duel();
  t.after(() => room.destroy());

  v.invulnUntil = Date.now() + 1000;
  const hp0 = v.hp;
  room.onFire(a, { d: aimAt(a, v, 1.0), sd: 1, rt: Date.now() });
  assert.equal(v.hp, hp0, 'spawn-protected players take no damage');

  // Firing gives up the protection.
  v.lastShotAt = 0;
  room.onFire(v, { d: aimAt(v, a, 1.0), sd: 2, rt: Date.now() });
  assert.equal(v.invulnUntil, 0);
});

test('rate limiting rejects shots fired faster than the weapon allows', async (t) => {
  const { room, a, v } = duel();
  t.after(() => room.destroy());

  room.onFire(a, { d: aimAt(a, v, 1.0), sd: 1, rt: Date.now() });
  const ammoAfterFirst = a.ammo;
  room.onFire(a, { d: aimAt(a, v, 1.0), sd: 2, rt: Date.now() }); // immediately again
  assert.equal(a.ammo, ammoAfterFirst, 'the second shot should be dropped');
});

test('an empty magazine triggers a reload that refills it', async (t) => {
  const { room, a } = duel({ attackerHero: 'sentinel' });
  t.after(() => room.destroy());

  const mag = getHero('sentinel').weapon.mag;
  a.ammo = 0;
  room.onReload(a);
  assert.ok(a.reloadEndsAt > 0, 'reload should have started');

  a.reloadEndsAt = Date.now() - 1; // fast-forward
  await sleep(40);
  assert.equal(a.ammo, mag, 'magazine should be full again');
  assert.equal(a.reloadEndsAt, 0);
});

test('the shotgun fires every pellet in one trigger pull', async (t) => {
  const { room, a, v } = duel({ attackerHero: 'sentinel' });
  t.after(() => room.destroy());
  place(a, 0, 26);
  place(v, 0, 22); // point blank so most pellets connect

  const shots = [];
  const original = room.pushEvent.bind(room);
  room.pushEvent = (ev) => {
    if (ev.e === 'shot') shots.push(ev);
    original(ev);
  };
  room.onFire(a, { d: aimAt(a, v, 1.0), sd: 7, rt: Date.now() });

  assert.equal(shots.length, 1);
  assert.equal(shots[0].tr.length, getHero('sentinel').weapon.pellets);
  assert.ok(v.hp < v.hero.hp, 'point blank shotgun should hurt');
});

test("the sentinel's shield reduces incoming damage", async (t) => {
  const plain = duel({ victimHero: 'sentinel' });
  const shielded = duel({ victimHero: 'sentinel' });
  shielded.room.onAbility(shielded.v);

  plain.room.onFire(plain.a, { d: aimAt(plain.a, plain.v, 1.0), sd: 3, rt: Date.now() });
  shielded.room.onFire(shielded.a, { d: aimAt(shielded.a, shielded.v, 1.0), sd: 3, rt: Date.now() });

  const plainDamage = plain.v.hero.hp - plain.v.hp;
  const shieldedDamage = shielded.v.hero.hp - shielded.v.hp;
  assert.ok(shieldedDamage < plainDamage, `${shieldedDamage} should be less than ${plainDamage}`);

  plain.room.destroy();
  shielded.room.destroy();
});

test('the medic heals nearby allies and not enemies', async (t) => {
  const { room, a, v } = duel({ attackerHero: 'medic' });
  t.after(() => room.destroy());

  const ally = room.addPlayer({ name: 'ALLY', heroId: 'ranger', socket: null, team: a.team });
  room.respawn(ally);
  place(ally, 2, 30);
  ally.hp = 40;
  v.hp = 40;
  place(v, 3, 30); // an enemy standing right next to the medic

  room.onAbility(a);
  assert.ok(ally.hp > 40, 'ally should be healed');
  assert.equal(v.hp, 40, 'enemies must not be healed');
  assert.ok(ally.hp <= ally.hero.hp, 'healing must not exceed max health');
});

test('lag compensation hits where the shooter saw the target', async (t) => {
  const { room, a, v } = duel();
  t.after(() => room.destroy());

  // The victim was in front of the attacker 150ms ago, then moved aside.
  const now = Date.now();
  v.history.length = 0;
  for (let i = 300; i >= 0; i -= 16) {
    const past = i > 120;
    v.history.push({ t: now - i, x: past ? 0 : 12, y: 0, z: 22, crouching: false });
  }
  v.x = 12; // current position, well out of the line of fire
  v.z = 22;

  const dirToOldSpot = (() => {
    const dx = 0 - a.x;
    const dy = 1.0 - (a.y + PLAYER_EYE);
    const dz = 22 - a.z;
    const len = Math.hypot(dx, dy, dz);
    return { x: dx / len, y: dy / len, z: dz / len };
  })();

  const hp0 = v.hp;
  room.onFire(a, { d: dirToOldSpot, sd: 1, rt: now - 150 });
  assert.ok(v.hp < hp0, 'the rewound position should have been hit');

  // The same shot without rewinding must miss.
  const fresh = duel();
  t.after(() => fresh.room.destroy());
  place(fresh.v, 12, 22);
  const hpFresh = fresh.v.hp;
  fresh.room.onFire(fresh.a, { d: dirToOldSpot, sd: 1, rt: Date.now() });
  assert.equal(fresh.v.hp, hpFresh, 'without rewind the shot should miss');
});

test('fall damage applies from a long drop', async (t) => {
  const { room, a } = duel();
  t.after(() => room.destroy());
  const hp0 = a.hp;
  a.y = 40;
  a.onGround = false;
  a.cmds.length = 0;
  await sleep(3200); // let the room tick the fall
  assert.ok(a.hp < hp0 || !a.alive, `expected fall damage, hp ${hp0} -> ${a.hp}`);
});

test('the match ends when the score limit is reached', async (t) => {
  const { room, a } = duel();
  t.after(() => room.destroy());
  room.scores[a.team] = 49;
  const v2 = room.addPlayer({ name: 'V2', heroId: 'ranger', socket: null, team: 1 });
  room.respawn(v2);
  v2.invulnUntil = 0;
  room.kill(v2, a, false, 'TEST');
  assert.equal(room.state, MATCH_STATE.OVER);
  assert.equal(room.scores[a.team], 50);
});
