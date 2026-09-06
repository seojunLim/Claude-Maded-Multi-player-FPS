// All DOM/HUD updates live here so the render loop only pushes numbers in.

import { TEAMS, MATCH_STATE } from '/shared/constants.js';
import { HEROES, getHero } from '/shared/heroes.js';
import { getMode } from '/shared/modes.js';

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
      topbar: $('topbar'),
      tname0: document.querySelector('#topbar .s0 .tname'),
      tname1: document.querySelector('#topbar .s1 .tname'),
      modetag: $('modetag'),
      zonebar: $('zonebar'),
      zonefill: $('zonefill'),
      zonelabel: $('zonelabel'),
      sbTitle: document.querySelector('#scoreboard .sb-head h2'),
      sbTeams: document.querySelector('#scoreboard .sb-teams'),
      sbHead0: document.querySelector('.sb-team[data-team="0"] h3'),
      sbHead1: document.querySelector('.sb-team[data-team="1"] h3'),
      deadhint: document.querySelector('#deadscreen .dead-hint'),
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
    this.mode = getMode('tdm');
    this.mapMeta = null;
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

  /**
   * Locks the HUD to the rules actually being played. Team modes keep the
   * two-sided scoreboard; free-for-all collapses it into one ranked list and
   * the top bar starts tracking "you versus whoever is winning".
   */
  setMode(mode, mapMeta) {
    this.mode = mode;
    this.mapMeta = mapMeta || null;
    const ffa = !mode.teams;
    document.body.classList.toggle('ffa', ffa);
    document.body.classList.toggle('mode-zone', mode.scoring === 'zone');
    document.body.classList.toggle('mode-ladder', mode.scoring === 'ladder');

    if (this.el.modetag) {
      this.el.modetag.textContent = mapMeta ? `${mode.name} · ${mapMeta.name}` : mode.name;
    }
    if (ffa) {
      this.el.tname0.textContent = '나';
      this.el.tname1.textContent = '선두';
    } else {
      this.el.tname0.textContent = TEAMS[0].name;
      this.el.tname1.textContent = TEAMS[1].name;
    }
    if (this.el.sbTitle) {
      this.el.sbTitle.textContent = `${mapMeta ? mapMeta.name : ''} — ${mode.name}`.trim();
    }
    if (this.el.sbHead1) this.el.sbHead1.parentElement.classList.toggle('hidden', ffa);
    if (this.el.sbHead0) this.el.sbHead0.textContent = ffa ? '순위' : TEAMS[0].name;
    // The gun-game ladder owns your hero, so the death screen must not offer
    // a swap that the server will refuse.
    const ladder = mode.scoring === 'ladder';
    this.el.deadheroes.classList.toggle('hidden', ladder);
    if (this.el.deadhint) {
      this.el.deadhint.textContent = ladder
        ? '부활 대기 중 — 영웅은 승급에 따라 자동으로 바뀝니다'
        : '부활 대기 중 — 영웅을 교체할 수 있습니다';
    }
    // Gun game ranks by ladder rung, so the frag column is relabelled.
    for (const th of document.querySelectorAll('.sb-team thead th:nth-child(3)')) {
      th.textContent = ladder ? '단계' : 'K';
    }
    this.el.zonebar?.classList.toggle('hidden', mode.scoring !== 'zone');
  }

  /** Domination's live control-point readout, fed from every snapshot. */
  setZone(state, scores) {
    if (!this.el.zonebar || this.mode.scoring !== 'zone') return;
    const owner = state.owner;
    const label = this.mapMeta?.zone?.name || '거점';
    const color = owner >= 0 ? TEAMS[owner].cssColor : '#cbd5e1';
    this.el.zonebar.classList.toggle('contested', state.contested);
    this.el.zonelabel.textContent = state.contested
      ? `${label} 경합 중 (${state.counts[0]} : ${state.counts[1]})`
      : owner >= 0
        ? `${label} — ${TEAMS[owner].name} 점거 (${state.counts[owner]}명)`
        : `${label} — 비어 있음`;
    this.el.zonelabel.style.color = color;
    // The bar reads as a tug of war between the two teams' banked points, and
    // sits dead centre until somebody has actually banked something.
    const total = scores[0] + scores[1];
    this.el.zonefill.style.width = total > 0 ? `${(scores[0] / total) * 100}%` : '50%';
    this.el.score0.textContent = scores[0];
    this.el.score1.textContent = scores[1];
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
    this.roster = new Map(info.roster.map((r) => [r.id, r]));
    this.limit = info.limit;
    this.updateScores(info);
    const label = {
      [MATCH_STATE.WAITING]: '플레이어 대기 중',
      [MATCH_STATE.WARMUP]: '곧 시작',
      [MATCH_STATE.LIVE]: this.liveLabel(info),
      [MATCH_STATE.OVER]: '경기 종료',
    };
    this.matchState = info.state;
    this.el.matchstate.textContent = label[info.state] || '';
    this.renderScoreboard(info);

    if (info.state === MATCH_STATE.OVER) this.showMatchOver(info);
    else this.el.matchover.classList.add('hidden');

    this.setWaiting(info);
  }

  /** What the clock strap says a live match is being played to. */
  liveLabel(info) {
    switch (this.mode.scoring) {
      case 'zone':
        return `거점 ${info.limit}점`;
      case 'ladder':
        return `영웅 ${info.limit}단계`;
      default:
        return this.mode.teams ? `선착 ${info.limit}킬` : `개인 ${info.limit}킬`;
    }
  }

  /** How far along a player is, in whatever the mode counts. */
  progressOf(r) {
    return this.mode.scoring === 'ladder' ? r.lvl ?? 0 : r.k;
  }

  /**
   * Team modes put both team totals on the bar. Free-for-all has no team
   * totals, so the bar becomes your score against whoever is leading.
   */
  updateScores(info) {
    if (this.mode.teams) {
      this.el.score0.textContent = info.scores[0];
      this.el.score1.textContent = info.scores[1];
      this.el.sbScore.innerHTML =
        `<span style="color:${TEAMS[0].cssColor}">${info.scores[0]}</span> : <span style="color:${TEAMS[1].cssColor}">${info.scores[1]}</span>`;
      return;
    }
    const ranked = [...info.roster].sort((a, b) => this.progressOf(b) - this.progressOf(a) || b.dmg - a.dmg);
    const me = info.roster.find((r) => r.id === this.selfId);
    const top = ranked.find((r) => r.id !== this.selfId);
    const mine = me ? this.progressOf(me) : 0;
    this.el.score0.textContent = mine;
    this.el.score1.textContent = top ? this.progressOf(top) : 0;
    const place = me ? ranked.findIndex((r) => r.id === me.id) + 1 : 0;
    this.el.sbScore.textContent = place ? `${place}위 / ${ranked.length}명` : `${ranked.length}명`;
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
    // Free-for-all is one ranked table; team modes keep one table per side.
    if (!this.mode.teams) {
      const rows = [...info.roster].sort((a, b) => this.progressOf(b) - this.progressOf(a) || b.dmg - a.dmg);
      this.el.sb0.innerHTML = rows.map((r, i) => this.scoreRow(r, i + 1)).join('');
      this.el.sb1.innerHTML = '';
      return;
    }
    for (const team of [0, 1]) {
      const rows = info.roster.filter((r) => r.team === team).sort((a, b) => b.k - a.k || b.dmg - a.dmg);
      const body = team === 0 ? this.el.sb0 : this.el.sb1;
      body.innerHTML = rows.map((r) => this.scoreRow(r)).join('');
    }
  }

  scoreRow(r, place) {
    const hero = getHero(r.hero);
    // Gun game ranks by ladder rung, so that is the number worth showing.
    const first = this.mode.scoring === 'ladder' ? `${(r.lvl ?? 0) + 1}단계` : r.k;
    return `<tr class="${r.id === this.selfId ? 'me' : ''}">
      <td>${place ? `<span class="place">${place}</span>` : ''}${escapeHtml(r.name)}${r.bot ? '<span class="bot">BOT</span>' : ''}</td>
      <td class="hero">${hero.name}</td><td>${first}</td><td>${r.d}</td><td>${r.dmg}</td><td>${r.bot ? '—' : r.ping}</td>
    </tr>`;
  }

  showMatchOver(info) {
    this.el.matchover.classList.remove('hidden');
    const ranked = [...info.roster].sort((a, b) => this.progressOf(b) - this.progressOf(a) || b.dmg - a.dmg);

    let win;
    if (this.mode.teams) {
      const mine = info.scores[this.selfTeam];
      const theirs = info.scores[1 - this.selfTeam];
      win = mine > theirs;
      this.el.moResult.textContent = mine === theirs ? '무승부' : win ? '승리' : '패배';
      this.el.moResult.className = mine === theirs ? '' : win ? 'win' : 'lose';
      this.el.moScore.textContent = `${info.scores[0]} : ${info.scores[1]}`;
    } else {
      const winner = info.roster.find((r) => r.id === info.winner) || ranked[0];
      win = !!winner && winner.id === this.selfId;
      const place = ranked.findIndex((r) => r.id === this.selfId) + 1;
      this.el.moResult.textContent = win ? '승리' : place ? `${place}위` : '경기 종료';
      this.el.moResult.className = win ? 'win' : place === 1 ? '' : 'lose';
      this.el.moScore.textContent = winner
        ? `${escapeHtml(winner.name)} · ${this.progressOf(winner)}${this.mode.scoring === 'ladder' ? '단계' : '킬'}`
        : '—';
    }

    const mvp = ranked[0];
    if (mvp) {
      const color = this.mode.teams ? TEAMS[mvp.team].cssColor : '#f8fafc';
      this.el.moMvp.innerHTML = `MVP — <b style="color:${color}">${escapeHtml(mvp.name)}</b> · ${mvp.k} KILLS · ${mvp.dmg} DMG`;
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
