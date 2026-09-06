// Game modes and the map rotation: who may shoot whom, what scores, and what
// wins — plus the guarantee that every arena is actually playable.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Room } from '../server/room.js';
import { MATCH_STATE, PLAYER_HEIGHT } from '../shared/constants.js';
import { MAP_IDS, MAPS, buildMap, isMapId } from '../shared/map.js';
import { MODES, MODE_IDS, getMode } from '../shared/modes.js';
import { makeWorld, isBlocked } from '../shared/physics.js';

// Every room starts a 60Hz interval, so each test reclaims the ones it opened
// or the test process never exits.
function makeRoom(t, opts) {
  const room = new Room('t' + Math.random().toString(36).slice(2), { bots: 0, ...opts });
  t.after(() => room.destroy());
  return room;
}

/** A live room in the given mode with `n` hand-placed players. */
function liveRoom(t, mode, { map = 'sanctum', n = 2 } = {}) {
  const room = makeRoom(t, { mode, map, size: n });
  room.state = MATCH_STATE.LIVE;
  room.stateEndsAt = Date.now() + 60000;
  const players = [];
  for (let i = 0; i < n; i++) {
    const p = room.addPlayer({ name: 'P' + i, heroId: 'ranger', socket: null, team: room.ffa ? 1 : i % 2 });
    room.respawn(p);
    p.invulnUntil = 0;
    players.push(p);
  }
  return { room, players };
}

/* ------------------------------------------------------------------ maps */

test('every map builds a playable arena', (t) => {
  for (const id of MAP_IDS) {
    const map = buildMap(id);
    const world = makeWorld(map);
    assert.ok(map.boxes.length > 40, `${id} has too little geometry`);
    assert.equal(map.spawns.length, 2, `${id} needs two spawn sets`);
    assert.ok(map.freeSpawns.length >= 8, `${id} needs free-for-all spawns`);
    assert.ok(map.zone, `${id} needs a control point for domination`);

    for (const s of [...map.spawns[0], ...map.spawns[1], ...map.freeSpawns]) {
      assert.ok(Math.abs(s.x) < map.half && Math.abs(s.z) < map.half, `${id} spawn is outside the walls`);
      assert.ok(!isBlocked(world, s.x, 0.2, s.z, PLAYER_HEIGHT), `${id} spawn ${s.x},${s.z} is inside geometry`);
    }
  }
});

test('map ids round-trip and unknown ids fall back instead of throwing', (t) => {
  for (const id of MAP_IDS) {
    assert.ok(isMapId(id));
    assert.equal(buildMap(id).id, id);
    assert.equal(MAPS[id].name, buildMap(id).name);
  }
  assert.equal(isMapId('nope'), false);
  assert.equal(buildMap('nope').id, 'sanctum');
});

test('both sides build byte-identical geometry for every map', (t) => {
  for (const id of MAP_IDS) {
    assert.deepEqual(buildMap(id).boxes, buildMap(id).boxes, `${id} is not deterministic`);
  }
});

test('a room honours the map it was opened with, and rolls one for "random"', (t) => {
  assert.equal(makeRoom(t, { map: 'dune' }).mapId, 'dune');
  assert.equal(makeRoom(t, { map: 'bogus' }).mapId, 'sanctum');
  assert.ok(MAP_IDS.includes(makeRoom(t, { map: 'random' }).mapId));
});

/* ----------------------------------------------------------------- modes */

test('unknown modes fall back to team deathmatch', (t) => {
  assert.equal(makeRoom(t, { mode: 'bogus' }).mode.id, 'tdm');
  for (const id of MODE_IDS) assert.equal(makeRoom(t, { mode: id }).mode.id, id);
});

test('team deathmatch scores frags to the killer team and ignores own goals', (t) => {
  const { room, players: [a, b] } = liveRoom(t, 'tdm');
  room.kill(b, a, false, 'TEST');
  assert.deepEqual(room.scores, [1, 0]);
  room.kill(a, a, false, 'GRAVITY');
  assert.deepEqual(room.scores, [1, 0], 'a suicide must not put a point on the board');
});

test('team deathmatch ends the moment a team reaches the limit', (t) => {
  const { room, players: [a, b] } = liveRoom(t, 'tdm');
  room.scores[0] = MODES.tdm.scoreLimit - 1;
  room.kill(b, a, false, 'TEST');
  assert.equal(room.state, MATCH_STATE.OVER);
});

test('free-for-all makes everyone hostile and scores per player', (t) => {
  const { room, players: [a, b, c] } = liveRoom(t, 'ffa', { n: 3 });
  assert.ok(room.ffa);
  assert.ok(room.isEnemy(a, b) && room.isEnemy(b, c), 'nobody is a teammate in FFA');
  assert.equal(room.isEnemy(a, a), false, 'you are never your own enemy');

  room.kill(b, a, false, 'TEST');
  assert.equal(a.kills, 1);
  assert.deepEqual(room.scores, [0, 0], 'FFA keeps no team score');
  assert.equal(room.state, MATCH_STATE.LIVE);

  a.kills = MODES.ffa.scoreLimit - 1;
  room.kill(c, a, false, 'TEST');
  assert.equal(room.state, MATCH_STATE.OVER);
  assert.equal(room.winnerId, a.id, 'the player who hit the limit wins');
});

test('free-for-all spawns draw from points spread over the whole arena', (t) => {
  const { room, players: [a] } = liveRoom(t, 'ffa', { n: 2 });
  const free = room.map.freeSpawns.map((s) => `${s.x},${s.z}`);
  for (let i = 0; i < 12; i++) {
    const s = room.spawnPoint(a);
    assert.ok(free.includes(`${s.x},${s.z}`));
  }
});

test('domination scores off the control point, not off frags', (t) => {
  const { room, players: [a, b] } = liveRoom(t, 'domination');
  const z = room.map.zone;

  room.kill(b, a, false, 'TEST');
  assert.deepEqual(room.scores, [0, 0], 'kills do not score in domination');

  // One player from team 0 standing on the point for a second.
  a.x = z.x;
  a.z = z.z;
  a.y = 0;
  a.alive = true;
  b.alive = false;
  room.updateZone(1);
  assert.equal(room.zoneState.owner, 0);
  assert.equal(room.scores[0], MODES.domination.tickPerSecond);

  // Both teams on the point: contested, and nobody banks anything.
  b.alive = true;
  b.x = z.x;
  b.z = z.z;
  b.y = 0;
  const before = room.scores.slice();
  room.updateZone(1);
  assert.equal(room.zoneState.contested, true);
  assert.equal(room.zoneState.owner, -1);
  assert.deepEqual(room.scores, before);
});

test('domination ends the match once a team banks the limit', (t) => {
  const { room, players: [a, b] } = liveRoom(t, 'domination');
  const z = room.map.zone;
  b.alive = false;
  a.alive = true;
  a.x = z.x;
  a.z = z.z;
  a.y = 0;
  room.scores[0] = MODES.domination.scoreLimit - 1;
  room.updateZone(1);
  assert.equal(room.state, MATCH_STATE.OVER);
});

test('players off the point or above it do not hold it', (t) => {
  const { room, players: [a] } = liveRoom(t, 'domination');
  const z = room.map.zone;
  a.x = z.x + z.r + 3;
  a.z = z.z;
  a.y = 0;
  room.updateZone(1);
  assert.equal(room.zoneState.owner, -1);

  a.x = z.x;
  a.y = z.y1 + 5;
  room.updateZone(1);
  assert.equal(room.zoneState.owner, -1, 'the point does not reach the sky');
});

test('gun game promotes every two frags and wins off the end of the ladder', (t) => {
  const ladder = MODES.gungame.ladder;
  const { room, players: [a, b] } = liveRoom(t, 'gungame');
  assert.equal(a.heroId, ladder[0], 'everyone starts on the first rung');

  room.kill(b, a, false, 'TEST');
  assert.equal(a.stage, 0, 'one frag is not a promotion');
  room.kill(b, a, false, 'TEST');
  assert.equal(a.stage, 1);
  assert.equal(a.heroId, ladder[1], 'the promotion swaps the hero mid-life');
  assert.equal(a.ammo, a.hero.weapon.mag, 'and hands over a full magazine');

  // Climb the rest of the ladder.
  for (let stage = 1; stage < ladder.length; stage++) {
    room.kill(b, a, false, 'TEST');
    room.kill(b, a, false, 'TEST');
  }
  assert.equal(room.state, MATCH_STATE.OVER);
  assert.equal(room.winnerId, a.id);
});

test('gun game ignores a hero the player asks to respawn as', (t) => {
  const { room, players: [a] } = liveRoom(t, 'gungame');
  a.alive = false;
  a.respawnAt = 0;
  room.onRespawnRequest(a, 'marksman');
  assert.equal(a.heroId, MODES.gungame.ladder[0], 'the ladder owns the hero, not the player');
});

test('a fresh match resets ladder progress and banked zone points', (t) => {
  const { room, players: [a, b] } = liveRoom(t, 'gungame');
  room.kill(b, a, false, 'TEST');
  room.kill(b, a, false, 'TEST');
  assert.equal(a.stage, 1);
  room.resetMatch();
  assert.equal(a.stage, 0);
  assert.equal(a.heroId, MODES.gungame.ladder[0]);
});

test('matchInfo tells the client which rules and arena are in play', (t) => {
  const { room } = liveRoom(t, 'domination', { map: 'dune' });
  const info = room.matchInfo();
  assert.equal(info.mode, 'domination');
  assert.equal(info.mapId, 'dune');
  assert.equal(info.map, 'DUNE');
  assert.equal(info.limit, MODES.domination.scoreLimit);
  assert.ok(info.zone && info.zone.r > 0);

  const tdm = liveRoom(t, 'tdm').room.matchInfo();
  assert.equal(tdm.limit, MODES.tdm.scoreLimit);
  const gun = liveRoom(t, 'gungame').room.matchInfo();
  assert.equal(gun.limit, MODES.gungame.ladder.length);
  assert.equal(getMode('gungame').killsPerStage, 2);
});
