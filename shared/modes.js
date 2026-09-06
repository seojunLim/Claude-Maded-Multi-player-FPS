// Game modes. A mode is pure configuration: the room reads these flags to
// decide who can shoot whom, what puts points on the board and when a match
// is won. Served to the browser as an ES module, so keep it dependency free.

import { MATCH_DURATION_MS } from './constants.js';

/**
 * scoring
 *   'kills' — a frag is a point (team total in team modes, personal in FFA)
 *   'zone'  — only holding the control point scores
 *   'ladder'— every N frags promotes you to the next hero; finishing wins
 */
export const MODES = {
  tdm: {
    id: 'tdm',
    name: '팀 데스매치',
    short: 'TDM',
    icon: '⚔',
    teams: true,
    scoring: 'kills',
    scoreLimit: 50,
    duration: MATCH_DURATION_MS,
    tagline: '먼저 50킬',
    desc: '두 팀이 처치 수를 겨룹니다. 가장 기본적이고 가장 치열한 규칙.',
    rules: ['팀 전체 처치 수가 곧 점수', '먼저 50점을 올린 팀이 승리', '제한 시간 8분'],
  },
  ffa: {
    id: 'ffa',
    name: '개인전',
    short: 'FFA',
    icon: '☠',
    teams: false,
    scoring: 'kills',
    scoreLimit: 25,
    duration: MATCH_DURATION_MS,
    tagline: '전원 적',
    desc: '팀이 없습니다. 눈에 보이는 모두가 적이고, 점수는 오직 자신의 것입니다.',
    rules: ['모든 플레이어가 서로의 적', '개인 처치 수 25킬 선착순 승리', '리스폰 지점은 맵 전역에 분산'],
  },
  domination: {
    id: 'domination',
    name: '거점 점령',
    short: 'DOM',
    icon: '⬢',
    teams: true,
    scoring: 'zone',
    scoreLimit: 200,
    duration: MATCH_DURATION_MS,
    // Points per second for the team holding the point, plus a bonus per
    // extra body inside it (capped so a full stack cannot end it instantly).
    tickPerSecond: 2,
    tickPerExtraPlayer: 1,
    maxTickBonus: 3,
    desc: '맵 중앙의 거점을 점거한 팀만 점수를 얻습니다. 처치 수는 점수가 되지 않습니다.',
    tagline: '거점을 지켜라',
    rules: ['중앙 거점을 점거한 팀이 초당 점수 획득', '양 팀이 함께 있으면 경합 — 아무도 못 얻음', '먼저 200점을 올린 팀이 승리'],
  },
  gungame: {
    id: 'gungame',
    name: '건 게임',
    short: 'GUN',
    icon: '⇪',
    teams: false,
    scoring: 'ladder',
    killsPerStage: 2,
    // Rungs of the ladder, climbed in order. Every promotion swaps the hero
    // (and therefore the weapon) mid-life, so it reads as a real gun game.
    ladder: ['ranger', 'sentinel', 'marksman', 'medic'],
    duration: MATCH_DURATION_MS,
    desc: '처치할 때마다 다음 영웅으로 승급합니다. 마지막 영웅까지 끝낸 사람이 승리.',
    tagline: '전 영웅 제패',
    rules: ['개인전 규칙 — 전원이 적', '2킬마다 다음 영웅으로 자동 승급', '마지막 영웅으로 승급 조건을 채우면 즉시 승리'],
  },
};

export const MODE_IDS = Object.keys(MODES);
export const MODE_LIST = Object.values(MODES);
export const DEFAULT_MODE = 'tdm';

export function isModeId(id) {
  return Object.prototype.hasOwnProperty.call(MODES, id);
}

export function getMode(id) {
  return MODES[id] || MODES[DEFAULT_MODE];
}

/** Team modes split into LUMEN/EMBER; the rest are every-player-for-themselves. */
export function isFreeForAll(mode) {
  return !getMode(mode.id ?? mode).teams;
}

