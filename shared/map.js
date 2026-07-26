// "SANCTUM" — a symmetric team-deathmatch arena.
//
// The whole level is axis-aligned boxes so that the server and the client can
// run identical collision and hitscan code. Geometry is authored for the north
// half and mirrored across z=0 so neither team gets an advantage.

export const MAP = { name: 'SANCTUM', half: 42, wallHeight: 14 };

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

function box(cx, cz, w, d, y0, h, kind) {
  return {
    min: [cx - w / 2, y0, cz - d / 2],
    max: [cx + w / 2, y0 + h, cz + d / 2],
    kind,
  };
}

function mirrorBox(b) {
  return {
    min: [b.min[0], b.min[1], -b.max[2]],
    max: [b.max[0], b.max[1], -b.min[2]],
    kind: b.kind,
  };
}

// In both stair helpers the steps get taller as `i` grows, so the flight always
// arrives at full height on the far side from `start`.
function stairsZ(cx, startZ, width, dir, steps, rise, run) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    out.push(box(cx, startZ + dir * (run * i + run / 2), width, run, 0, rise * (i + 1), KIND.STEP));
  }
  return out;
}

function stairsX(startX, cz, width, dir, steps, rise, run) {
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
function building(cx, cz, w, d, h, doorW) {
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

function buildHalf() {
  const b = [];

  // ---- Spawn structure (north) ------------------------------------------
  // Roof top sits at 5.5; the stair flight tops out at 5.2 and a landing
  // block bridges the last 0.3 onto the roof itself.
  b.push(...building(0, 33, 20, 12, 5, 5));
  b.push(...stairsZ(-7.5, 16.8, 5, 1, 8, 0.65, 1.15));
  b.push(box(-7.5, 25.4, 5, 3, 0, 5.5, KIND.PLATFORM));
  b.push(box(0, 40.2, 30, 1.2, 0, 5, KIND.WALL));
  b.push(box(-9.5, 23, 2.2, 2.2, 0, 2.4, KIND.CRATE));
  b.push(box(9.5, 23, 2.2, 2.2, 0, 2.4, KIND.CRATE));

  // ---- Flank buildings ---------------------------------------------------
  // Roof top at 7.0, reached by an outside flight on the far side of the map.
  for (const s of [-1, 1]) {
    b.push(...building(s * 25, 17, 14, 14, 6.5, 4.5));
    b.push(...stairsZ(s * 34, 7.5, 4, 1, 10, 0.65, 1.15));
    b.push(box(s * 33, 20.4, 4, 3, 0, 7, KIND.PLATFORM));
  }

  // ---- Mid cover ---------------------------------------------------------
  b.push(box(-13, 11, 7, 1, 0, 3.2, KIND.WALL));
  b.push(box(13, 11, 7, 1, 0, 3.2, KIND.WALL));
  b.push(box(-3.5, 13.5, 2.4, 2.4, 0, 1.5, KIND.CRATE));
  b.push(box(3.5, 13.5, 2.4, 2.4, 0, 1.5, KIND.CRATE));
  b.push(box(0, 17.5, 3, 3, 0, 2.8, KIND.CRATE));
  b.push(box(-20, 4, 1, 9, 0, 3.4, KIND.WALL));
  b.push(box(20, 4, 1, 9, 0, 3.4, KIND.WALL));
  b.push(box(-30, 28, 2.4, 2.4, 0, 1.6, KIND.CRATE));
  b.push(box(30, 28, 2.4, 2.4, 0, 1.6, KIND.CRATE));

  // ---- North stairs onto the center platform (platform edge is z=9) ------
  b.push(...stairsZ(0, 14.6, 7, -1, 5, 0.62, 1.1));

  return b;
}

export function buildMap() {
  const half = MAP.half;
  const boxes = [];

  // Ground slab, thick enough that nothing can tunnel through it.
  boxes.push(box(0, 0, half * 2, half * 2, -2, 2, KIND.GROUND));

  // Outer walls.
  const t = 2;
  boxes.push(box(0, half, half * 2 + t * 2, t, 0, MAP.wallHeight, KIND.WALL));
  boxes.push(box(0, -half, half * 2 + t * 2, t, 0, MAP.wallHeight, KIND.WALL));
  boxes.push(box(-half, 0, t, half * 2 + t * 2, 0, MAP.wallHeight, KIND.WALL));
  boxes.push(box(half, 0, t, half * 2 + t * 2, 0, MAP.wallHeight, KIND.WALL));

  // Center control platform (18x18, top at 3.1) with corner pillars.
  boxes.push(box(0, 0, 18, 18, 0, 3.1, KIND.PLATFORM));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      boxes.push(box(sx * 7.5, sz * 7.5, 1.6, 1.6, 3.1, 4.2, KIND.PILLAR));
    }
  }
  boxes.push(box(0, 0, 5, 5, 3.1, 1.2, KIND.CRATE));
  for (const sz of [-1, 1]) {
    boxes.push(box(sz * 6.2, 0, 1, 6, 3.1, 1.1, KIND.WALL)); // railings
  }
  // East/west stairs onto the platform (platform edge is x=±9).
  boxes.push(...stairsX(-14.6, 0, 7, 1, 5, 0.62, 1.1));
  boxes.push(...stairsX(14.6, 0, 7, -1, 5, 0.62, 1.1));

  // Symmetric halves.
  const northHalf = buildHalf();
  for (const bx of northHalf) boxes.push(bx);
  for (const bx of northHalf) boxes.push(mirrorBox(bx));

  // Side lanes with staggered pillars.
  for (let z = -35; z <= 35; z += 10) {
    boxes.push(box(-38, z, 2.4, 2.4, 0, 5, KIND.PILLAR));
    boxes.push(box(38, z, 2.4, 2.4, 0, 5, KIND.PILLAR));
  }

  // yaw 0 looks down -z, so the north team faces 0 and the south team faces PI.
  const spawns = [
    [
      { x: -6, z: 35, yaw: 0 },
      { x: 0, z: 37, yaw: 0 },
      { x: 6, z: 35, yaw: 0 },
      { x: -12, z: 30, yaw: 0 },
      { x: 12, z: 30, yaw: 0 },
      { x: 0, z: 30, yaw: 0 },
    ],
    [
      { x: 6, z: -35, yaw: Math.PI },
      { x: 0, z: -37, yaw: Math.PI },
      { x: -6, z: -35, yaw: Math.PI },
      { x: 12, z: -30, yaw: Math.PI },
      { x: -12, z: -30, yaw: Math.PI },
      { x: 0, z: -30, yaw: Math.PI },
    ],
  ];

  return { name: MAP.name, half, boxes, spawns };
}
