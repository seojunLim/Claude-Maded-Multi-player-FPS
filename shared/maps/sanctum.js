// "SANCTUM" — a symmetric team-deathmatch arena.
//
// Geometry is authored for the north half and mirrored across z=0 so neither
// team gets an advantage.

import { MAP_KINDS, box, mirrorZ, stairsX, stairsZ, building, arenaShell } from '../mapkit.js';

const KIND = MAP_KINDS;
const HALF = 42;

export const meta = {
  id: 'sanctum',
  name: 'SANCTUM',
  tagline: '대칭형 성역',
  desc: '중앙 고지대를 두고 두 팀이 정면으로 부딪히는 표준 대칭 맵. 사방의 계단으로 어디서든 위로 올라갈 수 있습니다.',
  size: '중형',
  half: HALF,
  wallHeight: 14,
  // Domination's control point: the raised centre platform.
  zone: { x: 0, z: 0, r: 10, y0: -1, y1: 9, name: '중앙 고지' },
  theme: {
    exposure: 0.92,
    sky: { top: 0x2f6bb5, mid: 0x7fb0e0, bottom: 0xf6d3a6 },
    fog: { color: 0x18283d, near: 70, far: 280 },
    sun: { color: 0xfff2dc, intensity: 1.45, pos: [58, 96, 44] },
    hemi: { sky: 0xbcd7ff, ground: 0x3f4a5e, intensity: 0.35 },
    palette: {
      ground: '#5b6474', groundSeam: '#2f3644',
      wall: '#6e7686', wallSeam: '#3a4150',
      building: '#59657c', buildingLine: '#39424f', buildingAccent: '#9fb4d0',
      pillar: '#4d586d', pillarLine: '#2f3846', pillarAccent: '#c3d3e8',
    },
  },
};

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

export function build() {
  const half = HALF;
  const boxes = arenaShell(half, meta.wallHeight);

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
  for (const bx of northHalf) boxes.push(mirrorZ(bx));

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

  // Free-for-all drops everyone in wherever there is the most room, so it
  // wants points spread over the whole arena rather than two spawn rooms.
  const freeSpawns = [
    ...spawns[0],
    ...spawns[1],
    { x: -33, z: 0, yaw: Math.PI / 2 },
    { x: 33, z: 0, yaw: -Math.PI / 2 },
    { x: -25, z: 17, yaw: Math.PI },
    { x: 25, z: -17, yaw: 0 },
    { x: -25, z: -17, yaw: 0 },
    { x: 25, z: 17, yaw: Math.PI },
  ];

  return { id: meta.id, name: meta.name, half, boxes, spawns, freeSpawns, zone: meta.zone, theme: meta.theme };
}
