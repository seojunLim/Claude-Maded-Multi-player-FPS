// Procedural PBR materials.
//
// Everything here is generated in code — albedo, a real normal map derived
// from a height field, and a roughness map — so surfaces catch light instead
// of reading as flat colour. A prefiltered environment map built from the sky
// gives metal something to reflect, which is most of what separates "plastic
// toy" from "gear" in a physically based renderer.

import * as THREE from 'three';

const TEX = 512;
const cache = new Map();

function canvas(size = TEX) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * Common texture setup. The mipmap settings matter more than they look: a
 * DataTexture defaults to nearest filtering with no mipmaps, so once parts are
 * tiled to a real texel density every normal map turns into salt-and-pepper
 * aliasing. `colorSpace` matters just as much — an albedo canvas read as linear
 * comes out pale and washed, which is what makes procedural kit look like
 * plastic.
 */
function finish(tex, { srgb = false } = {}) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------ height maps */

/** Value noise, tiling on both axes so the texture repeats seamlessly. */
function noiseField(size, cells, seed = 1) {
  const rand = mulberry(seed);
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const out = new Float32Array(size * size);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const g = (gx, gy) => grid[((gy % cells) + cells) % cells * cells + (((gx % cells) + cells) % cells)];
      const a = g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx;
      const b = g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx;
      out[y * size + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

function fbm(size, octaves, baseCells, seed) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = noiseField(size, baseCells * 2 ** o, seed + o * 17);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Sobel filter over a height field -> tangent-space normal map. */
function normalFromHeight(height, size, strength = 2.2) {
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return finish(tex);
}

function grayscaleTexture(field, size, lo = 0, hi = 1) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < field.length; i++) {
    const v = Math.round((lo + field[i] * (hi - lo)) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return finish(tex);
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------- surface kinds */

/**
 * Each surface returns { map, normalMap, roughnessMap } built from one height
 * field, so the bumps you see in the albedo are the bumps that catch light.
 */
const SURFACES = {
  // Woven fabric / cordura for vests and packs.
  fabric(color) {
    const size = 256;
    const height = fbm(size, 3, 24, 3);
    const c = canvas(size);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, size, size);
    // Weave: alternating warp and weft threads.
    for (let y = 0; y < size; y += 4) {
      g.fillStyle = y % 8 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
      g.fillRect(0, y, size, 2);
    }
    for (let x = 0; x < size; x += 4) {
      g.fillStyle = x % 8 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
      g.fillRect(x, 0, 2, size);
    }
    const img = g.getImageData(0, 0, size, size);
    for (let i = 0; i < height.length; i++) {
      const k = 0.86 + height[i] * 0.28;
      img.data[i * 4] *= k;
      img.data[i * 4 + 1] *= k;
      img.data[i * 4 + 2] *= k;
    }
    g.putImageData(img, 0, 0);
    // Thread bumps plus cloth wrinkle.
    const bump = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const weave = ((x >> 2) + (y >> 2)) % 2 ? 0.55 : 0.45;
        bump[y * size + x] = weave * 0.6 + height[y * size + x] * 0.4;
      }
    }
    return {
      map: finish(new THREE.CanvasTexture(c), { srgb: true }),
      normalMap: normalFromHeight(bump, size, 1.4),
      roughnessMap: grayscaleTexture(height, size, 0.78, 0.98),
    };
  },

  // Machined / blued steel for barrels and receivers.
  steel(color) {
    const size = 256;
    const height = fbm(size, 4, 8, 11);
    const c = canvas(size);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, size, size);
    // Fine machining lines along one axis.
    for (let y = 0; y < size; y++) {
      const v = height[y * size] * 0.16 - 0.05;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      g.fillRect(0, y, size, 1);
    }
    // Wear scuffs on the edges of the tile.
    const rand = mulberry(5);
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(210,215,225,${0.05 + rand() * 0.12})`;
      g.lineWidth = rand() * 1.6;
      g.beginPath();
      const x = rand() * size;
      const y = rand() * size;
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 40, y + (rand() - 0.5) * 8);
      g.stroke();
    }
    return {
      map: finish(new THREE.CanvasTexture(c), { srgb: true }),
      normalMap: normalFromHeight(height, size, 0.7),
      roughnessMap: grayscaleTexture(height, size, 0.22, 0.55),
    };
  },

  // Textured polymer for grips, stocks and handguards.
  polymer(color) {
    const size = 256;
    const height = fbm(size, 3, 32, 7);
    const c = canvas(size);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, size, size);
    const img = g.getImageData(0, 0, size, size);
    for (let i = 0; i < height.length; i++) {
      const k = 0.82 + height[i] * 0.36;
      img.data[i * 4] *= k;
      img.data[i * 4 + 1] *= k;
      img.data[i * 4 + 2] *= k;
    }
    g.putImageData(img, 0, 0);
    return {
      map: finish(new THREE.CanvasTexture(c), { srgb: true }),
      normalMap: normalFromHeight(height, size, 1.8),
      roughnessMap: grayscaleTexture(height, size, 0.45, 0.8),
    };
  },

  // Rubber for boot soles, grips and pads.
  rubber(color) {
    const size = 256;
    const height = fbm(size, 2, 40, 23);
    const c = canvas(size);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, size, size);
    const img = g.getImageData(0, 0, size, size);
    for (let i = 0; i < height.length; i++) {
      const k = 0.88 + height[i] * 0.2;
      img.data[i * 4] *= k;
      img.data[i * 4 + 1] *= k;
      img.data[i * 4 + 2] *= k;
    }
    g.putImageData(img, 0, 0);
    return {
      map: finish(new THREE.CanvasTexture(c), { srgb: true }),
      normalMap: normalFromHeight(height, size, 2.2),
      roughnessMap: grayscaleTexture(height, size, 0.85, 1.0),
    };
  },
};

/**
 * Cached PBR material. `kind` picks the surface treatment, `color` the base
 * tint; both go into the cache key so avatars sharing a look share the GPU
 * resources too.
 */
export function pbr(kind, color, opts = {}) {
  const key = `${kind}|${color}|${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);

  const build = SURFACES[kind] || SURFACES.polymer;
  const maps = build(color);
  const mat = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    metalness: opts.metalness ?? (kind === 'steel' ? 0.85 : 0.05),
    roughness: opts.roughness ?? 1,
    envMapIntensity: opts.envMapIntensity ?? (kind === 'steel' ? 1.15 : 0.5),
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
    ...(opts.emissive ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: opts.emissiveIntensity ?? 1 } : {}),
  });
  cache.set(key, mat);
  return mat;
}

/** Plain lit material for small parts that do not need a texture. */
export function solid(color, opts = {}) {
  const key = `solid|${color}|${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.1,
    roughness: opts.roughness ?? 0.7,
    envMapIntensity: opts.envMapIntensity ?? 0.6,
    ...(opts.doubleSided ? { side: THREE.DoubleSide } : {}),
    ...(opts.emissive ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: opts.emissiveIntensity ?? 1 } : {}),
  });
  cache.set(key, mat);
  return mat;
}

/**
 * Builds a prefiltered environment map from a sky-coloured scene. Without one,
 * `metalness` renders almost black — this is what makes gun metal read as
 * metal rather than dark plastic.
 */
export function buildEnvironment(renderer, colors) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color(colors.top) },
      mid: { value: new THREE.Color(colors.mid) },
      bottom: { value: new THREE.Color(colors.bottom) },
      sun: { value: new THREE.Vector3().copy(colors.sunDir).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sun;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(mid, top, clamp(h / 0.6, 0.0, 1.0))
                         : mix(mid, bottom, clamp(-h / 0.4, 0.0, 1.0));
        // A bright sun disc so polished surfaces get a specular highlight.
        float d = max(0.0, dot(normalize(vDir), sun));
        c += vec3(1.0, 0.92, 0.78) * pow(d, 320.0) * 3.0;
        c += vec3(1.0, 0.85, 0.6) * pow(d, 8.0) * 0.12;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geo, mat));

  const target = pmrem.fromScene(scene, 0.04);
  geo.dispose();
  mat.dispose();
  pmrem.dispose();
  return target.texture;
}

export function disposeMaterialCache() {
  for (const mat of cache.values()) mat.dispose();
  cache.clear();
}
