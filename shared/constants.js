// Constants shared by the authoritative server and the predicting client.
// This file is served to the browser as an ES module, so keep it dependency free.

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const COMMAND_SEND_RATE = 30;

// How far back the server is allowed to rewind the world for hit detection.
export const MAX_REWIND_MS = 260;
export const HISTORY_MS = 1000;

// Client renders remote players this far in the past so it always has two
// snapshots to interpolate between.
export const INTERP_DELAY_MS = 100;

export const MATCH_DURATION_MS = 8 * 60 * 1000;
export const SCORE_LIMIT = 50;
export const RESPAWN_MS = 5000;
export const WARMUP_MS = 6000;
export const POST_MATCH_MS = 15000;

export const MAX_PLAYERS = 12;
export const MAX_NAME_LEN = 14;
export const MAX_CHAT_LEN = 120;

export const TEAMS = [
  { id: 0, name: 'LUMEN', color: 0x38bdf8, cssColor: '#38bdf8' },
  { id: 1, name: 'EMBER', color: 0xfb7185, cssColor: '#fb7185' },
];

// Player collision + hit volume.
export const PLAYER_RADIUS = 0.42;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;
export const PLAYER_CROUCH_HEIGHT = 1.15;
export const PLAYER_CROUCH_EYE = 1.0;
export const HEAD_HEIGHT = 1.5; // hits above this (standing) count as headshots

// Movement tuning.
export const GRAVITY = 23;
export const JUMP_SPEED = 8.1;
export const GROUND_ACCEL = 16;
export const AIR_ACCEL = 3;
export const GROUND_FRICTION = 11;
export const STEP_HEIGHT = 0.62;
export const SPRINT_MULT = 1.35;
export const CROUCH_MULT = 0.5;
export const AIR_SPEED_CAP = 1.15;
export const FALL_DAMAGE_SPEED = 17;
export const FALL_DAMAGE_PER_SPEED = 5.5;

// Input bit flags packed into a single integer per command.
// Analog stick values travel as integers in [-MOVE_UNIT, MOVE_UNIT] so both
// sides of the wire derive an identical movement direction.
export const MOVE_UNIT = 100;

export const KEY = {
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  SPRINT: 1 << 5,
  CROUCH: 1 << 6,
  ZOOM: 1 << 7,
};

export const MSG = {
  // client -> server
  JOIN: 'join',
  COMMANDS: 'cmd',
  FIRE: 'fire',
  RELOAD: 'reload',
  ABILITY: 'abil',
  RESPAWN: 'respawn',
  CHAT: 'chat',
  PING: 'ping',
  // server -> client
  WELCOME: 'welcome',
  SNAPSHOT: 'snap',
  EVENTS: 'events',
  ROSTER: 'roster',
  MATCH: 'match',
  PONG: 'pong',
  ERROR: 'error',
};

export const EV = {
  SHOT: 'shot',
  HIT: 'hit',
  KILL: 'kill',
  DAMAGE: 'dmg',
  HEAL: 'heal',
  SPAWN: 'spawn',
  ABILITY: 'abil',
  CHAT: 'chat',
  RELOAD: 'reload',
};

export const MATCH_STATE = { WARMUP: 'warmup', LIVE: 'live', OVER: 'over' };
