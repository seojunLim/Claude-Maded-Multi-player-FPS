// Menu, settings and boot sequence.

import { HEROES } from '/shared/heroes.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { TouchControls, looksLikeTouchDevice, hasTouchSupport } from './touch.js';

const $ = (id) => document.getElementById(id);
const STORE = 'sanctum.settings.v2';

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
  // Not user facing: tells the renderer to use a mobile budget.
  mobile: TOUCH_DEVICE,
};

const settings = Object.assign(defaults, loadSettings(), { mobile: TOUCH_DEVICE });

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
  });
  markHero();
}

function markHero() {
  for (const card of $('heroes').children) {
    card.classList.toggle('on', card.dataset.hero === settings.hero);
  }
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
    $('sharelink').textContent = `${location.origin}/?room=${encodeURIComponent(room)}`;
  };
  $('roominput').addEventListener('input', updateShare);
  updateShare();

  $('play').addEventListener('click', () => startGame());
  $('nameinput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startGame();
  });
  $('roominput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startGame();
  });

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
    $('serverinfo').textContent = `서버 정상 · 접속자 ${total}명 · 진행 중인 매치 ${rooms.length}개`;

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
      row.innerHTML =
        `<span class="rname">${escapeHtml(r.name)}</span>` +
        `<span class="rcount">${r.players}명</span>${bots}` +
        `<span class="rstate">${STATE_LABEL[r.state] || ''}</span>`;
      row.addEventListener('click', () => {
        $('roominput').value = r.name;
        $('roominput').dispatchEvent(new Event('input'));
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

renderHeroes();
bindMenu();
