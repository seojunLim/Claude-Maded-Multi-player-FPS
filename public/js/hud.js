// All DOM/HUD updates live here so the render loop only pushes numbers in.

import { TEAMS, MATCH_STATE, SCORE_LIMIT } from '/shared/constants.js';
import { HEROES, getHero } from '/shared/heroes.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      crosshair: $('crosshair'),
      chT: document.querySelector('.ch-t'),
      chB: document.querySelector('.ch-b'),
      chL: document.querySelector('.ch-l'),
      chR: document.querySelector('.ch-r'),
      hitmarker: $('hitmarker'),
      scope: $('scope'),
      score0: $('score0'),
      score1: $('score1'),
      timer: $('timer'),
      matchstate: $('matchstate'),
      killfeed: $('killfeed'),
      chatlog: $('chatlog'),
      heroname: $('heroname'),
      herorole: $('herorole'),
      hpfill: $('hpfill'),
      hpnum: $('hpnum'),
      ability: $('ability'),
      abilcool: $('abilcool'),
      abilname: $('abilname'),
      weaponname: $('weaponname'),
      ammonow: $('ammonow'),
      ammomax: $('ammomax'),
      reloadhint: $('reloadhint'),
      reloadbar: $('reloadbar'),
      reloadfill: $('reloadbar').firstElementChild,
      vignette: $('dmgvignette'),
      dmgdirs: $('dmgdirs'),
      killbanner: $('killbanner'),
      streakbanner: $('streakbanner'),
      deadscreen: $('deadscreen'),
      deadby: $('deadby'),
      respawnnum: $('respawnnum'),
      deadheroes: $('deadheroes'),
      respawnbtn: $('respawnbtn'),
      scoreboard: $('scoreboard'),
      sb0: $('sb0'),
      sb1: $('sb1'),
      sbScore: $('sb-score'),
      matchover: $('matchover'),
      moResult: $('mo-result'),
      moScore: $('mo-score'),
      moMvp: $('mo-mvp'),
      chatinput: $('chatinput'),
      chatfield: $('chatfield'),
      chatsend: $('chatsend'),
      touch: $('touch'),
      waiting: $('waiting'),
      waitcount: $('waitcount'),
      waitlink: $('waitlink'),
      waitcopy: $('waitcopy'),
      startnow: $('startnow'),
      fps: $('fps'),
      ping: $('pingtag'),
      lockhint: $('lockhint'),
    };
    this.selfId = 0;
    this.selfTeam = 0;
    this.roster = new Map();
    this.hitTimer = 0;
    this.lastHp = 0;
    this.roomName = '';
    this.buildHeroButtons();
    this.bindCopyLink();
  }

  show() {
    this.el.hud.classList.remove('hidden');
  }

  setSelf(id, team) {
    this.selfId = id;
    this.selfTeam = team;
  }

  /* ------------------------------------------------------------ vitals */

  /** The hero actually in play right now — drives the whole vitals panel. */
  setHero(heroId) {
    const hero = getHero(heroId);
    this.el.heroname.textContent = hero.name;
    this.el.herorole.textContent = hero.role;
    this.el.weaponname.textContent = hero.weapon.name;
    this.el.abilname.textContent = hero.ability.name;
    this.el.ability.style.setProperty('--hc', `#${hero.color.toString(16).padStart(6, '0')}`);
    this.currentHero = heroId;
    this.pendingHero = null;
    this.highlightHero(heroId);
  }

  /**
   * A hero picked from the death screen only takes effect on respawn, so this
   * highlights the choice without pretending the swap already happened.
   */
  markPendingHero(heroId) {
    this.pendingHero = heroId;
    this.highlightHero(heroId);
    const hero = getHero(heroId);
    this.el.deadby.textContent = heroId === this.currentHero ? this.el.deadby.textContent : `부활 시 ${hero.name} 으로 교체`;
  }

  highlightHero(heroId) {
    for (const btn of this.el.deadheroes.children) {
      btn.classList.toggle('on', btn.dataset.hero === heroId);
    }
  }

  vitals(me) {
    const hero = getHero(me.hero);
    const frac = Math.max(0, Math.min(1, me.hp / me.mhp));
    this.el.hpfill.style.width = `${frac * 100}%`;
    this.el.hpfill.classList.toggle('low', frac < 0.35);
    this.el.hpnum.textContent = Math.max(0, Math.ceil(me.hp));

    this.el.ammonow.textContent = me.am;
    this.el.ammomax.textContent = `/${me.mag}`;
    this.el.ammonow.classList.toggle('low', me.am <= Math.max(1, me.mag * 0.25));

    const reloading = me.rl > 0;
    this.el.reloadbar.classList.toggle('hidden', !reloading);
    if (reloading) {
      const total = hero.weapon.reload;
      this.el.reloadfill.style.width = `${Math.max(0, Math.min(1, 1 - me.rl / total)) * 100}%`;
    }
    this.el.reloadhint.classList.toggle('hidden', reloading || me.am > 0 || !me.al);

    const ready = me.ab <= 0;
    const active = me.abu > 0;
    this.el.ability.classList.toggle('ready', ready && !active);
    this.el.ability.classList.toggle('active', active);
    const cd = hero.ability.cooldown;
    this.el.abilcool.style.height = `${ready ? 0 : Math.min(100, (me.ab / cd) * 100)}%`;

    if (me.hp < this.lastHp - 0.5) this.flashDamage();
    this.lastHp = me.hp;
  }

  crosshairSpread(spread, zoom, enemyUnderCursor) {
    const gap = Math.round(4 + spread * 340);
    this.el.chT.style.top = `${-gap - 8}px`;
    this.el.chB.style.top = `${gap}px`;
    this.el.chL.style.left = `${-gap - 8}px`;
    this.el.chR.style.left = `${gap}px`;
    this.el.crosshair.classList.toggle('enemy', !!enemyUnderCursor);
    this.el.crosshair.style.opacity = zoom ? '0.25' : '1';
  }

  setScope(on) {
    this.el.scope.classList.toggle('hidden', !on);
  }

  /* ---------------------------------------------------------- feedback */

  hitmarker(kill) {
    const el = this.el.hitmarker;
    el.classList.remove('on', 'kill');
    // Force a reflow so repeated hits restart the animation.
    void el.offsetWidth;
    el.classList.add('on');
    if (kill) el.classList.add('kill');
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => el.classList.remove('on'), 90);
  }

  flashDamage() {
    this.el.vignette.style.transition = 'none';
    this.el.vignette.style.opacity = '0.7';
    requestAnimationFrame(() => {
      this.el.vignette.style.transition = 'opacity 0.5s ease';
      this.el.vignette.style.opacity = '0';
    });
  }

  damageFrom(angle) {
    const el = document.createElement('div');
    el.className = 'dmgdir';
    el.style.transform = `rotate(${angle}rad)`;
    el.innerHTML = '<i></i>';
    this.el.dmgdirs.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = '0'));
    setTimeout(() => el.remove(), 700);
  }

  banner(text, streak = false) {
    const el = streak ? this.el.streakbanner : this.el.killbanner;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('on'), streak ? 1800 : 1300);
  }

  /* ---------------------------------------------------------- killfeed */

  killfeed(ev) {
    const row = document.createElement('div');
    row.className = 'kf';
    const mine = ev.killer === this.selfId || ev.victim === this.selfId;
    if (mine) row.classList.add('mine');
    row.style.borderLeftColor = TEAMS[ev.killerTeam]?.cssColor ?? '#888';

    const killer = ev.killer
      ? `<span class="n${ev.killerTeam}">${escapeHtml(ev.killerName)}</span>`
      : '<span class="w">사고</span>';
    const hs = ev.head ? '<span class="hs">◎</span>' : '';
    row.innerHTML = `${killer} <span class="w">${escapeHtml(ev.weapon)}</span> ${hs} <span class="w">▸</span> <span class="n${ev.victimTeam}">${escapeHtml(ev.victimName)}</span>`;
    this.el.killfeed.appendChild(row);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
    setTimeout(() => {
      row.classList.add('fade');
      setTimeout(() => row.remove(), 600);
    }, 6000);
  }

  chat(ev) {
    const row = document.createElement('div');
    row.className = 'cm';
    if (ev.system) {
      row.classList.add('sys');
      row.textContent = ev.msg;
    } else {
      row.innerHTML = `<span class="a${ev.team}">${escapeHtml(ev.name)}</span>: ${escapeHtml(ev.msg)}`;
    }
    this.el.chatlog.appendChild(row);
    while (this.el.chatlog.children.length > 6) this.el.chatlog.firstChild.remove();
    setTimeout(() => {
      row.style.opacity = '0';
      setTimeout(() => row.remove(), 700);
    }, 12000);
  }

  /* ------------------------------------------------------ match / dead */

  buildHeroButtons() {
    this.el.deadheroes.innerHTML = '';
    for (const hero of Object.values(HEROES)) {
      const b = document.createElement('button');
      b.className = 'dh';
      b.dataset.hero = hero.id;
      b.style.setProperty('--hc', `#${hero.color.toString(16).padStart(6, '0')}`);
      b.innerHTML = `${hero.name}<br><span style="font-size:9px;opacity:.6">${hero.role}</span>`;
      this.el.deadheroes.appendChild(b);
    }
  }

  onHeroPick(fn) {
    this.el.deadheroes.addEventListener('click', (e) => {
      const btn = e.target.closest('.dh');
      if (btn) fn(btn.dataset.hero);
    });
  }

  onRespawn(fn) {
    this.el.respawnbtn.addEventListener('click', fn);
  }

  showDead(byName, respawnIn) {
    this.el.deadscreen.classList.remove('hidden');
    this.el.touch?.classList.add('dead');
    this.el.deadby.textContent = byName ? `${byName} 에게 제거됨` : '제거됨';
    this.el.respawnnum.textContent = Math.ceil(respawnIn / 1000);
  }

  updateRespawn(ms) {
    this.el.respawnnum.textContent = Math.max(0, Math.ceil(ms / 1000)) || '↻';
  }

  hideDead() {
    this.el.deadscreen.classList.add('hidden');
    this.el.touch?.classList.remove('dead');
  }

  match(info) {
    this.el.score0.textContent = info.scores[0];
    this.el.score1.textContent = info.scores[1];
    this.el.sbScore.innerHTML = `<span style="color:${TEAMS[0].cssColor}">${info.scores[0]}</span> : <span style="color:${TEAMS[1].cssColor}">${info.scores[1]}</span>`;
    const label = {
      [MATCH_STATE.WAITING]: '플레이어 대기 중',
      [MATCH_STATE.WARMUP]: '곧 시작',
      [MATCH_STATE.LIVE]: `선착 ${SCORE_LIMIT}킬`,
      [MATCH_STATE.OVER]: '경기 종료',
    };
    this.matchState = info.state;
    this.el.matchstate.textContent = label[info.state] || '';
    this.roster = new Map(info.roster.map((r) => [r.id, r]));
    this.renderScoreboard(info);

    if (info.state === MATCH_STATE.OVER) this.showMatchOver(info);
    else this.el.matchover.classList.add('hidden');

    this.setWaiting(info);
  }

  /** The lobby panel shown while a room does not have enough real players. */
  setWaiting(info) {
    const waiting = info.state === MATCH_STATE.WAITING;
    this.el.waiting.classList.toggle('hidden', !waiting);
    if (!waiting) return;
    const have = info.humans ?? 0;
    const need = info.need ?? 2;
    this.el.waitcount.textContent = `${have} / ${need}명`;
    if (!this.el.waitlink.textContent) {
      this.el.waitlink.textContent = `${location.origin}/?room=${encodeURIComponent(this.roomName || '')}`;
    }
    // Offered once there are enough people to fight, but before the room fills.
    this.el.startnow.classList.toggle('hidden', !info.canStart);
    // Touch players tap the button; on a mouse the pointer is locked to the
    // canvas, so the key is the only way to reach this without pressing Esc.
    const key = document.body.classList.contains('touch-mode') ? '' : ' (F)';
    this.el.startnow.textContent = `${have}명으로 지금 시작${key}`;
  }

  onStartNow(fn) {
    this.el.startnow.addEventListener('click', fn);
  }

  setRoomName(name) {
    this.roomName = name;
    this.el.waitlink.textContent = `${location.origin}/?room=${encodeURIComponent(name)}`;
  }

  bindCopyLink() {
    this.el.waitcopy.addEventListener('click', async () => {
      const link = this.el.waitlink.textContent;
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        // Clipboard access can be denied (insecure origin, permissions) — fall
        // back to selecting the text so it can be copied by hand.
        const range = document.createRange();
        range.selectNodeContents(this.el.waitlink);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      this.el.waitcopy.classList.add('done');
      this.el.waitcopy.textContent = '복사됨';
      setTimeout(() => {
        this.el.waitcopy.classList.remove('done');
        this.el.waitcopy.textContent = '복사';
      }, 1600);
    });
  }

  setClock(ms) {
    // Nothing is counting down while a room waits for players.
    if (this.matchState === MATCH_STATE.WAITING) {
      this.el.timer.textContent = '--:--';
      return;
    }
    const s = Math.max(0, Math.floor(ms / 1000));
    this.el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  renderScoreboard(info) {
    for (const team of [0, 1]) {
      const rows = info.roster
        .filter((r) => r.team === team)
        .sort((a, b) => b.k - a.k || b.dmg - a.dmg);
      const body = team === 0 ? this.el.sb0 : this.el.sb1;
      body.innerHTML = rows
        .map((r) => {
          const hero = getHero(r.hero);
          return `<tr class="${r.id === this.selfId ? 'me' : ''}">
            <td>${escapeHtml(r.name)}${r.bot ? '<span class="bot">BOT</span>' : ''}</td>
            <td class="hero">${hero.name}</td><td>${r.k}</td><td>${r.d}</td><td>${r.dmg}</td><td>${r.bot ? '—' : r.ping}</td>
          </tr>`;
        })
        .join('');
    }
  }

  showMatchOver(info) {
    const mine = info.scores[this.selfTeam];
    const theirs = info.scores[1 - this.selfTeam];
    this.el.matchover.classList.remove('hidden');
    const win = mine > theirs;
    this.el.moResult.textContent = mine === theirs ? '무승부' : win ? '승리' : '패배';
    this.el.moResult.className = mine === theirs ? '' : win ? 'win' : 'lose';
    this.el.moScore.textContent = `${info.scores[0]} : ${info.scores[1]}`;
    const mvp = [...info.roster].sort((a, b) => b.k - a.k || b.dmg - a.dmg)[0];
    if (mvp) {
      this.el.moMvp.innerHTML = `MVP — <b style="color:${TEAMS[mvp.team].cssColor}">${escapeHtml(mvp.name)}</b> · ${mvp.k} KILLS · ${mvp.dmg} DMG`;
    }
    return win;
  }

  toggleScoreboard(on) {
    this.el.scoreboard.classList.toggle('hidden', !on);
  }

  /* -------------------------------------------------------------- misc */

  openChat() {
    this.el.chatinput.classList.remove('hidden');
    this.el.chatfield.value = '';
    this.el.chatfield.focus();
  }

  closeChat() {
    this.el.chatinput.classList.add('hidden');
    this.el.chatfield.blur();
    return this.el.chatfield.value.trim();
  }

  /** The touch send button (mobile keyboards do not always deliver Enter). */
  onChatSend(fn) {
    this.el.chatsend.addEventListener('click', fn);
  }

  /** Pops the touch chat toggle back out after sending. */
  setChatButtonOff() {
    document.querySelector('#touch [data-act="chat"]')?.classList.remove('on');
  }

  setStats(fps, ping) {
    this.el.fps.textContent = `${fps} FPS`;
    this.el.ping.textContent = `${ping} ms`;
  }

  setLockHint(show) {
    this.el.lockhint.classList.toggle('hidden', !show);
  }

  nameOf(id) {
    return this.roster.get(id)?.name || '';
  }

  teamOf(id) {
    return this.roster.get(id)?.team;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
