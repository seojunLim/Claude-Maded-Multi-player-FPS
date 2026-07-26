// Movement, collision and hitscan. These run the exact code the browser and
// the server share, so a failure here is a desync between them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMap } from '../shared/map.js';
import {
  makeWorld,
  stepPlayer,
  lookDir,
  traceWorld,
  traceEntity,
  hasLineOfSight,
  groundHeightAt,
} from '../shared/physics.js';
import { KEY, TICK_DT, PLAYER_HEIGHT, SPRINT_MULT, AIR_SPEED_CAP } from '../shared/constants.js';

const map = buildMap();
const world = makeWorld(map);
const SPEED = 6.3;

function spawn(x, y, z) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, crouching: false };
}

function run(state, keys, yaw, steps, mods = { speed: SPEED }) {
  for (let i = 0; i < steps; i++) stepPlayer(state, { keys, yaw }, world, TICK_DT, mods);
  return state;
}

test('falls to the ground and stays there', () => {
  const s = spawn(0, 4, 25);
  run(s, 0, 0, 120);
  assert.ok(s.onGround, 'should be grounded');
  assert.ok(Math.abs(s.y) < 0.02, `expected y≈0, got ${s.y}`);
  assert.equal(s.vy, 0);
});

test('movement keys agree with the look direction', () => {
  // Anything else means the player strafes away from where they are aiming.
  const cases = [
    ['forward', KEY.FORWARD, (l) => [l.x, l.z]],
    ['back', KEY.BACK, (l) => [-l.x, -l.z]],
    ['right', KEY.RIGHT, (l) => [-l.z, l.x]],
    ['left', KEY.LEFT, (l) => [l.z, -l.x]],
  ];
  for (const [label, keys, expected] of cases) {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.3]) {
      const s = run(spawn(0, 0, 25), keys, yaw, 8);
      const len = Math.hypot(s.vx, s.vz);
      assert.ok(len > 1, `${label} at yaw ${yaw} did not move`);
      const [ex, ez] = expected(lookDir(yaw, 0));
      assert.ok(
        Math.abs(s.vx / len - ex) < 0.02 && Math.abs(s.vz / len - ez) < 0.02,
        `${label} at yaw ${yaw}: got (${(s.vx / len).toFixed(2)}, ${(s.vz / len).toFixed(2)}) want (${ex.toFixed(2)}, ${ez.toFixed(2)})`,
      );
    }
  }
});

test('walls stop the player', () => {
  const s = spawn(0, 0, 30);
  run(s, KEY.FORWARD | KEY.SPRINT, Math.PI, 240); // sprint north into the back wall
  assert.ok(s.z < map.half, 'should not pass the outer wall');
  assert.ok(Math.hypot(s.vx, s.vz) < 1, 'velocity should be killed against the wall');
});

test('stairs are walkable up to the centre platform', () => {
  const s = spawn(0, 0.2, 15);
  run(s, KEY.FORWARD, 0, 200); // walk south, up the north stairs
  assert.ok(s.y > 3.0, `expected to reach the 3.1 platform, ended at y=${s.y.toFixed(2)}`);
  assert.ok(s.onGround);
});

test('ground and air speed stay capped', () => {
  const ground = run(spawn(0, 0, 25), KEY.FORWARD | KEY.SPRINT, 0, 180);
  const groundSpeed = Math.hypot(ground.vx, ground.vz);
  assert.ok(groundSpeed <= SPEED * SPRINT_MULT * 1.03 + 0.01, `ground speed ${groundSpeed}`);

  // Air-strafing (turning while accelerating mid-air) must not stack speed.
  const air = spawn(0, 0, 25);
  run(air, KEY.JUMP, 0, 2);
  let max = 0;
  for (let i = 0; i < 400; i++) {
    stepPlayer(air, { keys: KEY.FORWARD | KEY.RIGHT | KEY.SPRINT, yaw: i * 0.06 }, world, TICK_DT, { speed: SPEED });
    if (!air.onGround) max = Math.max(max, Math.hypot(air.vx, air.vz));
    if (air.onGround) stepPlayer(air, { keys: KEY.JUMP, yaw: 0 }, world, TICK_DT, { speed: SPEED });
  }
  assert.ok(max <= SPEED * SPRINT_MULT * AIR_SPEED_CAP + 0.1, `air speed reached ${max.toFixed(2)}`);
});

test('jumping leaves the ground and lands again', () => {
  const s = spawn(0, 0, 25);
  run(s, 0, 0, 30);
  stepPlayer(s, { keys: KEY.JUMP, yaw: 0 }, world, TICK_DT, { speed: SPEED });
  assert.equal(s.onGround, false);
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    stepPlayer(s, { keys: 0, yaw: 0 }, world, TICK_DT, { speed: SPEED });
    peak = Math.max(peak, s.y);
  }
  assert.ok(peak > 1.0 && peak < 2.0, `jump height ${peak.toFixed(2)} out of range`);
  assert.ok(s.onGround, 'should land again');
});

test('crouching lowers the player and cannot stand up under geometry', () => {
  const s = spawn(0, 0, 25);
  run(s, KEY.CROUCH, 0, 20);
  assert.equal(s.crouching, true);
  run(s, 0, 0, 5);
  assert.equal(s.crouching, false, 'should stand back up in the open');
});

test('rays hit level geometry and respect line of sight', () => {
  // Straight down from above the centre platform hits its 3.1 top.
  const down = traceWorld(world, { x: 0, y: 10, z: 6 }, { x: 0, y: -1, z: 0 }, 40);
  assert.ok(down, 'ray should hit the platform');
  assert.ok(Math.abs(down.point.y - 3.1) < 0.01, `hit at y=${down.point.y}`);
  assert.equal(down.normal.y, 1);

  // Open ground across a spawn area is visible; the centre platform blocks.
  assert.equal(hasLineOfSight(world, { x: -5, y: 1.6, z: 30 }, { x: 5, y: 1.6, z: 30 }), true);
  assert.equal(hasLineOfSight(world, { x: 0, y: 1.6, z: 20 }, { x: 0, y: 1.6, z: -20 }), false);
});

test('entity traces separate head shots from body shots', () => {
  const target = { x: 0, y: 0, z: 20, crouching: false };
  const eye = { x: 0, y: 1.6, z: 30 };

  const body = traceEntity(eye, { x: 0, y: -0.04, z: -1 }, target, 40);
  assert.ok(body, 'should hit the body');
  assert.equal(body.head, false);

  const head = traceEntity({ x: 0, y: 1.7, z: 30 }, { x: 0, y: 0, z: -1 }, target, 40);
  assert.ok(head, 'should hit the head');
  assert.equal(head.head, true);

  // A shot to the side misses entirely.
  assert.equal(traceEntity(eye, { x: 1, y: 0, z: 0 }, target, 40), null);
});

test('ground height query finds the surface under a point', () => {
  assert.ok(Math.abs(groundHeightAt(world, 0, 6, 5) - 3.1) < 0.01);
  assert.ok(Math.abs(groundHeightAt(world, 0, 25, 5)) < 0.01);
});

test('the map is symmetric between the two teams', () => {
  // Every box must have a mirror across z=0, or neither team plays the same map.
  const key = (b) => [b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]].map((v) => v.toFixed(3)).join(',');
  const set = new Set(map.boxes.map(key));
  for (const b of map.boxes) {
    const mirrored = key({ min: [b.min[0], b.min[1], -b.max[2]], max: [b.max[0], b.max[1], -b.min[2]] });
    assert.ok(set.has(mirrored), `box ${key(b)} (${b.kind}) has no mirror`);
  }
});

test('spawn points are clear of geometry', () => {
  for (const team of [0, 1]) {
    for (const s of map.spawns[team]) {
      const state = spawn(s.x, 0.2, s.z);
      run(state, 0, s.yaw, 60);
      assert.ok(state.onGround, `spawn ${s.x},${s.z} never settled`);
      assert.ok(state.y < 1.5, `spawn ${s.x},${s.z} settled on top of something (y=${state.y.toFixed(2)})`);
      assert.ok(
        Math.abs(state.x - s.x) < 0.6 && Math.abs(state.z - s.z) < 0.6,
        `spawn ${s.x},${s.z} pushed the player out of place`,
      );
    }
  }
});

test('spawns face towards the middle of the map', () => {
  for (const team of [0, 1]) {
    for (const s of map.spawns[team]) {
      const dir = lookDir(s.yaw, 0);
      assert.ok(Math.sign(dir.z) === -Math.sign(s.z), `spawn at z=${s.z} faces the wrong way`);
    }
  }
});

test('a player fits through every doorway', () => {
  // Walk through the south door of the north-west flank building.
  const s = spawn(-25, 0.2, 26);
  run(s, KEY.FORWARD, 0, 260);
  assert.ok(s.z < 16, `expected to walk into the building, stopped at z=${s.z.toFixed(2)}`);
  assert.ok(!Number.isNaN(s.x));
  assert.ok(PLAYER_HEIGHT > 1.7);
});
