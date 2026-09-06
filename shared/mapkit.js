// Shared authoring helpers for every arena in `shared/maps/`.
//
// Levels are nothing but axis-aligned boxes so the server and the client can
// run byte-identical collision and hitscan code. Everything in here is pure
// and deterministic — both sides call the same builders and must agree.

export const MAP_KINDS = {
  GROUND: 'ground',
  WALL: 'wall',
  BUILDING: 'building',
  PLATFORM: 'platform',
  CRATE: 'crate',
  STEP: 'step',
  PILLAR: 'pillar',
};

const KIND = MAP_KINDS;

/** A box given by its centre on the ground plane, its footprint and height. */
export function box(cx, cz, w, d, y0, h, kind) {
  return {
    min: [cx - w / 2, y0, cz - d / 2],
    max: [cx + w / 2, y0 + h, cz + d / 2],
    kind,
  };
}

/** Mirrors a box across z=0 so both halves of an arena stay identical. */
export function mirrorZ(b) {
  return { min: [b.min[0], b.min[1], -b.max[2]], max: [b.max[0], b.max[1], -b.min[2]], kind: b.kind };
}

/** Mirrors a box across x=0. */
export function mirrorX(b) {
  return { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]], kind: b.kind };
}

// In both stair helpers the steps get taller as `i` grows, so the flight always
// arrives at full height on the far side from `start`.
export function stairsZ(cx, startZ, width, dir, steps, rise, run) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    out.push(box(cx, startZ + dir * (run * i + run / 2), width, run, 0, rise * (i + 1), KIND.STEP));
  }
  return out;
}

export function stairsX(startX, cz, width, dir, steps, rise, run) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    out.push(box(startX + dir * (run * i + run / 2), cz, run, width, 0, rise * (i + 1), KIND.STEP));
  }
  return out;
}

/**
 * A rectangular building with a walkable roof and a door gap in the middle of
 * each wall, so it can always be fought through instead of only around.
 */
export function building(cx, cz, w, d, h, doorW) {
  const t = 0.6;
  const doorH = 2.6;
  const out = [];
  // North + south faces (walls running along x).
  for (const sz of [-1, 1]) {
    const len = (w - doorW) / 2;
    for (const sx of [-1, 1]) {
      out.push(box(cx + sx * (doorW / 2 + len / 2), cz + sz * (d / 2), len, t, 0, h, KIND.BUILDING));
    }
    out.push(box(cx, cz + sz * (d / 2), doorW, t, doorH, h - doorH, KIND.BUILDING));
  }
  // East + west faces (walls running along z).
  for (const sx of [-1, 1]) {
    const len = (d - doorW) / 2;
    for (const sz of [-1, 1]) {
      out.push(box(cx + sx * (w / 2), cz + sz * (doorW / 2 + len / 2), t, len, 0, h, KIND.BUILDING));
    }
    out.push(box(cx + sx * (w / 2), cz, t, doorW, doorH, h - doorH, KIND.BUILDING));
  }
  out.push(box(cx, cz, w + t, d + t, h, 0.5, KIND.PLATFORM)); // roof
  return out;
}

/** A raised deck on legs, reachable by whatever stairs the level supplies. */
export function deck(cx, cz, w, d, top, { legs = true, rail = 0 } = {}) {
  const out = [box(cx, cz, w, d, top, 0.5, KIND.PLATFORM)];
  if (legs) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.push(box(cx + sx * (w / 2 - 0.7), cz + sz * (d / 2 - 0.7), 1, 1, 0, top, KIND.PILLAR));
      }
    }
  }
  if (rail > 0) {
    out.push(box(cx, cz - d / 2, w, 0.35, top + 0.5, rail, KIND.WALL));
    out.push(box(cx, cz + d / 2, w, 0.35, top + 0.5, rail, KIND.WALL));
  }
  return out;
}

/** The ground slab plus the four outer walls every arena shares. */
export function arenaShell(half, wallHeight) {
  const t = 2;
  return [
    // Thick enough that nothing can tunnel through it.
    box(0, 0, half * 2, half * 2, -2, 2, KIND.GROUND),
    box(0, half, half * 2 + t * 2, t, 0, wallHeight, KIND.WALL),
    box(0, -half, half * 2 + t * 2, t, 0, wallHeight, KIND.WALL),
    box(-half, 0, t, half * 2 + t * 2, 0, wallHeight, KIND.WALL),
    box(half, 0, t, half * 2 + t * 2, 0, wallHeight, KIND.WALL),
  ];
}
