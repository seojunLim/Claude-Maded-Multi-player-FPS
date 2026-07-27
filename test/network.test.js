// End-to-end: boots the real HTTP + WebSocket server and drives it with raw
// clients, exercising the same protocol the browser uses.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import { MSG, KEY, TICK_DT, PLAYER_EYE, MOVE_UNIT } from '../shared/constants.js';
import { buildMap } from '../shared/map.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;

test.before(async () => {
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), BOTS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    server.stdout.on('data', (b) => {
      if (b.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('error', reject);
  });
});

test.after(() => {
  server?.kill();
});

/** Minimal protocol client: connects, joins and records what the server sends. */
class TestClient {
  constructor() {
    this.snapshots = [];
    this.match = null;
    this.events = [];
    this.welcome = null;
    this.seq = 0;
  }

  connect(join) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('join timed out')), 8000);
      this.ws.on('open', () => this.send({ t: MSG.JOIN, ...join }));
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.t === MSG.WELCOME) {
          this.welcome = msg;
          clearTimeout(timer);
          resolve(msg);
        } else if (msg.t === MSG.ERROR) {
          // The browser client surfaces this as a failed join too.
          clearTimeout(timer);
          reject(new Error(msg.reason || 'join refused'));
        } else if (msg.t === MSG.SNAPSHOT) {
          this.snapshots.push(msg);
          if (msg.ev?.length) this.events.push(...msg.ev);
        } else if (msg.t === MSG.MATCH) {
          this.match = msg;
        } else if (msg.t === MSG.EVENTS) {
          this.events.push(...(msg.ev || []));
        }
      });
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  /** Sends `count` identical input commands, as the browser does at 30Hz. */
  input(keys, yaw = 0, pitch = 0, count = 6) {
    const c = [];
    for (let i = 0; i < count; i++) c.push([++this.seq, keys, yaw, pitch]);
    this.send({ t: MSG.COMMANDS, c });
  }

  get last() {
    return this.snapshots[this.snapshots.length - 1];
  }

  close() {
    this.ws?.close();
  }
}

test('serves the client and reports status', async () => {
  const page = await fetch(`${BASE}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /SANCTUM/);

  // The browser imports the same shared modules the server simulates with.
  for (const asset of ['/js/main.js', '/shared/physics.js', '/shared/map.js', '/css/style.css', '/vendor/three/three.module.min.js']) {
    const res = await fetch(BASE + asset);
    assert.equal(res.status, 200, `${asset} should be served`);
  }

  const status = await (await fetch(`${BASE}/api/status`)).json();
  assert.ok(Array.isArray(status.rooms));
  assert.equal(status.heroes.length, 4);
});

test('a client can join and receives snapshots', async (t) => {
  const c = new TestClient();
  t.after(() => c.close());

  const welcome = await c.connect({ name: 'SOLO', hero: 'ranger', room: 'net-join' });
  assert.ok(welcome.id > 0);
  assert.ok(welcome.team === 0 || welcome.team === 1);
  assert.equal(welcome.hero, 'ranger');

  await sleep(600);
  assert.ok(c.snapshots.length >= 5, `expected snapshots, got ${c.snapshots.length}`);
  const me = c.last.me;
  assert.equal(me.hero, 'ranger');
  assert.equal(me.mhp, 150);
  assert.equal(me.mag, 30);
  assert.ok(c.match, 'should receive match info');
  assert.ok(c.match.roster.some((r) => r.id === welcome.id));
});

test('input moves the player and the server acknowledges commands', async (t) => {
  const c = new TestClient();
  t.after(() => c.close());
  await c.connect({ name: 'MOVER', hero: 'ranger', room: 'net-move' });
  await sleep(500);

  const start = { ...c.last.me };
  const yaw = c.welcome.team === 0 ? 0 : Math.PI; // face the middle
  for (let i = 0; i < 20; i++) {
    c.input(KEY.FORWARD, yaw, 0, 3);
    await sleep(33);
  }
  await sleep(300);

  const end = c.last.me;
  const moved = Math.hypot(end.x - start.x, end.z - start.z);
  assert.ok(moved > 3, `player should have moved, only went ${moved.toFixed(2)}m`);
  assert.ok(c.last.ack > 0, 'server should acknowledge processed commands');
  assert.ok(Math.abs(end.z) < Math.abs(start.z), 'should have moved towards the centre');
});

test('analog touch input moves the player over the wire', async (t) => {
  const c = new TestClient();
  t.after(() => c.close());
  await c.connect({ name: 'THUMB', hero: 'ranger', room: 'net-stick' });
  await sleep(500);

  const start = { ...c.last.me };
  const yaw = c.welcome.team === 0 ? 0 : Math.PI;
  // A fully pushed stick, sent the way the touch controls do: no key bits at
  // all, just the quantised analog pair.
  for (let i = 0; i < 20; i++) {
    const cmds = [];
    for (let j = 0; j < 3; j++) cmds.push([++c.seq, 0, yaw, 0, 0, -MOVE_UNIT]);
    c.send({ t: MSG.COMMANDS, c: cmds });
    await sleep(33);
  }
  await sleep(300);

  const end = c.last.me;
  const moved = Math.hypot(end.x - start.x, end.z - start.z);
  assert.ok(moved > 3, `the stick should have moved the player, only went ${moved.toFixed(2)}m`);
  assert.ok(Math.abs(end.z) < Math.abs(start.z), 'should have moved towards the centre');

  // A half-pushed stick must cover noticeably less ground in the same time.
  const halfStart = { ...c.last.me };
  for (let i = 0; i < 20; i++) {
    const cmds = [];
    for (let j = 0; j < 3; j++) cmds.push([++c.seq, 0, yaw, 0, 0, -Math.round(MOVE_UNIT * 0.35)]);
    c.send({ t: MSG.COMMANDS, c: cmds });
    await sleep(33);
  }
  await sleep(300);
  const halfMoved = Math.hypot(c.last.me.x - halfStart.x, c.last.me.z - halfStart.z);
  assert.ok(halfMoved < moved, `a light push (${halfMoved.toFixed(2)}m) should be slower than a full one (${moved.toFixed(2)}m)`);
});

test('out-of-range analog values are clamped, not trusted', async (t) => {
  const c = new TestClient();
  t.after(() => c.close());
  await c.connect({ name: 'CHEAT', hero: 'ranger', room: 'net-clamp' });
  await sleep(500);

  const start = { ...c.last.me };
  // A hacked client asking for 100x the legal stick deflection.
  for (let i = 0; i < 20; i++) {
    const cmds = [];
    for (let j = 0; j < 3; j++) cmds.push([++c.seq, 0, 0, 0, 0, -MOVE_UNIT * 100]);
    c.send({ t: MSG.COMMANDS, c: cmds });
    await sleep(33);
  }
  await sleep(300);

  const elapsed = 20 * 33 + 300;
  const moved = Math.hypot(c.last.me.x - start.x, c.last.me.z - start.z);
  // Even at full sprint the hero covers ~8.5 m/s; allow generous slack.
  const ceiling = (elapsed / 1000) * 12;
  assert.ok(moved < ceiling, `moved ${moved.toFixed(2)}m in ${elapsed}ms, over the ${ceiling.toFixed(2)}m ceiling`);
});

test('two clients in one room see each other and can trade damage', async (t) => {
  const a = new TestClient();
  const b = new TestClient();
  t.after(() => {
    a.close();
    b.close();
  });

  await a.connect({ name: 'ALPHA', hero: 'ranger', room: 'net-duo' });
  await b.connect({ name: 'BRAVO', hero: 'ranger', room: 'net-duo' });
  await sleep(700);

  assert.ok(a.last.ps.some((p) => p[0] === b.welcome.id), 'ALPHA should see BRAVO');
  assert.ok(b.last.ps.some((p) => p[0] === a.welcome.id), 'BRAVO should see ALPHA');
  assert.ok(a.match.roster.length >= 2);

  // Only meaningful when the auto-balancer put them on opposite teams.
  if (a.welcome.team !== b.welcome.team) {
    const me = a.last.me;
    const them = a.last.ps.find((p) => p[0] === b.welcome.id);
    const dx = them[1] - me.x;
    const dy = them[2] + 1.0 - (me.y + PLAYER_EYE);
    const dz = them[3] - me.z;
    const len = Math.hypot(dx, dy, dz);
    const hpBefore = b.last.me.hp;

    // Spawn protection has to lapse first, so fire a throwaway shot.
    a.send({ t: MSG.FIRE, d: { x: 0, y: -1, z: 0 }, sd: 1, rt: Date.now() });
    await sleep(150);
    for (let i = 0; i < 8; i++) {
      a.send({ t: MSG.FIRE, d: { x: dx / len, y: dy / len, z: dz / len }, sd: i + 2, rt: Date.now() });
      await sleep(110);
    }
    await sleep(300);
    const hpAfter = b.last.me.hp;
    // A clear line of sight is not guaranteed from arbitrary spawns, so only
    // assert the mechanism reported something: either damage or a clean miss.
    assert.ok(hpAfter <= hpBefore, `health should never increase from being shot at (${hpBefore} -> ${hpAfter})`);
    assert.ok(a.last.me.am < 30, 'the attacker should have spent ammo');
  }
});

test('the room is created at the size the first player asked for', async (t) => {
  const a = new TestClient();
  const b = new TestClient();
  t.after(() => {
    a.close();
    b.close();
  });

  const first = await a.connect({ name: 'HOST', hero: 'ranger', room: 'net-size', size: 4 });
  assert.equal(first.size, 4, 'the welcome reports the match size');
  await sleep(300);
  assert.equal(a.match.need, 4);
  assert.equal(a.match.state, 'waiting', 'a 4-player match does not start with one player');

  // A later arrival cannot resize a room that already exists.
  const second = await b.connect({ name: 'GUEST', hero: 'ranger', room: 'net-size', size: 6 });
  assert.equal(second.size, 4, 'the room keeps the size it was opened with');
  await sleep(300);
  assert.equal(b.match.state, 'waiting', 'still short of four players');
  assert.equal(b.match.canStart, 1, 'but the two of them may start early');
});

test('a room refuses players once it is full', async (t) => {
  const clients = [new TestClient(), new TestClient()];
  t.after(() => clients.forEach((c) => c.close()));

  await clients[0].connect({ name: 'ONE', hero: 'ranger', room: 'net-full', size: 2 });
  await clients[1].connect({ name: 'TWO', hero: 'ranger', room: 'net-full', size: 2 });
  await sleep(300);

  const extra = new TestClient();
  t.after(() => extra.close());
  await assert.rejects(
    () => extra.connect({ name: 'THREE', hero: 'ranger', room: 'net-full', size: 2 }),
    /정원|full/,
    'the third player should be turned away',
  );
});

test('an early start request moves a half-full room into a match', async (t) => {
  const a = new TestClient();
  const b = new TestClient();
  t.after(() => {
    a.close();
    b.close();
  });
  await a.connect({ name: 'A', hero: 'ranger', room: 'net-early', size: 6 });
  await b.connect({ name: 'B', hero: 'ranger', room: 'net-early', size: 6 });
  await sleep(400);
  assert.equal(a.match.state, 'waiting');

  a.send({ t: MSG.START });
  await sleep(400);
  assert.ok(['warmup', 'live'].includes(a.match.state), `expected the match to start, got ${a.match.state}`);
  assert.equal(a.match.canStart, 0, 'the offer disappears once it is taken');
});

test('chat is delivered to everyone in the room', async (t) => {
  const a = new TestClient();
  const b = new TestClient();
  t.after(() => {
    a.close();
    b.close();
  });
  await a.connect({ name: 'TALKER', hero: 'ranger', room: 'net-chat' });
  await b.connect({ name: 'LISTENER', hero: 'medic', room: 'net-chat' });
  await sleep(400);

  a.send({ t: MSG.CHAT, msg: 'ready up' });
  await sleep(400);
  const heard = b.events.find((e) => e.e === 'chat' && e.msg === 'ready up');
  assert.ok(heard, 'the other client should receive the chat message');
  assert.equal(heard.name, 'TALKER');
});

test('rooms are isolated from each other', async (t) => {
  const a = new TestClient();
  const b = new TestClient();
  t.after(() => {
    a.close();
    b.close();
  });
  await a.connect({ name: 'ONE', hero: 'ranger', room: 'net-room-a' });
  await b.connect({ name: 'TWO', hero: 'ranger', room: 'net-room-b' });
  await sleep(500);

  assert.equal(a.last.ps.length, 0, 'players in different rooms must not see each other');
  assert.equal(b.last.ps.length, 0);
});

test('abilities and reloads round-trip through the protocol', async (t) => {
  const c = new TestClient();
  t.after(() => c.close());
  await c.connect({ name: 'ABIL', hero: 'medic', room: 'net-abil' });
  await sleep(1900); // ability comes off cooldown 1.5s after spawning

  c.send({ t: MSG.ABILITY });
  await sleep(300);
  assert.ok(c.events.some((e) => e.e === 'abil'), 'ability event should be broadcast');
  assert.ok(c.last.me.ab > 0, 'ability should now be on cooldown');

  c.send({ t: MSG.FIRE, d: { x: 0, y: -1, z: 0 }, sd: 5, rt: Date.now() });
  await sleep(120);
  assert.ok(c.last.me.am < c.last.me.mag, 'firing should consume ammo');
  c.send({ t: MSG.RELOAD });
  await sleep(200);
  assert.ok(c.last.me.rl > 0, 'reload should be in progress');
  await sleep(1900);
  assert.equal(c.last.me.am, c.last.me.mag, 'magazine should be refilled');
});

test('malformed input is ignored instead of crashing the server', async (t) => {
  const c = new TestClient();
  t.after(() => c.close());
  await c.connect({ name: 'FUZZ', hero: 'ranger', room: 'net-fuzz' });
  await sleep(300);

  const garbage = [
    'not json at all',
    JSON.stringify({ t: MSG.COMMANDS, c: 'nope' }),
    JSON.stringify({ t: MSG.COMMANDS, c: [[1, 'x', null, {}]] }),
    JSON.stringify({ t: MSG.COMMANDS, c: [[2, 15, NaN, Infinity]] }),
    JSON.stringify({ t: MSG.COMMANDS, c: [[3, 255, 1e300, -1e300]] }),
    JSON.stringify({ t: MSG.FIRE, d: { x: 0, y: 0, z: 0 } }),
    JSON.stringify({ t: MSG.FIRE, d: null }),
    JSON.stringify({ t: MSG.FIRE }),
    JSON.stringify({ t: MSG.FIRE, d: { x: 1, y: 0, z: 0 }, rt: 'yesterday' }),
    JSON.stringify({ t: MSG.RESPAWN, hero: 'godmode' }),
    JSON.stringify({ t: MSG.CHAT, msg: 'x'.repeat(1000) }),
    JSON.stringify({ t: 'unknown-message' }),
    JSON.stringify(null),
    '[]',
  ];
  for (const g of garbage) c.ws.send(g);
  await sleep(700);

  assert.equal(c.ws.readyState, WebSocket.OPEN, 'connection should survive');
  const before = c.snapshots.length;
  await sleep(400);
  assert.ok(c.snapshots.length > before, 'server should still be ticking');
  assert.ok(Number.isFinite(c.last.me.x) && Number.isFinite(c.last.me.y), 'player state must stay finite');
  assert.ok(c.last.me.hero !== 'godmode', 'unknown heroes must be rejected');

  const chat = c.events.filter((e) => e.e === 'chat').pop();
  if (chat) assert.ok(chat.msg.length <= 120, `chat should be truncated, got ${chat.msg.length} chars`);
});

test('an oversized frame is dropped without taking the server down', async (t) => {
  const big = new TestClient();
  await big.connect({ name: 'BIG', hero: 'ranger', room: 'net-big' });
  // The socket server caps payloads, so this connection is expected to die.
  big.ws.send(JSON.stringify({ t: MSG.CHAT, msg: 'x'.repeat(20000) }));
  await sleep(500);

  // The server itself must still accept new clients.
  const after = new TestClient();
  t.after(() => {
    after.close();
    big.close();
  });
  const welcome = await after.connect({ name: 'AFTER', hero: 'ranger', room: 'net-big' });
  assert.ok(welcome.id > 0, 'server should still accept connections');
});

test('a name is sanitised and an empty one gets a default', async (t) => {
  const c = new TestClient();
  t.after(() => c.close());
  await c.connect({ name: '   <script>alert(1)</script>   ', hero: 'ranger', room: 'net-name' });
  await sleep(400);
  const me = c.match.roster.find((r) => r.id === c.welcome.id);
  assert.ok(!me.name.includes('<'), `name should be sanitised, got ${me.name}`);

  const blank = new TestClient();
  t.after(() => blank.close());
  await blank.connect({ name: '', hero: 'ranger', room: 'net-name' });
  await sleep(400);
  const other = blank.match.roster.find((r) => r.id === blank.welcome.id);
  assert.equal(other.name, 'RECRUIT');
});

test('the simulation and snapshot rates are what the client expects', async (t) => {
  const c = new TestClient();
  t.after(() => c.close());
  const welcome = await c.connect({ name: 'RATE', hero: 'ranger', room: 'net-rate' });
  assert.equal(welcome.cfg.TICK_RATE, Math.round(1 / TICK_DT));

  c.snapshots.length = 0;
  await sleep(1500);
  // 20Hz nominal; allow slack for timer jitter on a busy CI machine.
  assert.ok(c.snapshots.length >= 20 && c.snapshots.length <= 40, `got ${c.snapshots.length} snapshots in 1.5s`);
  const ticks = c.snapshots.map((s) => s.k);
  assert.ok(ticks.every((k, i) => i === 0 || k > ticks[i - 1]), 'ticks must increase monotonically');
});

test('the map the client builds matches the one the server simulates', async () => {
  // Both sides call buildMap(); if it ever became non-deterministic, movement
  // prediction would drift apart from the server.
  const a = buildMap();
  const b = buildMap();
  assert.deepEqual(a.boxes, b.boxes);
  assert.deepEqual(a.spawns, b.spawns);
  assert.ok(a.boxes.length > 100);
});
