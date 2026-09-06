// "FOUNDRY" — a tight industrial hall built around a central smelter.
//
// Short sightlines, heavy vertical layering and catwalks that ring the whole
// room. Mirrored across z=0.

import { MAP_KINDS, box, mirrorZ, mirrorX, stairsX, stairsZ, deck, arenaShell } from '../mapkit.js';

const KIND = MAP_KINDS;
const HALF = 34;

export const meta = {
  id: 'foundry',
  name: 'FOUNDRY',
  tagline: '용광로 제련소',
  desc: '좁은 통로와 2층 캣워크가 겹치는 실내 산업 지대. 교전 거리가 짧아 산탄총과 근접 영웅이 강합니다.',
  size: '소형',
  half: HALF,
  wallHeight: 16,
  preview: { x: 0, z: 26 },
  zone: { x: 0, z: 0, r: 9, y0: -1, y1: 12, name: '용광로' },
  theme: {
    exposure: 0.92,
    sky: { top: 0x3a2620, mid: 0x8a4c2c, bottom: 0xe89248 },
    fog: { color: 0x4a3020, near: 60, far: 220 },
    sun: { color: 0xffc292, intensity: 1.35, pos: [40, 70, -30] },
    hemi: { sky: 0xffc491, ground: 0x38231d, intensity: 0.7 },
    palette: {
      ground: '#5f564d', groundSeam: '#2f2823',
      wall: '#6f6055', wallSeam: '#362d26',
      building: '#6a584a', buildingLine: '#3a2f27', buildingAccent: '#f0a35c',
      pillar: '#5c4a3f', pillarLine: '#332822', pillarAccent: '#ffb060',
    },
  },
};

function buildHalf() {
  const b = [];

  // Spawn bay: a covered dock at the far end with a crate wall in front.
  b.push(...deck(0, 27, 18, 8, 5.2, { legs: false, rail: 1.1 }));
  b.push(box(-9.5, 27, 1.2, 8, 0, 5.2, KIND.PILLAR));
  b.push(box(9.5, 27, 1.2, 8, 0, 5.2, KIND.PILLAR));
  b.push(...stairsZ(-13.5, 22.4, 4.5, 1, 8, 0.65, 1.15));
  b.push(...stairsZ(13.5, 22.4, 4.5, 1, 8, 0.65, 1.15));
  b.push(box(-5, 21.5, 2.4, 2.4, 0, 2.4, KIND.CRATE));
  b.push(box(5, 21.5, 2.4, 2.4, 0, 2.4, KIND.CRATE));
  b.push(box(0, 20.5, 6, 1, 0, 1.3, KIND.CRATE));

  // Storage blocks either side of the lane out of spawn.
  for (const s of [-1, 1]) {
    b.push(box(s * 22, 22, 12, 9, 0, 6.2, KIND.BUILDING));
    b.push(box(s * 22, 22, 12.6, 9.6, 6.2, 0.5, KIND.PLATFORM));
    b.push(box(s * 29, 13, 6, 5, 0, 3.4, KIND.CRATE));
  }

  // Mid-hall cover: staggered furnaces and a low wall to slide behind.
  b.push(box(-11, 12, 5, 5, 0, 4, KIND.BUILDING));
  b.push(box(11, 12, 5, 5, 0, 4, KIND.BUILDING));
  b.push(box(0, 13.5, 9, 1, 0, 2.2, KIND.WALL));
  b.push(box(-18, 6, 1, 8, 0, 3.6, KIND.WALL));
  b.push(box(18, 6, 1, 8, 0, 3.6, KIND.WALL));

  // Catwalk ring hugging the north wall, tied into the storage roofs.
  b.push(box(0, 31, 60, 3, 6.2, 0.5, KIND.PLATFORM));
  b.push(box(0, 32.6, 60, 0.35, 6.7, 1.1, KIND.WALL));

  return b;
}

export function build() {
  const half = HALF;
  const boxes = arenaShell(half, meta.wallHeight);

  // Central smelter: a squat drum you fight around, ringed by a raised walk.
  boxes.push(box(0, 0, 7, 7, 0, 5.4, KIND.BUILDING));
  boxes.push(box(0, 0, 8, 8, 5.4, 0.6, KIND.PLATFORM));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      boxes.push(box(sx * 9, sz * 9, 2, 2, 0, 3.2, KIND.CRATE));
    }
  }
  // Ramps onto the smelter cap from east and west.
  boxes.push(...stairsX(-13.2, 0, 4.5, 1, 8, 0.68, 1.15));
  boxes.push(...stairsX(13.2, 0, 4.5, -1, 8, 0.68, 1.15));
  boxes.push(box(-4.6, 0, 2.6, 4.5, 0, 5.7, KIND.PLATFORM));
  boxes.push(box(4.6, 0, 2.6, 4.5, 0, 5.7, KIND.PLATFORM));

  // Side catwalks running the length of the hall at storage-roof height.
  for (const sx of [-1, 1]) {
    boxes.push(box(sx * 31, 0, 3, 62, 6.2, 0.5, KIND.PLATFORM));
    boxes.push(box(sx * 29.4, 0, 0.35, 62, 6.7, 1.1, KIND.WALL));
  }

  const half1 = buildHalf();
  for (const bx of half1) boxes.push(bx);
  for (const bx of half1) boxes.push(mirrorZ(bx));

  // A pair of leaning girders that break the long east/west sightline.
  for (const bx of [box(-16, 0, 1.2, 6, 0, 4.2, KIND.PILLAR), box(-24, 0, 1.2, 6, 0, 4.2, KIND.PILLAR)]) {
    boxes.push(bx);
    boxes.push(mirrorX(bx));
  }

  const spawns = [
    [
      { x: -5, z: 28, yaw: 0 },
      { x: 0, z: 29, yaw: 0 },
      { x: 5, z: 28, yaw: 0 },
      { x: -17, z: 30, yaw: 0 },
      { x: 17, z: 30, yaw: 0 },
      { x: 0, z: 24, yaw: 0 },
    ],
    [
      { x: 5, z: -28, yaw: Math.PI },
      { x: 0, z: -29, yaw: Math.PI },
      { x: -5, z: -28, yaw: Math.PI },
      { x: 17, z: -30, yaw: Math.PI },
      { x: -17, z: -30, yaw: Math.PI },
      { x: 0, z: -24, yaw: Math.PI },
    ],
  ];

  const freeSpawns = [
    ...spawns[0],
    ...spawns[1],
    { x: -26, z: 0, yaw: Math.PI / 2 },
    { x: 26, z: 0, yaw: -Math.PI / 2 },
    { x: -20, z: 14, yaw: Math.PI },
    { x: 20, z: -14, yaw: 0 },
    { x: 20, z: 14, yaw: Math.PI },
    { x: -20, z: -14, yaw: 0 },
  ];

  return { id: meta.id, name: meta.name, half, boxes, spawns, freeSpawns, preview: meta.preview, zone: meta.zone, theme: meta.theme };
}
