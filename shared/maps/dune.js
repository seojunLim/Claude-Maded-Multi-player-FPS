// "DUNE" — a wide desert outpost with long lanes and a watchtower at the core.
//
// The largest arena in the rotation: sniper country, with covered gullies down
// each flank for anyone who would rather not cross the open middle.

import { MAP_KINDS, box, mirrorZ, mirrorX, stairsX, stairsZ, building, deck, arenaShell } from '../mapkit.js';

const KIND = MAP_KINDS;
const HALF = 54;

export const meta = {
  id: 'dune',
  name: 'DUNE',
  tagline: '사막 전초기지',
  desc: '탁 트인 대형 야외 맵. 긴 사선과 높은 감시탑이 저격수의 무대이지만, 양 측면의 엄폐 통로로 우회할 수 있습니다.',
  size: '대형',
  half: HALF,
  wallHeight: 16,
  preview: { x: -17, z: 9 },
  zone: { x: 0, z: 0, r: 11, y0: -1, y1: 14, name: '감시탑' },
  theme: {
    exposure: 1.0,
    sky: { top: 0x2f7fd0, mid: 0x9fd0f0, bottom: 0xffe6b0 },
    fog: { color: 0xd9c49a, near: 90, far: 400 },
    sun: { color: 0xfff0cf, intensity: 1.7, pos: [70, 110, 20] },
    hemi: { sky: 0xffe9c0, ground: 0x8a7250, intensity: 0.5 },
    palette: {
      ground: '#b09468', groundSeam: '#7c6544',
      wall: '#c0a377', wallSeam: '#877049',
      building: '#b59a72', buildingLine: '#7d6746', buildingAccent: '#f3e2bd',
      pillar: '#a68d67', pillarLine: '#6f5c3f', pillarAccent: '#ffeec4',
    },
  },
};

function buildHalf() {
  const b = [];

  // Spawn compound with a walkable roof overlooking the approach.
  b.push(...building(0, 42, 24, 14, 6, 6));
  b.push(...stairsZ(-9, 27.5, 5, 1, 9, 0.68, 1.2));
  b.push(box(-9, 37, 5, 4, 0, 6.5, KIND.PLATFORM));
  b.push(box(-13, 30, 3, 3, 0, 2.2, KIND.CRATE));
  b.push(box(13, 30, 3, 3, 0, 2.2, KIND.CRATE));

  // Flank gullies: long low walls that give a covered run down each side.
  for (const s of [-1, 1]) {
    b.push(box(s * 38, 30, 1.2, 26, 0, 4.2, KIND.WALL));
    b.push(box(s * 46, 24, 8, 1.2, 0, 4.2, KIND.WALL));
    b.push(box(s * 44, 36, 3, 3, 0, 2.4, KIND.CRATE));
  }

  // Ruined arches across the open middle, staggered so no single line is safe.
  b.push(box(-20, 20, 10, 1.4, 0, 4.6, KIND.WALL));
  b.push(box(20, 20, 10, 1.4, 0, 4.6, KIND.WALL));
  b.push(box(-6, 24, 3, 3, 0, 2.6, KIND.CRATE));
  b.push(box(6, 24, 3, 3, 0, 2.6, KIND.CRATE));
  b.push(box(0, 30, 4, 4, 0, 3, KIND.CRATE));
  b.push(box(-28, 12, 1.4, 12, 0, 4.6, KIND.WALL));
  b.push(box(28, 12, 1.4, 12, 0, 4.6, KIND.WALL));

  // A sandbagged shelf halfway in, reachable from the flank gully.
  for (const s of [-1, 1]) {
    b.push(...deck(s * 33, 14, 10, 8, 4.6, { rail: 1.1 }));
    b.push(...stairsZ(s * 33, 7.4, 4.5, 1, 7, 0.68, 1.2));
  }

  // Low approach cover onto the tower plaza (plaza edge is z=12).
  b.push(...stairsZ(0, 17.6, 8, -1, 5, 0.62, 1.15));

  return b;
}

export function build() {
  const half = HALF;
  const boxes = arenaShell(half, meta.wallHeight);

  // Tower plaza (24x24, top at 3.1) with the watchtower rising out of it.
  boxes.push(box(0, 0, 24, 24, 0, 3.1, KIND.PLATFORM));
  boxes.push(box(0, 0, 9, 9, 3.1, 6.4, KIND.BUILDING));
  boxes.push(box(0, 0, 11, 11, 9.5, 0.6, KIND.PLATFORM));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      boxes.push(box(sx * 5, sz * 5, 1.2, 1.2, 10.1, 1.2, KIND.PILLAR)); // parapet corners
      boxes.push(box(sx * 10, sz * 10, 2.4, 2.4, 3.1, 2.4, KIND.CRATE));
    }
  }
  // A wrapping flight up the tower: plaza -> shoulder -> crown.
  boxes.push(...stairsX(-8.4, 8, 4, 1, 9, 0.72, 1.2));
  boxes.push(box(3.4, 8, 3, 4, 0, 9.6, KIND.PLATFORM));
  boxes.push(...stairsX(8.4, -8, 4, -1, 9, 0.72, 1.2));
  boxes.push(box(-3.4, -8, 3, 4, 0, 9.6, KIND.PLATFORM));
  // Ramps onto the plaza itself from east and west.
  boxes.push(...stairsX(-17.6, 0, 8, 1, 5, 0.62, 1.15));
  boxes.push(...stairsX(17.6, 0, 8, -1, 5, 0.62, 1.15));

  const half1 = buildHalf();
  for (const bx of half1) boxes.push(bx);
  for (const bx of half1) boxes.push(mirrorZ(bx));

  // Rock pillars scattered along the outer ring.
  for (let z = -46; z <= 46; z += 13) {
    for (const bx of [box(-50, z, 3, 3, 0, 5.5, KIND.PILLAR)]) {
      boxes.push(bx);
      boxes.push(mirrorX(bx));
    }
  }

  const spawns = [
    [
      { x: -7, z: 46, yaw: 0 },
      { x: 0, z: 48, yaw: 0 },
      { x: 7, z: 46, yaw: 0 },
      { x: -16, z: 42, yaw: 0 },
      { x: 16, z: 42, yaw: 0 },
      { x: 0, z: 40, yaw: 0 },
    ],
    [
      { x: 7, z: -46, yaw: Math.PI },
      { x: 0, z: -48, yaw: Math.PI },
      { x: -7, z: -46, yaw: Math.PI },
      { x: 16, z: -42, yaw: Math.PI },
      { x: -16, z: -42, yaw: Math.PI },
      { x: 0, z: -40, yaw: Math.PI },
    ],
  ];

  const freeSpawns = [
    ...spawns[0],
    ...spawns[1],
    { x: -44, z: 0, yaw: Math.PI / 2 },
    { x: 44, z: 0, yaw: -Math.PI / 2 },
    { x: -33, z: 24, yaw: Math.PI },
    { x: 33, z: -24, yaw: 0 },
    { x: 33, z: 24, yaw: Math.PI },
    { x: -33, z: -24, yaw: 0 },
  ];

  return { id: meta.id, name: meta.name, half, boxes, spawns, freeSpawns, preview: meta.preview, zone: meta.zone, theme: meta.theme };
}
