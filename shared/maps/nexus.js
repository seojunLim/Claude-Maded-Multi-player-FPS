// "NEXUS" — a compact night arena, symmetric across both axes.
//
// Four identical quadrants around a sunken core, so a free-for-all has no
// corner that plays better than any other.

import { MAP_KINDS, box, mirrorZ, mirrorX, stairsX, stairsZ, deck, arenaShell } from '../mapkit.js';

const KIND = MAP_KINDS;
const HALF = 28;

export const meta = {
  id: 'nexus',
  name: 'NEXUS',
  tagline: '야간 격투장',
  desc: '네 방향이 모두 똑같은 소형 야간 아레나. 리스폰이 빠르고 교전이 끊이지 않아 개인전에 가장 잘 어울립니다.',
  size: '소형',
  half: HALF,
  wallHeight: 15,
  preview: { x: 0, z: 15 },
  zone: { x: 0, z: 0, r: 8, y0: -1, y1: 10, name: '코어' },
  theme: {
    exposure: 0.95,
    sky: { top: 0x101a3c, mid: 0x22356b, bottom: 0x4a2f7a },
    fog: { color: 0x1c2a52, near: 70, far: 260 },
    sun: { color: 0xb9d2ff, intensity: 1.15, pos: [-40, 80, 30] },
    hemi: { sky: 0x8fa8ff, ground: 0x2a3350, intensity: 1.15 },
    palette: {
      ground: '#39435c', groundSeam: '#1c2434',
      wall: '#44506e', wallSeam: '#232b3e',
      building: '#3f4b6d', buildingLine: '#20273a', buildingAccent: '#5eead4',
      pillar: '#3b4566', pillarLine: '#1e2437', pillarAccent: '#a78bfa',
    },
  },
};

/** One quadrant (+x, +z), mirrored into the other three. */
function buildQuadrant() {
  const b = [];

  // Corner block with a roof you can fight from.
  b.push(box(18, 18, 11, 11, 0, 5, KIND.BUILDING));
  b.push(box(18, 18, 12, 12, 5, 0.5, KIND.PLATFORM));
  b.push(...stairsZ(24.5, 10.5, 4, 1, 8, 0.68, 1.15));
  b.push(box(24.5, 20.2, 4, 3, 0, 5.6, KIND.PLATFORM));

  // Angled cover between the corner block and the core.
  b.push(box(9, 15, 7, 1, 0, 2.6, KIND.WALL));
  b.push(box(15, 9, 1, 7, 0, 2.6, KIND.WALL));
  b.push(box(6.5, 6.5, 2.4, 2.4, 0, 1.6, KIND.CRATE));

  // Outer lane pillars.
  b.push(box(25, 3, 2, 2, 0, 4.4, KIND.PILLAR));
  b.push(box(3, 25, 2, 2, 0, 4.4, KIND.PILLAR));

  // A short bridge from the corner roof toward the core deck.
  b.push(...deck(11.5, 11.5, 3.5, 3.5, 5, { legs: false }));

  return b;
}

export function build() {
  const half = HALF;
  const boxes = arenaShell(half, meta.wallHeight);

  // Sunken core: a low ring wall around a raised pad, open on four sides.
  boxes.push(box(0, 0, 12, 12, 0, 2.4, KIND.PLATFORM));
  boxes.push(box(0, 0, 4.5, 4.5, 2.4, 2.6, KIND.PILLAR));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      boxes.push(box(sx * 5, sz * 5, 2, 2, 2.4, 1.6, KIND.CRATE));
    }
  }
  // Four ramps, one per side.
  boxes.push(...stairsX(-9.9, 0, 5, 1, 4, 0.62, 1.1));
  boxes.push(...stairsX(9.9, 0, 5, -1, 4, 0.62, 1.1));
  boxes.push(...stairsZ(0, -9.9, 5, 1, 4, 0.62, 1.1));
  boxes.push(...stairsZ(0, 9.9, 5, -1, 4, 0.62, 1.1));

  const quad = buildQuadrant();
  for (const bx of quad) {
    boxes.push(bx);
    boxes.push(mirrorX(bx));
    boxes.push(mirrorZ(bx));
    boxes.push(mirrorZ(mirrorX(bx)));
  }

  const spawns = [
    [
      { x: -7, z: 24, yaw: 0 },
      { x: 7, z: 24, yaw: 0 },
      { x: 0, z: 24, yaw: 0 },
      { x: -22, z: 24, yaw: 0 },
      { x: 22, z: 24, yaw: 0 },
      { x: -14, z: 24, yaw: 0 },
    ],
    [
      { x: 7, z: -24, yaw: Math.PI },
      { x: -7, z: -24, yaw: Math.PI },
      { x: 0, z: -24, yaw: Math.PI },
      { x: 22, z: -24, yaw: Math.PI },
      { x: -22, z: -24, yaw: Math.PI },
      { x: 14, z: -24, yaw: Math.PI },
    ],
  ];

  const freeSpawns = [
    ...spawns[0],
    ...spawns[1],
    { x: -24, z: 0, yaw: Math.PI / 2 },
    { x: 24, z: 0, yaw: -Math.PI / 2 },
    { x: -24, z: 6, yaw: Math.PI / 2 },
    { x: 24, z: -6, yaw: -Math.PI / 2 },
  ];

  return { id: meta.id, name: meta.name, half, boxes, spawns, freeSpawns, preview: meta.preview, zone: meta.zone, theme: meta.theme };
}
