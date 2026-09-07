// HTTP + WebSocket entry point.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import {
  MSG,
  MAX_NAME_LEN,
  MAX_CHAT_LEN,
  TICK_RATE,
  SNAPSHOT_RATE,
  COMMAND_SEND_RATE,
  INTERP_DELAY_MS,
  ROOM_SIZE_MIN,
  ROOM_SIZE_MAX,
} from '../shared/constants.js';
import { HEROES } from '../shared/heroes.js';
import { MAP_LIST } from '../shared/map.js';
import { MODE_LIST } from '../shared/modes.js';
import { Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
// Humans only by default. Set BOTS=n to fill empty slots with practice bots.
const BOTS = process.env.BOTS === undefined ? 0 : Number(process.env.BOTS);
const MAX_MESSAGE_BYTES = 4096;

const app = express();

/**
 * The absolute origin this request arrived on. Canonical, Open Graph and
 * sitemap URLs all have to be absolute, and the same build serves localhost,
 * the Render subdomain and any custom domain — so it is derived per request
 * rather than configured. Render terminates TLS at its proxy, which is why the
 * original scheme has to come from x-forwarded-proto.
 */
function siteOrigin(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

// index.html carries %ORIGIN% placeholders; fill them in on the way out. Read
// once at boot — it is a static file and the process is restarted on deploy.
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

app.get(['/', '/index.html'], (req, res) => {
  res.type('html').send(INDEX_HTML.replaceAll('%ORIGIN%', siteOrigin(req)));
});

app.get('/robots.txt', (req, res) => {
  // Yeti is Naver's crawler. The API is live state, not a document, so it is
  // kept out of the index.
  res.type('text/plain').send(
    ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${siteOrigin(req)}/sitemap.xml`, ''].join('\n'),
  );
});

app.get('/sitemap.xml', (req, res) => {
  const origin = siteOrigin(req);
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`,
  );
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
// The browser imports the same modules the server simulates with.
app.use('/shared', express.static(path.join(ROOT, 'shared')));

const rooms = new Map();

/**
 * Rooms are created by whoever gets there first, and their match size is fixed
 * for the life of the room — later arrivals join the match as it was set up
 * rather than resizing it under the people already waiting.
 */
function getRoom({ name, size, mode, map }) {
  const key = String(name || 'sanctum').toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 20) || 'sanctum';
  let room = rooms.get(key);
  if (!room) {
    room = new Room(key, { bots: Number.isFinite(BOTS) ? BOTS : 0, size, mode, map });
    rooms.set(key, room);
    console.log(`[room] created "${key}" — ${room.mode.name} on ${room.map.name} for ${room.size} players`);
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
      size: r.size,
      scores: r.scores,
      mode: r.mode.id,
      modeName: r.mode.name,
      map: r.mapId,
      mapName: r.map.name,
    })),
    heroes: Object.values(HEROES).map((h) => ({ id: h.id, name: h.name, role: h.role })),
    modes: MODE_LIST.map((m) => ({ id: m.id, name: m.name, short: m.short })),
    maps: MAP_LIST.map((m) => ({ id: m.id, name: m.name, size: m.size })),
    roomSize: { min: ROOM_SIZE_MIN, max: ROOM_SIZE_MAX },
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
      room = getRoom({ name: msg.room, size: msg.size, mode: msg.mode, map: msg.map });
      if (room.humanCount >= room.size) {
        fail(`이 매치는 정원(${room.size}명)이 찼습니다. 다른 매치 코드를 사용해 주세요.`);
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
          size: room.size,
          mode: room.mode.id,
          map: room.mapId,
          now: Date.now(),
          cfg: { TICK_RATE, SNAPSHOT_RATE, COMMAND_SEND_RATE, INTERP_DELAY_MS },
        }),
      );
      room.broadcast(room.matchInfo());
      console.log(`[join] ${name} (#${player.id}) -> ${room.name} (${room.mode.short}/${room.map.name}) team ${player.team}`);
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
      case MSG.START:
        room.onStartRequest(player);
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
  const bots = Number.isFinite(BOTS) ? BOTS : 0;
  console.log(`  bots per match: ${bots}${bots === 0 ? ' (humans only)' : ' (practice)'}`);
});
