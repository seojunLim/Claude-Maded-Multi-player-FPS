// Weapon models, built once per hero and used by both the first-person view
// model and the third-person avatars, so what an enemy is holding is the same
// object you hold yourself.
//
// Weapons are modelled at real-world scale (an assault rifle is ~0.9m) with the
// barrel pointing down -z. Moving parts stay separate objects; everything else
// is merged per material to keep draw calls down.

import * as THREE from 'three';
import { pbr, solid } from './materials.js';
import { mergeGeometries, scaleUV, box, tube } from './parts.js';

/* ------------------------------------------------------------- primitives */

// Texture tiles per metre. A weapon is inspected from 40cm in the first-person
// view, so its surfaces get roughly four times the texel density of a soldier
// seen across the map.
const UV_DENSITY = 14;

function boxGeo(w, h, d) {
  return box(w, h, d);
}

function tubeGeo(r, len, seg = 14) {
  return tube(r, r, len, seg);
}

function coneGeo(r1, r2, len, seg = 14) {
  return tube(r1, r2, len, seg);
}

/** part spec -> geometry positioned in weapon space */
function place(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 }) {
  scaleUV(geo, UV_DENSITY); // must happen while the part is still at origin
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
  return geo;
}

/**
 * Merges geometries that share a material into one mesh each. Weapons are
 * built from dozens of small parts; without this every avatar would cost
 * dozens of draw calls.
 */
function mergeByMaterial(parts) {
  const byMat = new Map();
  for (const p of parts) {
    if (!byMat.has(p.mat)) byMat.set(p.mat, []);
    byMat.get(p.mat).push(p.geo);
  }
  const meshes = [];
  for (const [mat, geos] of byMat) {
    meshes.push(new THREE.Mesh(mergeGeometries(geos), mat));
  }
  return meshes;
}

/* -------------------------------------------------------------- materials */

// Gun metal is kept a touch rough and low on environment reflection: a mirror
// finish picks the sky straight up and the whole weapon turns blue, which reads
// as painted plastic rather than steel. The albedo has to stay near-neutral for
// the same reason in reverse — a metal tints its specular highlight, so a
// slightly warm "blued" tone turns the receiver brown under a warm key light.
const M = {
  get steel() {
    return pbr('steel', '#67696d', { metalness: 0.88, roughness: 0.5, envMapIntensity: 0.6 });
  },
  get blued() {
    return pbr('steel', '#2e3033', { metalness: 0.85, roughness: 0.44, envMapIntensity: 0.55 });
  },
  get polymer() {
    return pbr('polymer', '#33383f', { metalness: 0.04, roughness: 0.72 });
  },
  get tan() {
    return pbr('polymer', '#6d6350', { metalness: 0.04, roughness: 0.78 });
  },
  get grip() {
    return pbr('rubber', '#22252a', { metalness: 0.02, roughness: 0.95 });
  },
  // Double-sided: a lens disc has to read from behind the optic (the shooter)
  // and from in front of it (everyone else), and one flat disc serves both.
  get glass() {
    return solid('#0e2233', {
      metalness: 0.1,
      roughness: 0.08,
      emissive: '#0a2a3a',
      emissiveIntensity: 0.35,
      doubleSided: true,
    });
  },
};

/* --------------------------------------------------------------- weapons */

/**
 * Every builder returns { parts, moving, muzzleZ, sight, grip, support } where
 * `parts` are merged into static meshes and `moving` are kept separate for
 * animation. `grip` and `support` are where the firing hand and the support
 * hand sit, with the rake of the surface they wrap, so the view model does not
 * have to keep its own table of magic numbers per weapon.
 */
const BUILDERS = {
  // Assault rifle: railed handguard, adjustable stock, red dot.
  ranger(detail) {
    const parts = [];
    const add = (geo, mat, at) => parts.push({ geo: place(geo, at), mat });

    // Upper + lower receiver.
    add(boxGeo(0.062, 0.09, 0.30), M.blued, { y: 0.012, z: 0.02 });
    add(boxGeo(0.058, 0.055, 0.20), M.polymer, { y: -0.048, z: 0.06 });
    // Ejection port cover.
    add(boxGeo(0.005, 0.032, 0.075), M.steel, { x: 0.033, y: 0.022, z: 0.0 });
    // Handguard with vent slots.
    add(tubeGeo(0.035, 0.30, 12), M.polymer, { y: 0.012, z: -0.28 });
    if (detail) {
      for (let i = 0; i < 5; i++) {
        add(boxGeo(0.074, 0.008, 0.016), M.blued, { y: 0.012, z: -0.18 - i * 0.05 });
      }
      // Top rail.
      for (let i = 0; i < 9; i++) {
        add(boxGeo(0.03, 0.008, 0.012), M.blued, { y: 0.062, z: 0.1 - i * 0.045 });
      }
    }
    // Barrel + flash hider.
    add(tubeGeo(0.011, 0.26, 10), M.steel, { y: 0.012, z: -0.52 });
    add(coneGeo(0.019, 0.014, 0.06, 10), M.blued, { y: 0.012, z: -0.66 });
    // Gas block.
    add(boxGeo(0.026, 0.03, 0.04), M.steel, { y: 0.03, z: -0.44 });
    // Pistol grip, angled.
    add(boxGeo(0.036, 0.115, 0.05), M.grip, { y: -0.10, z: 0.115, rx: 0.28 });
    // Angled foregrip: gives the support hand something real to wrap.
    add(boxGeo(0.034, 0.09, 0.044), M.grip, { y: -0.062, z: -0.325, rx: 0.5 });
    // Stock: tube + butt pad.
    add(tubeGeo(0.018, 0.16, 10), M.steel, { y: 0.008, z: 0.20 });
    add(boxGeo(0.05, 0.085, 0.10), M.polymer, { y: -0.005, z: 0.27 });
    add(boxGeo(0.052, 0.09, 0.018), M.grip, { y: -0.005, z: 0.325 });
    // Trigger guard.
    add(boxGeo(0.03, 0.006, 0.05), M.blued, { y: -0.052, z: 0.075 });

    const moving = {};
    // Magazine — curved, drops away on reload.
    const magParts = [
      { geo: place(boxGeo(0.032, 0.13, 0.062), { y: -0.065, rz: 0, rx: 0.06 }), mat: M.polymer },
      { geo: place(boxGeo(0.034, 0.012, 0.064), { y: -0.128 }), mat: M.blued },
    ];
    moving.mag = { group: mergeByMaterial(magParts), at: { x: 0, y: -0.075, z: 0.03 } };
    // Charging handle rides back when the weapon cycles.
    moving.bolt = {
      group: mergeByMaterial([{ geo: place(boxGeo(0.05, 0.016, 0.03), {}), mat: M.steel }]),
      at: { x: 0, y: 0.05, z: 0.15 },
      travel: 0.05,
    };

    const optic = [
      { geo: place(boxGeo(0.034, 0.032, 0.075), { y: 0.086 }), mat: M.blued },
      { geo: place(boxGeo(0.042, 0.014, 0.03), { y: 0.066 }), mat: M.blued },
    ];
    for (const o of optic) parts.push(o);
    add(new THREE.CircleGeometry(0.013, 14), M.glass, { y: 0.086, z: 0.036 });

    return {
      parts,
      moving,
      muzzleZ: -0.7,
      sight: { y: 0.086, z: 0 },
      ads: 0.086,
      grip: { y: -0.088, z: 0.112, rx: 0.28 },
      support: { y: -0.05, z: -0.322, rx: 0.5 },
    };
  },

  // Pump shotgun: heat shield, tube magazine, thick barrel.
  sentinel(detail) {
    const parts = [];
    const add = (geo, mat, at) => parts.push({ geo: place(geo, at), mat });

    add(boxGeo(0.07, 0.10, 0.26), M.blued, { y: 0.01, z: 0.06 });
    add(tubeGeo(0.021, 0.62, 12), M.blued, { y: 0.025, z: -0.36 });
    add(tubeGeo(0.014, 0.44, 10), M.steel, { y: -0.018, z: -0.30 }); // tube mag
    if (detail) {
      // Heat shield with cooling holes.
      add(tubeGeo(0.028, 0.26, 12), M.steel, { y: 0.025, z: -0.30 });
      for (let i = 0; i < 6; i++) {
        add(boxGeo(0.062, 0.01, 0.02), M.blued, { y: 0.025, z: -0.2 - i * 0.04 });
      }
    }
    add(coneGeo(0.026, 0.022, 0.05, 12), M.blued, { y: 0.025, z: -0.665 });
    add(boxGeo(0.04, 0.12, 0.055), M.grip, { y: -0.095, z: 0.14, rx: 0.3 });
    add(boxGeo(0.055, 0.10, 0.20), M.tan, { y: -0.02, z: 0.28, rx: -0.08 });
    add(boxGeo(0.058, 0.10, 0.02), M.grip, { y: -0.03, z: 0.38 });
    add(boxGeo(0.012, 0.014, 0.02), M.steel, { y: 0.055, z: -0.6 }); // bead sight

    const moving = {};
    // The forend carries its own angled grip, so the support hand can ride the
    // pump back and forth as the action cycles.
    moving.pump = {
      group: mergeByMaterial([
        { geo: place(tubeGeo(0.032, 0.15, 12), {}), mat: M.tan },
        { geo: place(boxGeo(0.07, 0.012, 0.14), { y: -0.028 }), mat: M.tan },
        { geo: place(boxGeo(0.036, 0.08, 0.044), { y: -0.062, rx: 0.45 }), mat: M.grip },
      ]),
      at: { x: 0, y: -0.018, z: -0.30 },
      travel: 0.09,
    };
    moving.mag = { group: [], at: { x: 0, y: 0, z: 0 } }; // shells, no box mag

    return {
      parts,
      moving,
      muzzleZ: -0.69,
      sight: { y: 0.055, z: 0 },
      ads: 0.055,
      grip: { y: -0.082, z: 0.137, rx: 0.3 },
      support: { y: -0.068, z: -0.297, rx: 0.45 },
      supportRidesBolt: true,
    };
  },

  // Bolt-action rifle: long fluted barrel, big scope, bipod.
  marksman(detail) {
    const parts = [];
    const add = (geo, mat, at) => parts.push({ geo: place(geo, at), mat });

    add(boxGeo(0.055, 0.085, 0.34), M.blued, { y: 0.01, z: 0.04 });
    add(tubeGeo(0.014, 0.72, 12), M.steel, { y: 0.012, z: -0.52 });
    if (detail) {
      // Fluting.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        add(boxGeo(0.006, 0.006, 0.4), M.blued, {
          x: Math.cos(a) * 0.013,
          y: 0.012 + Math.sin(a) * 0.013,
          z: -0.5,
        });
      }
    }
    add(coneGeo(0.022, 0.018, 0.07, 12), M.blued, { y: 0.012, z: -0.90 });
    // Chassis stock with thumbhole and cheek riser.
    add(boxGeo(0.05, 0.09, 0.26), M.tan, { y: -0.03, z: 0.29 });
    add(boxGeo(0.052, 0.045, 0.14), M.tan, { y: 0.045, z: 0.26 });
    add(boxGeo(0.055, 0.09, 0.02), M.grip, { y: -0.03, z: 0.425 });
    add(boxGeo(0.036, 0.115, 0.05), M.grip, { y: -0.095, z: 0.17, rx: 0.24 });
    add(boxGeo(0.034, 0.09, 0.044), M.grip, { y: -0.058, z: -0.335, rx: 0.45 });
    // Scope: tube, bells, turrets, lens.
    add(tubeGeo(0.021, 0.26, 14), M.blued, { y: 0.10, z: -0.06 });
    add(coneGeo(0.032, 0.024, 0.06, 14), M.blued, { y: 0.10, z: -0.21 });
    add(coneGeo(0.026, 0.021, 0.05, 14), M.blued, { y: 0.10, z: 0.09 });
    add(new THREE.CircleGeometry(0.029, 16), M.glass, { y: 0.10, z: -0.238 });
    add(new THREE.CircleGeometry(0.019, 16), M.glass, { y: 0.10, z: 0.113 });
    if (detail) {
      add(tubeGeo(0.011, 0.03, 10), M.steel, { y: 0.125, z: -0.06, rx: Math.PI / 2 });
      add(tubeGeo(0.011, 0.03, 10), M.steel, { x: 0.025, y: 0.10, z: -0.06, rz: Math.PI / 2 });
      add(boxGeo(0.03, 0.03, 0.016), M.blued, { y: 0.078, z: -0.14 });
      add(boxGeo(0.03, 0.03, 0.016), M.blued, { y: 0.078, z: 0.02 });
      // Bipod legs, folded back.
      add(boxGeo(0.008, 0.008, 0.16), M.blued, { x: -0.02, y: -0.03, z: -0.46, rx: 0.5 });
      add(boxGeo(0.008, 0.008, 0.16), M.blued, { x: 0.02, y: -0.03, z: -0.46, rx: 0.5 });
    }

    const moving = {};
    moving.mag = {
      group: mergeByMaterial([{ geo: place(boxGeo(0.03, 0.08, 0.07), { y: -0.04 }), mat: M.blued }]),
      at: { x: 0, y: -0.06, z: 0.02 },
    };
    moving.bolt = {
      group: mergeByMaterial([
        { geo: place(tubeGeo(0.009, 0.09, 8), {}), mat: M.steel },
        { geo: place(tubeGeo(0.008, 0.05, 8), { x: 0.03, z: 0.04, ry: Math.PI / 2 }), mat: M.steel },
        { geo: place(new THREE.SphereGeometry(0.012, 10, 8), { x: 0.055, z: 0.04 }), mat: M.steel },
      ]),
      at: { x: 0.03, y: 0.035, z: 0.12 },
      travel: 0.08,
    };

    return {
      parts,
      moving,
      muzzleZ: -0.94,
      sight: { y: 0.10, z: 0 },
      ads: 0.10,
      grip: { y: -0.082, z: 0.167, rx: 0.24 },
      support: { y: -0.046, z: -0.332, rx: 0.45 },
    };
  },

  // Compact SMG: suppressor, folding stock, top rail.
  medic(detail) {
    const parts = [];
    const add = (geo, mat, at) => parts.push({ geo: place(geo, at), mat });

    add(boxGeo(0.056, 0.085, 0.22), M.polymer, { y: 0.01, z: 0.03 });
    add(boxGeo(0.05, 0.05, 0.12), M.blued, { y: 0.028, z: -0.12 });
    add(tubeGeo(0.009, 0.14, 10), M.steel, { y: 0.028, z: -0.24 });
    // Suppressor.
    add(tubeGeo(0.021, 0.17, 14), M.blued, { y: 0.028, z: -0.36 });
    if (detail) {
      for (let i = 0; i < 4; i++) add(tubeGeo(0.023, 0.006, 14), M.steel, { y: 0.028, z: -0.30 - i * 0.04 });
      for (let i = 0; i < 6; i++) add(boxGeo(0.026, 0.007, 0.012), M.blued, { y: 0.056, z: 0.06 - i * 0.04 });
    }
    add(boxGeo(0.034, 0.10, 0.045), M.grip, { y: -0.085, z: 0.10, rx: 0.22 });
    add(boxGeo(0.032, 0.08, 0.042), M.grip, { y: -0.030, z: -0.192, rx: 0.45 });
    // Folding stock struts.
    add(boxGeo(0.008, 0.008, 0.16), M.steel, { x: -0.026, y: 0.02, z: 0.18 });
    add(boxGeo(0.008, 0.008, 0.16), M.steel, { x: 0.026, y: 0.02, z: 0.18 });
    add(boxGeo(0.058, 0.06, 0.016), M.polymer, { y: 0.01, z: 0.26 });
    // Small optic.
    add(boxGeo(0.03, 0.028, 0.055), M.blued, { y: 0.078 });
    add(new THREE.CircleGeometry(0.011, 12), M.glass, { y: 0.078, z: 0.026 });

    const moving = {};
    moving.mag = {
      group: mergeByMaterial([{ geo: place(boxGeo(0.028, 0.15, 0.05), { y: -0.075 }), mat: M.polymer }]),
      at: { x: 0, y: -0.06, z: 0.02 },
    };
    moving.bolt = {
      group: mergeByMaterial([{ geo: place(boxGeo(0.044, 0.014, 0.026), {}), mat: M.steel }]),
      at: { x: 0.026, y: 0.05, z: 0.06 },
      travel: 0.035,
    };

    return {
      parts,
      moving,
      muzzleZ: -0.45,
      sight: { y: 0.078, z: 0 },
      ads: 0.078,
      grip: { y: -0.075, z: 0.098, rx: 0.22 },
      support: { y: -0.022, z: -0.190, rx: 0.45 },
    };
  },
};

/**
 * Builds a weapon.
 * @param heroId which weapon
 * @param detail true for the first-person model, false for distant avatars
 * @returns {{group: THREE.Group, muzzle: THREE.Object3D, mag: THREE.Group,
 *            bolt: THREE.Object3D, sightHeight: number,
 *            grip: object, support: object, supportRidesBolt: boolean}}
 */
export function buildWeapon(heroId, detail = true) {
  const build = BUILDERS[heroId] || BUILDERS.ranger;
  const spec = build(detail);

  const group = new THREE.Group();
  for (const mesh of mergeByMaterial(spec.parts)) {
    mesh.castShadow = true;
    group.add(mesh);
  }

  const attach = (moving) => {
    if (!moving || !moving.group.length) return null;
    const g = new THREE.Group();
    for (const m of moving.group) {
      m.castShadow = true;
      g.add(m);
    }
    g.position.set(moving.at.x, moving.at.y, moving.at.z);
    g.userData.rest = g.position.clone();
    g.userData.travel = moving.travel || 0;
    group.add(g);
    return g;
  };

  const mag = attach(spec.moving.mag);
  const bolt = attach(spec.moving.bolt || spec.moving.pump);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, spec.sight ? 0.012 : 0, spec.muzzleZ);
  group.add(muzzle);

  return {
    group,
    muzzle,
    mag,
    bolt,
    sightHeight: spec.ads,
    grip: spec.grip,
    support: spec.support,
    supportRidesBolt: !!spec.supportRidesBolt,
  };
}

export const WEAPON_IDS = Object.keys(BUILDERS);
