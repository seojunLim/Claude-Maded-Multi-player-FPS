// Map registry. Every arena lives in `shared/maps/` and is built from the same
// axis-aligned boxes the server and client both collide and hitscan against.
//
// This file is served to the browser as an ES module, so keep it dependency
// free and deterministic — both sides call `buildMap()` and must agree exactly.

import * as sanctum from './maps/sanctum.js';
import * as foundry from './maps/foundry.js';
import * as dune from './maps/dune.js';
import * as nexus from './maps/nexus.js';

export { MAP_KINDS } from './mapkit.js';

const MODULES = [sanctum, foundry, dune, nexus];

/** Metadata for the menu, keyed by id, in rotation order. */
export const MAPS = Object.fromEntries(MODULES.map((m) => [m.meta.id, m.meta]));
export const MAP_IDS = MODULES.map((m) => m.meta.id);
export const MAP_LIST = MODULES.map((m) => m.meta);
export const DEFAULT_MAP = 'sanctum';

const BUILDERS = Object.fromEntries(MODULES.map((m) => [m.meta.id, m.build]));

export function isMapId(id) {
  return Object.prototype.hasOwnProperty.call(BUILDERS, id);
}

export function getMapMeta(id) {
  return MAPS[id] || MAPS[DEFAULT_MAP];
}

/** Picks a map id at random — used by the "무작위" menu option. */
export function randomMapId() {
  return MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)];
}

/**
 * Builds a playable arena. Unknown ids fall back to the default map rather
 * than throwing, so a stale link can never desync a client from the server.
 */
export function buildMap(id = DEFAULT_MAP) {
  const build = BUILDERS[id] || BUILDERS[DEFAULT_MAP];
  return build();
}

// Kept for callers that only want the default arena's headline numbers.
export const MAP = MAPS[DEFAULT_MAP];
