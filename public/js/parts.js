// Geometry assembly helpers shared by the character and weapon builders.
//
// Both are made of dozens of small primitives. Merging everything that shares a
// material keeps a fully kitted soldier down to a handful of draw calls instead
// of one per pouch.

import * as THREE from 'three';

/** Concatenates BufferGeometries that share an attribute layout. */
export function mergeGeometries(geos) {
  if (geos.length === 1) return geos[0];

  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geos) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const index = new (vertexCount > 65535 ? Uint32Array : Uint16Array)(indexCount);

  let vOff = 0;
  let iOff = 0;
  for (const g of geos) {
    const pos = g.attributes.position;
    position.set(pos.array, vOff * 3);
    if (g.attributes.normal) normal.set(g.attributes.normal.array, vOff * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vOff * 2);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[iOff + i] = g.index.array[i] + vOff;
      iOff += g.index.count;
    } else {
      for (let i = 0; i < pos.count; i++) index[iOff + i] = i + vOff;
      iOff += pos.count;
    }
    vOff += pos.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Rescales a primitive's 0..1 UVs by its physical size so every part ends up
 * with the same texel density. Without this a 6cm grip shows one entire noise
 * tile and reads as gravel, while a 1m barrel shows the same tile stretched.
 * `density` is tiles per metre. Must run before the part is transformed.
 *
 * The two UV axes are scaled separately, because a barrel is 90cm along V and
 * 7cm around U. `geo.userData.uvSpan` carries the real [u, v] arc lengths when
 * the caller knows them (a cylinder's U wraps a circumference, not a bounding
 * box); otherwise the two largest bounding-box dimensions are a fair guess.
 */
export function scaleUV(geo, density) {
  const uv = geo.attributes.uv;
  if (!uv || !density) return geo;

  let span = geo.userData.uvSpan;
  if (!span) {
    geo.computeBoundingBox();
    const s = geo.boundingBox.getSize(new THREE.Vector3());
    const dims = [s.x, s.y, s.z].sort((a, b) => b - a);
    span = [dims[0], dims[1]];
  }
  const ku = span[0] * density;
  const kv = span[1] * density;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
  uv.needsUpdate = true;
  return geo;
}

/* ------------------------------------------------------------- primitives */
//
// Thin wrappers over the three.js primitives that record how much real surface
// each UV axis covers, so `scaleUV` can keep the texel density even.

const TAU = Math.PI * 2;

/** Axis-aligned box; UVs are sized for its two largest faces. */
export function box(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const dims = [w, h, d].sort((a, b) => b - a);
  g.userData.uvSpan = [dims[0], dims[1]];
  return g;
}

/** Cylinder standing on Y. U wraps the circumference, V runs the height. */
export function cyl(r1, r2, h, seg = 10) {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg);
  g.userData.uvSpan = [TAU * ((r1 + r2) / 2), h];
  return g;
}

/** Cylinder lying along -Z, the axis weapons are built on. */
export function tube(r1, r2, len, seg = 12) {
  const g = cyl(r1, r2, len, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

export function capsule(r, len, seg = 8) {
  const g = new THREE.CapsuleGeometry(r, len, 4, seg);
  g.userData.uvSpan = [TAU * r, len + 2 * r];
  return g;
}

export function ball(r, w = 12, h = 10) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.userData.uvSpan = [TAU * r, Math.PI * r];
  return g;
}

/** Collects transformed geometry per material, then emits one mesh each. */
export class Bucket {
  constructor(density = 0) {
    this.byMat = new Map();
    this.density = density;
  }

  add(geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    scaleUV(geo, this.density);
    geo.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(sx, sy, sz),
      ),
    );
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat).push(geo);
    return this;
  }

  build(target, castShadow = true) {
    for (const [mat, geos] of this.byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = castShadow;
      target.add(mesh);
    }
    this.byMat.clear();
    return target;
  }
}
