// HTTP + WebSocket entry point.

import http from 'node:http';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { MSG, MAX_PLAYERS, MAX_NAME_LEN, MAX_CHAT_LEN, TICK_RATE, SNAPSHOT_RATE, COMMAND_SEND_RATE, INTERP_DELAY_MS } from '../shared/constants.js';
import { HEROES } from '../shared/heroes.js';
import { Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const BOTS = process.env.BOTS === undefined ? 6 : Number(process.env.BOTS);
const MAX_MESSAGE_BYTES = 4096;

const app = express();
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
// The browser imports the same modules the server simulates with.
app.use('/shared', express.static(path.join(ROOT, 'shared')));

const rooms = new Map();

function getRoom(name) {
  const key = String(name || 'sanctum').toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 20) || 'sanctum';
  let room = rooms.get(key);
  if (!room) {
    room = new Room(key, { bots: Number.isFinite(BOTS) ? BOTS : 6 });
    rooms.set(key, room);
    console.log(`[room] created "${key}"`);
  }
  return room;
}

app.get('/api/status', (req, res) => {
  res.json({
    rooms: [...rooms.values()].map((r) => ({
      name: r.name,
      players: r.humanCount,
      bots: r.count - r.humanCount,
      state: r.state,
      scores: r.scores,
    })),
    heroes: Object.values(HEROES).map((h) => ({ id: h.id, name: h.name, role: h.role })),
    uptime: Math.round(process.uptime()),
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (socket) => {
  let room = null;
  let player = null;
  let msgCount = 0;
  let windowStart = Date.now();

  const fail = (reason) => {
    try {
      socket.send(JSON.stringify({ t: MSG.ERROR, reason }));
    } catch {
      /* ignore */
    }
    socket.close();
  };

  socket.on('message', (raw) => {
    // Crude flood protection: commands arrive ~30/s, so 200/s is generous.
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      msgCount = 0;
    }
    if (++msgCount > 200) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === MSG.JOIN) {
      if (player) return;
      room = getRoom(msg.room);
      if (room.humanCount >= MAX_PLAYERS) {
        fail('This match is full — try another room name.');
        return;
      }
      const name = sanitizeName(msg.name);
      const heroId = HEROES[msg.hero] ? msg.hero : 'ranger';
      player = room.addPlayer({ name, heroId, socket });
      socket.send(
        JSON.stringify({
          t: MSG.WELCOME,
          id: player.id,
          team: player.team,
          hero: player.heroId,
          room: room.name,
          now: Date.now(),
          cfg: { TICK_RATE, SNAPSHOT_RATE, COMMAND_SEND_RATE, INTERP_DELAY_MS },
        }),
      );
      room.broadcast(room.matchInfo());
      console.log(`[join] ${name} (#${player.id}) -> ${room.name} team ${player.team}`);
      return;
    }

    if (!player || !room) return;

    switch (msg.t) {
      case MSG.COMMANDS:
        room.onCommands(player, msg.c);
        if (typeof msg.ping === 'number') player.ping = Math.max(0, Math.min(999, Math.round(msg.ping)));
        break;
      case MSG.FIRE:
        room.onFire(player, msg);
        break;
      case MSG.RELOAD:
        room.onReload(player);
        break;
      case MSG.ABILITY:
        room.onAbility(player);
        break;
      case MSG.RESPAWN:
        room.onRespawnRequest(player, msg.hero);
        break;
      case MSG.CHAT:
        room.onChat(player, String(msg.msg || '').slice(0, MAX_CHAT_LEN));
        break;
      case MSG.PING:
        socket.send(JSON.stringify({ t: MSG.PONG, c: msg.c, now: Date.now() }));
        break;
      default:
        break;
    }
  });

  socket.on('close', () => {
    if (room && player) {
      console.log(`[left] ${player.name} (#${player.id}) from ${room.name}`);
      room.removePlayer(player.id);
      room.broadcast(room.matchInfo());
      // Reclaim empty rooms so long-running servers do not tick forever.
      if (room.humanCount === 0) {
        room.destroy();
        rooms.delete(room.name);
        console.log(`[room] destroyed "${room.name}"`);
      }
    }
    room = null;
    player = null;
  });

  socket.on('error', () => socket.close());
});

function sanitizeName(raw) {
  const name = String(raw || '')
    .replace(/[^\p{L}\p{N} _\-.]/gu, '')
    .trim()
    .slice(0, MAX_NAME_LEN);
  return name || 'RECRUIT';
}

// Binding without a host listens on every interface, so the same process serves
// this machine, the local network and — once deployed behind a proxy — the
// internet. The client always dials back the host that served the page.
server.listen(PORT, () => {
  console.log(`SANCTUM FPS server listening on port ${PORT} (all interfaces)`);
  console.log(`  local   http://localhost:${PORT}`);
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  network http://${a.address}:${PORT}  (${name} — share this with players on your LAN)`);
      }
    }
  }
  console.log(`  bots per match: ${Number.isFinite(BOTS) ? BOTS : 6}`);
});
