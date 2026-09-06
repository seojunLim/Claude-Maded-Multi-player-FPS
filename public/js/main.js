// Menu, settings and boot sequence.

import { HEROES, getHero } from '/shared/heroes.js';
import { ROOM_SIZE_MIN, ROOM_SIZE_MAX, ROOM_SIZE_DEFAULT } from '/shared/constants.js';
import { MODE_LIST, getMode, isModeId, DEFAULT_MODE, recommendedSize } from '/shared/modes.js';
import { MAP_LIST, getMapMeta, isMapId, DEFAULT_MAP, buildMap } from '/shared/map.js';
import { startMenuBackdrop } from './menufx.js';
import { tryStartMenuScene } from './menuscene.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { TouchControls, looksLikeTouchDevice, hasTouchSupport } from './touch.js';

const $ = (id) => document.getElementById(id);
const STORE = 'sanctum.settings.v3';

// Phones and tablets start with on-screen controls, a narrower field of view
// and cheaper rendering. Anything with a mouse starts in mouse mode; a device
// that has both switches live depending on what the player uses.
const TOUCH_DEVICE = looksLikeTouchDevice();
const HAS_TOUCH = hasTouchSupport();

const defaults = {
  name: '',
  hero: 'ranger',
  room: '',
  sens: 1,
  fov: TOUCH_DEVICE ? 80 : 90,
  invertY: false,
  shadows: !TOUCH_DEVICE,
  autoFire: true,
  size: ROOM_SIZE_DEFAULT,
  mode: DEFAULT_MODE,
  // 'random' asks the server to roll a map when it opens the room.
  map: DEFAULT_MAP,
  // Not user facing: tells the renderer to use a mobile budget.
  mobile: TOUCH_DEVICE,
};

const stored = loadSettings();
const settings = Object.assign(defaults, stored, { mobile: TOUCH_DEVICE });
// A player who has never touched the size picker gets whatever their mode is
// tuned for rather than the bare minimum.
if (stored.size === undefined) settings.size = recommendedSize(settings.mode);

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {
    /* private mode — settings just won't persist */
  }
}

/* ------------------------------------------------------- mode & map picks */

// "무작위" is a real option rather than a client-side coin flip: the server
// rolls the map when it opens the room, so everyone who joins agrees.
const RANDOM_MAP = {
  id: 'random',
  name: '무작위',
  tagline: '서버가 고릅니다',
  size: '—',
  desc: '매치가 열릴 때 서버가 전장을 무작위로 고릅니다. 같은 매치에 들어온 모두가 같은 맵을 받습니다.',
};

// Mode accent colours. They drive the tile, its glow and the briefing rule,
// so each mode reads as its own thing at a glance.
const MODE_COLOR = {
  tdm: '#38bdf8',
  ffa: '#fb7185',
  domination: '#5eead4',
  gungame: '#fbbf24',
};

function modeTile(mode) {
  const el = document.createElement('button');
  el.className = 'tile';
  el.type = 'button';
  el.dataset.mode = mode.id;
  el.style.setProperty('--mc', MODE_COLOR[mode.id] || '#38bdf8');
  el.innerHTML = `
    <span class="tile-short">${escapeHtml(mode.short)}</span>
    <span class="tile-icon">${mode.icon}</span>
    <h3>${escapeHtml(mode.name)}</h3>
    <p>${escapeHtml(mode.tagline)}</p>
    <span class="tile-size">${recommendedSize(mode.id)}인 권장</span>`;
  return el;
}

function mapCard(meta) {
  const el = document.createElement('button');
  el.className = 'pick map';
  el.type = 'button';
  el.dataset.map = meta.id;
  el.appendChild(mapThumb(meta));
  const body = document.createElement('div');
  body.className = 'pick-body';
  body.innerHTML = `
    <span class="pick-tag">${escapeHtml(meta.size)}</span>
    <h4>${escapeHtml(meta.name)}</h4>
    <em>${escapeHtml(meta.tagline)}</em>
    <p>${escapeHtml(meta.desc)}</p>`;
  el.appendChild(body);
  return el;
}

/**
 * A top-down thumbnail drawn from the arena's own collision boxes, so the
 * preview can never drift away from the level people actually play.
 */
function mapThumb(meta) {
  const size = 168;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.className = 'thumb';
  const g = c.getContext('2d');
  const theme = meta.theme || {};
  const sky = theme.sky || {};
  g.fillStyle = `#${(sky.mid ?? 0x1a2436).toString(16).padStart(6, '0')}`;
  g.globalAlpha = 0.25;
  g.fillRect(0, 0, size, size);
  g.globalAlpha = 1;

  if (meta.id === 'random') {
    g.fillStyle = 'rgba(226,240,255,0.5)';
    g.font = 'bold 54px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', size / 2, size / 2 + 2);
    return c;
  }

  const map = buildMapPreview(meta.id);
  const scale = size / (map.half * 2);
  for (const b of map.boxes) {
    if (b.max[1] <= 0.25) continue;
    g.globalAlpha = Math.min(0.9, 0.3 + b.max[1] / 14);
    g.fillStyle = '#dbeafe';
    g.fillRect(
      (b.min[0] + map.half) * scale,
      (b.min[2] + map.half) * scale,
      Math.max(1, (b.max[0] - b.min[0]) * scale),
      Math.max(1, (b.max[2] - b.min[2]) * scale),
    );
  }
  g.globalAlpha = 1;
  // Spawn ends, so the two halves read at a glance.
  for (const [i, list] of map.spawns.entries()) {
    g.fillStyle = i === 0 ? '#38bdf8' : '#fb7185';
    for (const sp of list) {
      g.beginPath();
      g.arc((sp.x + map.half) * scale, (sp.z + map.half) * scale, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

// Built once per map and reused: the previews are drawn on every menu open.
const PREVIEW_CACHE = new Map();
function buildMapPreview(id) {
  let m = PREVIEW_CACHE.get(id);
  if (!m) {
    m = buildMap(id);
    PREVIEW_CACHE.set(id, m);
  }
  return m;
}

function renderModes() {
  const wrap = $('modes');
  wrap.innerHTML = '';
  for (const mode of MODE_LIST) wrap.appendChild(modeTile(mode));
  wrap.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    pickMode(tile.dataset.mode);
  });
  markMode();
}

/**
 * Picking a mode also sets the match size to the roster that mode is tuned
 * for — the whole point of choosing "개인전" is a full lobby, and nobody should
 * have to know that. The size buttons stay live for anyone who disagrees.
 */
function pickMode(id, { setSize = true } = {}) {
  settings.mode = isModeId(id) ? id : DEFAULT_MODE;
  if (setSize) {
    const want = recommendedSize(settings.mode);
    const moved = want !== settings.size;
    settings.size = want;
    markSize();
    if (moved) flashSize();
  }
  saveSettings();
  markMode();
  updateLoadout();
}

/** Draws attention to the size slot when a mode pick just changed it. */
function flashSize() {
  const slot = document.querySelector('.sizeslot');
  if (!slot) return;
  slot.classList.remove('auto');
  // Reading offsetWidth restarts the transition when two picks land quickly.
  void slot.offsetWidth;
  slot.classList.add('auto');
  clearTimeout(flashSize.timer);
  flashSize.timer = setTimeout(() => slot.classList.remove('auto'), 1400);
}

function renderMaps() {
  const wrap = $('maps');
  wrap.innerHTML = '';
  for (const meta of [...MAP_LIST, RANDOM_MAP]) wrap.appendChild(mapCard(meta));
  wrap.addEventListener('click', (e) => {
    const card = e.target.closest('.pick');
    if (!card) return;
    settings.map = card.dataset.map;
    saveSettings();
    markMap();
    updateLoadout();
    closeSheet();
  });
  markMap();
}

function markMode() {
  if (!isModeId(settings.mode)) settings.mode = DEFAULT_MODE;
  for (const tile of $('modes').children) tile.classList.toggle('on', tile.dataset.mode === settings.mode);
  renderBrief();
}

/** The rules panel for whichever mode is selected. */
function renderBrief() {
  const mode = getMode(settings.mode);
  const el = $('modebrief');
  el.style.setProperty('--mc', MODE_COLOR[mode.id] || '#38bdf8');
  el.innerHTML = `
    <h3>${escapeHtml(mode.name)}</h3>
    <p class="tagline">${escapeHtml(mode.tagline)}</p>
    <p>${escapeHtml(mode.desc)}</p>
    <ul>${mode.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
      <li>권장 인원 <b>${recommendedSize(mode.id)}명</b> — ${escapeHtml(mode.sizeNote || '')}</li>
    </ul>`;
}

function markMap() {
  if (settings.map !== 'random' && !isMapId(settings.map)) settings.map = DEFAULT_MAP;
  for (const card of $('maps').children) card.classList.toggle('on', card.dataset.map === settings.map);
}

/* ---------------------------------------------------------------- sheets */

/** Slots along the bottom bar open a full-screen sheet; Esc closes it. */
function bindSheets() {
  for (const btn of document.querySelectorAll('[data-open]')) {
    btn.addEventListener('click', () => openSheet(btn.dataset.open));
  }
  for (const sheet of document.querySelectorAll('.sheet')) {
    sheet.addEventListener('click', (e) => {
      // Click the backdrop or the ✕, not the panel itself.
      if (e.target === sheet || e.target.closest('.sheet-close')) closeSheet();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('menu').classList.contains('hidden')) closeSheet();
  });
}

function openSheet(name) {
  for (const sheet of document.querySelectorAll('.sheet')) {
    sheet.classList.toggle('hidden', sheet.dataset.sheet !== name);
  }
  if (name === 'rooms') refreshRooms();
  if (name === 'setup') $('nameinput').focus();
}

function closeSheet() {
  for (const sheet of document.querySelectorAll('.sheet')) sheet.classList.add('hidden');
}

// Set once the menu is bound; the pickers call it so the share link keeps up.
let shareUpdater = () => {};

/** The bottom bar always shows exactly what the play button will launch. */
function updateLoadout() {
  shareUpdater();
  const mode = getMode(settings.mode);
  const map = settings.map === 'random' ? RANDOM_MAP : getMapMeta(settings.map);
  const hero = getHero(settings.hero);

  $('slot-hero').textContent = hero.name;
  $('slot-herorole').textContent = hero.role;
  $('slot-map').textContent = map.name;
  $('slot-mapsize').textContent = map.size;
  const thumb = $('slot-mapthumb');
  thumb.innerHTML = '';
  thumb.appendChild(mapThumb(map));
  $('callsigntag').textContent = settings.name || 'RECRUIT';
  $('launchsummary').innerHTML =
    `<b>${escapeHtml(mode.name)}</b> · ${escapeHtml(map.name)} · ${escapeHtml(hero.name)} · ${settings.size}명`;

  // Keep the live backdrop on whatever is selected. A random map has nothing
  // specific to show, so the preview just stays on the last real one.
  if (menuScene) {
    if (settings.map !== 'random') menuScene.setMap(settings.map);
    menuScene.setHero(settings.hero);
  }
}

/* ------------------------------------------------------------- hero cards */

function heroCard(hero) {
  const el = document.createElement('button');
  el.className = 'hero';
  el.type = 'button';
  el.dataset.hero = hero.id;
  el.style.setProperty('--hc', `#${hero.color.toString(16).padStart(6, '0')}`);
  const w = hero.weapon;
  const rpm = Math.round(60000 / w.interval);
  el.innerHTML = `
    <span class="badge">${hero.role}</span>
    <h4>${hero.name}</h4>
    <p>${hero.blurb}</p>
    <div class="stat"><span>체력</span><b>${hero.hp}</b></div>
    <div class="stat"><span>무기</span><b>${w.name}</b></div>
    <div class="stat"><span>피해 / 발사속도</span><b>${w.pellets > 1 ? `${w.damage}×${w.pellets}` : w.damage} / ${rpm}rpm</b></div>
    <div class="stat"><span>이동 속도</span><b>${hero.speed.toFixed(1)} m/s</b></div>
    <div class="abil"><b>${hero.ability.key} · ${hero.ability.name}</b><br>${hero.ability.desc}</div>`;
  return el;
}

function renderHeroes() {
  const wrap = $('heroes');
  wrap.innerHTML = '';
  for (const hero of Object.values(HEROES)) wrap.appendChild(heroCard(hero));
  wrap.addEventListener('click', (e) => {
    const card = e.target.closest('.hero');
    if (!card) return;
    settings.hero = card.dataset.hero;
    saveSettings();
    markHero();
    updateLoadout();
    closeSheet();
  });
  markHero();
}

function markHero() {
  for (const card of $('heroes').children) {
    card.classList.toggle('on', card.dataset.hero === settings.hero);
  }
}

/* ------------------------------------------------------------- match size */

function renderSizePicker() {
  const wrap = $('sizebtns');
  wrap.innerHTML = '';
  for (let n = ROOM_SIZE_MIN; n <= ROOM_SIZE_MAX; n++) {
    const b = document.createElement('button');
    b.className = 'sizebtn';
    b.type = 'button';
    b.dataset.size = String(n);
    b.textContent = String(n);
    wrap.appendChild(b);
  }
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.sizebtn');
    if (!btn) return;
    settings.size = Number(btn.dataset.size);
    saveSettings();
    markSize();
    updateLoadout();
  });
  markSize();
}

function markSize() {
  for (const b of $('sizebtns').children) {
    b.classList.toggle('on', Number(b.dataset.size) === settings.size);
  }
  const mode = getMode(settings.mode);
  if (settings.size === recommendedSize(mode.id)) {
    $('sizenote').textContent = `${mode.name} 권장 인원`;
    return;
  }
  // The size only applies to a match this player creates; an existing room
  // keeps whatever it was opened with.
  $('sizenote').textContent =
    settings.size === ROOM_SIZE_MIN
      ? '2명이 모이면 바로 시작'
      : `${settings.size}명이 모이면 시작 · 덜 모여도 바로 시작 가능`;
}

/* --------------------------------------------------------------- controls */

/** Applies device-specific labels, defaults and the rotate-your-phone hint. */
function setUpDevice() {
  document.body.classList.toggle('can-touch', HAS_TOUCH);
  if (TOUCH_DEVICE) {
    $('keyhelp-pc').classList.add('hidden');
    $('keyhelp-touch').classList.remove('hidden');
    document.querySelector('.sens-label').textContent = '조준 감도';
    document.querySelector('.sb-foot').textContent = '순위 · 채팅 버튼은 화면 왼쪽 위에 있습니다';
  }

  // Landscape is close to mandatory in game: the controls live in the bottom
  // corners. The menu itself scrolls fine in portrait, so only nag once the
  // match has started.
  const rotate = $('rotate');
  const update = () => {
    const portrait = window.innerHeight > window.innerWidth;
    const inGame = $('menu').classList.contains('hidden');
    rotate.classList.toggle('hidden', !(TOUCH_DEVICE && portrait && inGame));
  };
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 250));
  update();
  return update;
}

const updateOrientationHint = setUpDevice();

/** Best-effort fullscreen + landscape lock; both are optional on iOS. */
async function goImmersive() {
  if (!TOUCH_DEVICE) return;
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  } catch {
    /* user or browser declined — the game still works */
  }
  try {
    await screen.orientation?.lock?.('landscape');
  } catch {
    /* unsupported on iOS Safari; the rotate hint covers it */
  }
}

function bindMenu() {
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room');
  // A shared link can carry the whole setup, not just the match code.
  if (isModeId(params.get('mode'))) {
    // A link that names a mode brings its roster along, unless it says otherwise.
    settings.mode = params.get('mode');
    settings.size = recommendedSize(settings.mode);
  }
  const mapParam = params.get('map');
  if (mapParam === 'random' || isMapId(mapParam)) settings.map = mapParam;
  const sizeParam = Number(params.get('size'));
  if (Number.isFinite(sizeParam) && sizeParam >= ROOM_SIZE_MIN && sizeParam <= ROOM_SIZE_MAX) {
    settings.size = Math.round(sizeParam);
  }

  $('nameinput').value = settings.name;
  $('roominput').value = roomParam || settings.room;
  $('sens').value = settings.sens;
  $('fov').value = settings.fov;
  $('invertY').checked = settings.invertY;
  $('shadows').checked = settings.shadows;
  $('autofire').checked = settings.autoFire;
  $('sensval').textContent = Number(settings.sens).toFixed(2);
  $('fovval').textContent = settings.fov;

  $('sens').addEventListener('input', (e) => {
    settings.sens = Number(e.target.value);
    $('sensval').textContent = settings.sens.toFixed(2);
    saveSettings();
  });
  $('fov').addEventListener('input', (e) => {
    settings.fov = Number(e.target.value);
    $('fovval').textContent = settings.fov;
    saveSettings();
  });
  $('invertY').addEventListener('change', (e) => {
    settings.invertY = e.target.checked;
    saveSettings();
  });
  $('shadows').addEventListener('change', (e) => {
    settings.shadows = e.target.checked;
    saveSettings();
  });
  $('autofire').addEventListener('change', (e) => {
    settings.autoFire = e.target.checked;
    saveSettings();
  });

  const updateShare = () => {
    const room = ($('roominput').value || 'sanctum').trim();
    const q = new URLSearchParams({ room, mode: settings.mode, map: settings.map, size: String(settings.size) });
    $('sharelink').textContent = `${location.origin}/?${q}`;
  };
  shareUpdater = updateShare;
  $('roominput').addEventListener('input', updateShare);
  updateShare();

  $('play').addEventListener('click', () => startGame());
  $('nameinput').addEventListener('input', () => {
    $('callsigntag').textContent = $('nameinput').value.trim() || 'RECRUIT';
  });
  $('nameinput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startGame();
  });
  $('roominput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startGame();
  });

  markMode();
  markMap();
  updateLoadout();
  refreshRooms();
  // With no bots to fill seats, finding the other players is the whole game,
  // so the list keeps itself current while the menu is open.
  setInterval(() => {
    if (!$('menu').classList.contains('hidden')) refreshRooms();
  }, 5000);
}

const STATE_LABEL = {
  waiting: '대기 중',
  warmup: '곧 시작',
  live: '진행 중',
  over: '종료',
};

async function refreshRooms() {
  const list = $('roomlist');
  try {
    const s = await (await fetch('/api/status')).json();
    const rooms = s.rooms.filter((r) => r.players > 0).sort((a, b) => b.players - a.players);
    const total = s.rooms.reduce((n, r) => n + r.players, 0);
    $('serverinfo').textContent = `서버 정상 · 접속자 ${total}명`;
    $('slot-rooms').textContent = rooms.length;

    if (!rooms.length) {
      list.innerHTML =
        '<p class="small">아직 아무도 없습니다. 매치 코드를 정하고 위 주소를 친구에게 보내세요.</p>';
      return;
    }
    list.innerHTML = '';
    for (const r of rooms) {
      const row = document.createElement('button');
      row.className = 'roomrow';
      row.type = 'button';
      row.dataset.room = r.name;
      const bots = r.bots ? ` <span class="rstate">+봇 ${r.bots}</span>` : '';
      const full = r.players >= r.size;
      row.innerHTML =
        `<span class="rname">${escapeHtml(r.name)}</span>` +
        `<span class="rmode">${escapeHtml(r.modeName || '')} · ${escapeHtml(r.mapName || '')}</span>` +
        `<span class="rcount">${r.players}/${r.size}명</span>${bots}` +
        `<span class="rstate">${full ? '정원 초과' : STATE_LABEL[r.state] || ''}</span>`;
      row.disabled = full;
      row.addEventListener('click', () => {
        $('roominput').value = r.name;
        $('roominput').dispatchEvent(new Event('input'));
        closeSheet();
        startGame();
      });
      list.appendChild(row);
    }
  } catch {
    list.innerHTML = '<p class="small">매치 목록을 불러오지 못했습니다.</p>';
    $('serverinfo').textContent = '서버 상태를 확인할 수 없습니다.';
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------- boot */

let game = null;

async function startGame() {
  if (game) return;
  const btn = $('play');
  btn.disabled = true;
  $('menustatus').textContent = '';

  settings.name = $('nameinput').value.trim();
  settings.room = $('roominput').value.trim();
  saveSettings();

  const sfx = new Sfx();
  sfx.init(); // must happen inside the click handler

  // One WebGL context at a time: the preview hands the GPU to the match.
  if (menuScene) {
    menuScene.dispose();
    menuScene = null;
    $('menuscene').classList.add('hidden');
  }

  const canvas = $('scene');
  const net = new Net();
  const hud = new Hud();
  const input = new Input(canvas, {
    sensitivity: settings.sens,
    touchSensitivity: settings.sens,
    invertY: settings.invertY,
  });

  // The on-screen controls stay hidden until a finger actually touches the
  // screen, so they never get in a mouse player's way.
  const touch = new TouchControls($('touch'), input);
  input.attachTouch(touch);
  if (TOUCH_DEVICE) {
    input.touchMode = true;
    touch.enable();
    goImmersive();
  }

  $('loading').classList.remove('hidden');
  try {
    const welcome = await net.connect({
      name: settings.name,
      hero: settings.hero,
      room: settings.room,
      size: settings.size,
      // Only honoured if this join is what opens the room; an existing match
      // keeps the rules it was created with, and `welcome` says which.
      mode: settings.mode,
      map: settings.map,
    });

    game = new Game({ canvas, net, welcome, hud, sfx, input, settings });
    window.__game = game; // handy for debugging from the console
    input.reset(welcome.team === 0 ? 0 : Math.PI, 0);
    $('menu').classList.add('hidden');
    $('loading').classList.add('hidden');
    game.start();
    input.requestLock();
    updateOrientationHint();

    net.on('close', () => {
      game?.stop();
      game = null;
      document.body.classList.remove('playing');
      $('hud').classList.add('hidden');
      $('menu').classList.remove('hidden');
      $('menustatus').textContent = '서버와의 연결이 끊어졌습니다. 다시 참가해 주세요.';
      btn.disabled = false;
      updateOrientationHint();
    });

    // Clicking the canvas re-captures the mouse after Esc.
    canvas.addEventListener('click', () => {
      if (!input.typing) input.requestLock();
    });
  } catch (err) {
    $('loading').classList.add('hidden');
    $('menustatus').textContent = err.message || '접속에 실패했습니다.';
    btn.disabled = false;
    net.close();
  }
}

// The main screen's backdrop is the real renderer showing the real arena. If
// this browser will not give us a WebGL context for it, fall back to the 2D
// one rather than leaving the screen flat.
let menuScene = tryStartMenuScene($('menuscene'), { mobile: TOUCH_DEVICE });
if (menuScene) {
  menuScene.setMap(settings.map === 'random' ? DEFAULT_MAP : settings.map);
  menuScene.setHero(settings.hero);
  menuScene.start();
  window.__menuScene = menuScene; // handy for debugging from the console
} else {
  $('menuscene').classList.add('hidden');
  $('menufx').classList.remove('hidden');
  startMenuBackdrop($('menufx'), { reduced: TOUCH_DEVICE });
}

renderModes();
renderMaps();
renderHeroes();
renderSizePicker();
bindSheets();
bindMenu();
