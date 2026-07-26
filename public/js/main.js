// Menu, settings and boot sequence.

import { HEROES } from '/shared/heroes.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Hud } from './hud.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const STORE = 'sanctum.settings.v1';

const settings = Object.assign(
  { name: '', hero: 'ranger', room: '', sens: 1, fov: 90, invertY: false, shadows: true },
  loadSettings(),
);

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

function bindMenu() {
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room');

  $('nameinput').value = settings.name;
  $('roominput').value = roomParam || settings.room;
  $('sens').value = settings.sens;
  $('fov').value = settings.fov;
  $('invertY').checked = settings.invertY;
  $('shadows').checked = settings.shadows;
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

  fetch('/api/status')
    .then((r) => r.json())
    .then((s) => {
      const total = s.rooms.reduce((n, r) => n + r.players, 0);
      $('serverinfo').textContent = `서버 정상 · 접속자 ${total}명 · 진행 중인 매치 ${s.rooms.length}개`;
    })
    .catch(() => {
      $('serverinfo').textContent = '서버 상태를 확인할 수 없습니다.';
    });
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
  const input = new Input(canvas, { sensitivity: settings.sens, invertY: settings.invertY });

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

    net.on('close', () => {
      game?.stop();
      game = null;
      document.body.classList.remove('playing');
      $('hud').classList.add('hidden');
      $('menu').classList.remove('hidden');
      $('menustatus').textContent = '서버와의 연결이 끊어졌습니다. 다시 참가해 주세요.';
      btn.disabled = false;
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
