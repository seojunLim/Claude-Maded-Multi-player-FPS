// Renderer, lighting and level geometry. The visual level is generated from
// the exact same boxes the collision code uses, so what you see is what you
// can shoot and stand on.

import * as THREE from 'three';
import { MAP_KINDS } from '/shared/map.js';
import { buildEnvironment } from './materials.js';
import { TEAMS } from '/shared/constants.js';

/* ───────────────────────────── procedural textures ───────────────────── */

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  // Colour written to a canvas is sRGB. Left untagged, three.js reads it as
  // linear and every surface comes out a stop or two too bright and washed —
  // which is what made the level look bleached under an otherwise sane sun.
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(g, size, count, colors, alpha = 0.5) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    g.globalAlpha = Math.random() * alpha;
    const r = Math.random() * 3 + 0.5;
    g.beginPath();
    g.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function concreteTexture(base, seam) {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    speckle(g, s, 900, ['#000000', '#ffffff', '#94a3b8']);
    g.strokeStyle = seam;
    g.lineWidth = 2;
    g.strokeRect(0, 0, s, s);
    g.globalAlpha = 0.5;
    g.beginPath();
    g.moveTo(0, s / 2);
    g.lineTo(s, s / 2);
    g.moveTo(s / 2, 0);
    g.lineTo(s / 2, s);
    g.stroke();
    g.globalAlpha = 1;
  });
}

function panelTexture(base, line, accent) {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    speckle(g, s, 400, ['#000000', '#ffffff']);
    g.strokeStyle = line;
    g.lineWidth = 3;
    g.strokeRect(1, 1, s - 2, s - 2);
    g.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo((i * s) / 4, 0);
      g.lineTo((i * s) / 4, s);
      g.stroke();
    }
    g.fillStyle = accent;
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        g.beginPath();
        g.arc(x * 64 + 12, y * 64 + 12, 2.4, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

function grateTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#3b4453';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#20262f';
    g.lineWidth = 6;
    for (let i = 0; i <= s; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, s);
      g.moveTo(0, i);
      g.lineTo(s, i);
      g.stroke();
    }
    g.strokeStyle = '#59637a';
    g.lineWidth = 2;
    for (let i = 0; i <= s; i += 32) {
      g.beginPath();
      g.moveTo(i + 3, 0);
      g.lineTo(i + 3, s);
      g.stroke();
    }
    speckle(g, s, 300, ['#000000', '#ffffff'], 0.3);
  });
}

function crateTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#7c6a4f';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 500, ['#000000', '#ffffff', '#c8ab7b']);
    g.strokeStyle = '#4b3f2c';
    g.lineWidth = 14;
    g.strokeRect(7, 7, s - 14, s - 14);
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(10, 10);
    g.lineTo(s - 10, s - 10);
    g.moveTo(s - 10, 10);
    g.lineTo(10, s - 10);
    g.stroke();
    g.fillStyle = '#facc15';
    g.globalAlpha = 0.55;
    g.fillRect(0, s / 2 - 6, s, 12);
    g.globalAlpha = 1;
  });
}

function stepTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#79808f';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 600, ['#000000', '#ffffff']);
    g.fillStyle = '#2b3140';
    g.fillRect(0, 0, s, 10);
    g.fillStyle = '#fbbf24';
    g.globalAlpha = 0.35;
    g.fillRect(0, 10, s, 6);
    g.globalAlpha = 1;
  });
}

/* ───────────────────────────── geometry merging ──────────────────────── */

const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

function corner(min, max, axisSigns) {
  return [axisSigns[0] ? max[0] : min[0], axisSigns[1] ? max[1] : min[1], axisSigns[2] ? max[2] : min[2]];
}

/** Merges boxes into one BufferGeometry with world-space tiled UVs. */
function mergeBoxes(boxes, texScale) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];

  for (const b of boxes) {
    const { min, max } = b;
    for (const f of FACES) {
      // Skip faces that can never be seen (undersides sitting on the floor).
      if (f.n[1] === -1 && min[1] <= 0.01) continue;

      const base = pos.length / 3;
      // Build the four corners from the face's u/v basis.
      const originSigns = [
        f.n[0] === 1 || f.u[0] === -1 || f.v[0] === -1 ? 1 : 0,
        f.n[1] === 1 || f.u[1] === -1 || f.v[1] === -1 ? 1 : 0,
        f.n[2] === 1 || f.u[2] === -1 || f.v[2] === -1 ? 1 : 0,
      ];
      const p0 = corner(min, max, originSigns);
      const du = [
        f.u[0] * (max[0] - min[0]),
        f.u[1] * (max[1] - min[1]),
        f.u[2] * (max[2] - min[2]),
      ];
      const dv = [
        f.v[0] * (max[0] - min[0]),
        f.v[1] * (max[1] - min[1]),
        f.v[2] * (max[2] - min[2]),
      ];
      const pts = [
        p0,
        [p0[0] + du[0], p0[1] + du[1], p0[2] + du[2]],
        [p0[0] + du[0] + dv[0], p0[1] + du[1] + dv[1], p0[2] + du[2] + dv[2]],
        [p0[0] + dv[0], p0[1] + dv[1], p0[2] + dv[2]],
      ];
      for (const p of pts) {
        pos.push(p[0], p[1], p[2]);
        nor.push(f.n[0], f.n[1], f.n[2]);
        // Tile against world position so neighbouring boxes line up.
        const uu = p[0] * f.u[0] + p[1] * f.u[1] + p[2] * f.u[2];
        const vv = p[0] * f.v[0] + p[1] * f.v[1] + p[2] * f.v[2];
        uv.push(uu * texScale, vv * texScale);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/* ─────────────────────────────────── stage ───────────────────────────── */

const DEFAULT_THEME = {
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
};

/** Fills in anything a map's theme leaves out. */
function mergeTheme(theme) {
  const t = theme || {};
  return {
    exposure: t.exposure ?? DEFAULT_THEME.exposure,
    sky: { ...DEFAULT_THEME.sky, ...(t.sky || {}) },
    fog: { ...DEFAULT_THEME.fog, ...(t.fog || {}) },
    sun: { ...DEFAULT_THEME.sun, ...(t.sun || {}) },
    hemi: { ...DEFAULT_THEME.hemi, ...(t.hemi || {}) },
    palette: { ...DEFAULT_THEME.palette, ...(t.palette || {}) },
  };
}

export class Stage {
  constructor(canvas, opts = {}) {
    // Each arena carries its own sky, sun and material palette, so the same
    // renderer produces a noon desert or a sodium-lit foundry unchanged.
    const theme = mergeTheme(opts.theme);
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    // Phone GPUs cannot afford a 3x device pixel ratio, and shadow maps are the
    // single most expensive thing here, so both are scaled back on touch.
    this.mobile = !!opts.mobile;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = opts.shadows !== false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = theme.exposure;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);

    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 90, 2, 0.06, 600);
    this.camera.rotation.order = 'YXZ';

    // The first-person weapon lives in its own scene drawn after the world with
    // a cleared depth buffer. That keeps it from clipping into walls, keeps its
    // lighting off the level, and gives it a fixed FOV independent of the
    // player's field-of-view setting.
    this.weaponScene = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(62, 2, 0.01, 12);
    // Kept close to the world's own sun/fill balance. Lighting the view model
    // harder than the level is a quick way to make the weapon look pasted on.
    this.weaponScene.add(new THREE.HemisphereLight(0xd8e8ff, 0x38445c, 0.35));
    const wKey = new THREE.DirectionalLight(0xfff3e2, 1.15);
    wKey.position.set(0.6, 1, 0.4);
    this.weaponScene.add(wKey);
    const wRim = new THREE.DirectionalLight(0x9dc2ff, 0.5);
    wRim.position.set(-0.8, 0.2, -0.6);
    this.weaponScene.add(wRim);

    this.baseFov = opts.fov ?? 90;

    // A prefiltered sky gives every metal surface something to reflect.
    this.scene.environment = buildEnvironment(this.renderer, {
      top: theme.sky.top,
      mid: theme.sky.mid,
      bottom: theme.sky.bottom,
      sunDir: new THREE.Vector3(...theme.sun.pos),
    });
    // The view model gets a neutral dome of its own rather than the sky. Gun
    // metal is a mirror at these roughnesses, and it is always seen from above,
    // so the sky's sandy lower half lands squarely on every face pointed at the
    // player and turns the receiver tan.
    this.weaponScene.environment = buildEnvironment(this.renderer, {
      top: 0x9db0c4,
      mid: 0x818b98,
      bottom: 0x4b5058,
      sunDir: new THREE.Vector3(0.6, 1, 0.4),
    });
    // Image-based light is ambient, so it has to stay well under the sun or
    // everything washes out into flat white.
    this.scene.environmentIntensity = 0.32;
    this.weaponScene.environmentIntensity = 0.45;

    this.addLights();
    this.addSky();
    this.resize();
  }

  addLights() {
    const theme = this.theme;
    // With an environment map doing the ambient work, the fill lights can come
    // down a long way — otherwise everything washes out flat.
    const hemi = new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight(theme.hemi.sky, 0.12));

    const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
    sun.position.set(...theme.sun.pos);
    sun.castShadow = true;
    const shadowRes = this.mobile ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowRes, shadowRes);
    sun.shadow.radius = this.mobile ? 1 : 2.5;
    const s = 62; // replaced per-map in buildLevel() once the arena size is known
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.sun = sun;

    // Bounce light from the opposite side so shadowed faces are readable.
    const fill = new THREE.DirectionalLight(theme.hemi.sky, 0.25);
    fill.position.set(-theme.sun.pos[0] * 0.85, theme.sun.pos[1] * 0.45, -theme.sun.pos[2] * 1.3);
    this.scene.add(fill);
  }

  addSky() {
    const geo = new THREE.SphereGeometry(420, 32, 18);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(this.theme.sky.top) },
        mid: { value: new THREE.Color(this.theme.sky.mid) },
        bottom: { value: new THREE.Color(this.theme.sky.bottom) },
      },
      vertexShader: `
        varying float vH;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vH = normalize(world.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        varying float vH;
        void main() {
          float h = clamp(vH, -1.0, 1.0);
          vec3 c = h > 0.06
            ? mix(mid, top, clamp((h - 0.06) / 0.55, 0.0, 1.0))
            : mix(bottom, mid, clamp((h + 0.22) / 0.28, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    this.scene.add(sky);
  }

  buildLevel(map) {
    const K = MAP_KINDS;
    const c = this.theme.palette;
    const groups = {
      [K.GROUND]: { tex: concreteTexture(c.ground, c.groundSeam), scale: 0.18, rough: 0.95 },
      [K.WALL]: { tex: concreteTexture(c.wall, c.wallSeam), scale: 0.22, rough: 0.9 },
      [K.BUILDING]: { tex: panelTexture(c.building, c.buildingLine, c.buildingAccent), scale: 0.25, rough: 0.7, metal: 0.15 },
      [K.PLATFORM]: { tex: grateTexture(), scale: 0.3, rough: 0.55, metal: 0.2 },
      [K.CRATE]: { tex: crateTexture(), scale: 0.42, rough: 0.85 },
      [K.STEP]: { tex: stepTexture(), scale: 0.42, rough: 0.9 },
      [K.PILLAR]: { tex: panelTexture(c.pillar, c.pillarLine, c.pillarAccent), scale: 0.3, rough: 0.6, metal: 0.15 },
    };

    // A bigger arena needs a wider shadow frustum or the far half goes unlit.
    this.sun.shadow.camera.left = -(map.half + 12);
    this.sun.shadow.camera.right = map.half + 12;
    this.sun.shadow.camera.top = map.half + 12;
    this.sun.shadow.camera.bottom = -(map.half + 12);
    this.sun.shadow.camera.updateProjectionMatrix();

    const level = new THREE.Group();
    level.name = 'level';
    for (const [kind, cfg] of Object.entries(groups)) {
      const boxes = map.boxes.filter((b) => b.kind === kind);
      if (!boxes.length) continue;
      const geo = mergeBoxes(boxes, cfg.scale);
      const mat = new THREE.MeshStandardMaterial({
        map: cfg.tex,
        roughness: cfg.rough ?? 0.85,
        metalness: cfg.metal ?? 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = kind !== MAP_KINDS.GROUND;
      mesh.receiveShadow = true;
      level.add(mesh);
    }

    // Team-coloured light strips above each spawn so orientation is instant.
    for (const team of TEAMS) {
      const z = team.id === 0 ? map.half - 1.2 : -(map.half - 1.2);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(56, 0.5, 0.3),
        new THREE.MeshBasicMaterial({ color: team.color }),
      );
      strip.position.set(0, 6.4, z);
      level.add(strip);

      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(58, 8),
        new THREE.MeshBasicMaterial({ color: team.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
      );
      glow.position.set(0, 6, z + (team.id === 0 ? -0.5 : 0.5));
      level.add(glow);
    }

    this.scene.add(level);
    this.level = level;
    return level;
  }

  /**
   * Domination's control point, drawn in the world so it can be found without
   * looking at the minimap: a floor disc plus a waist-high ring of light.
   */
  addZoneMarker(zone) {
    const group = new THREE.Group();
    group.position.set(zone.x, 0, zone.z);

    const disc = new THREE.Mesh(
      new THREE.RingGeometry(zone.r - 0.35, zone.r, 64),
      new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.06;
    disc.renderOrder = 2;
    group.add(disc);

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(zone.r, zone.r, 2.2, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    );
    wall.position.y = 1.1;
    wall.renderOrder = 2;
    group.add(wall);

    this.scene.add(group);
    this.zoneMarker = {
      group,
      /** @param color three.js colour of the holding team, or null when free. */
      setOwner(color, contested) {
        const c = color ?? 0xe2e8f0;
        disc.material.color.setHex(c);
        wall.material.color.setHex(c);
        disc.material.opacity = contested ? 0.95 : 0.7;
        wall.material.opacity = contested ? 0.2 : 0.1;
      },
    };
    return this.zoneMarker;
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
  }

  setFov(fov) {
    this.baseFov = fov;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = aspect;
    this.weaponCamera.updateProjectionMatrix();
  }

  render() {
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.weaponScene, this.weaponCamera);
    this.renderer.autoClear = true;
  }
}
