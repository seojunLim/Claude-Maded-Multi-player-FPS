// A geared-up soldier built from primitives on a proper joint hierarchy.
//
// Proportions are anchored to the 1.8m hit box the server simulates: feet at 0,
// shoulders at 1.42, head between 1.55 and 1.78. Shoulders stay inside the
// 0.84m-wide collision box so that what you can see is what you can hit.
//
// Joints are rigid rather than skinned — a skeleton with vertex weights is not
// worth authoring by hand — but the hierarchy is a real rig: hips drive the
// spine, the chest carries the aim pitch, and the weapon hangs off the chest so
// the hands never drift away from it.

import * as THREE from 'three';
import { pbr, solid } from './materials.js';
import { Bucket, box, capsule, cyl, ball } from './parts.js';

const SKIN = '#8d6a4f';

// Texture tiles per metre. One tile spans ~11cm of kit, which puts the weave
// of the fabric map at a couple of millimetres — visible up close, and it
// dissolves into cloth rather than gravel at range.
const UV_DENSITY = 7;

/** Every part of the soldier goes through a bucket carrying that density. */
const gear = () => new Bucket(UV_DENSITY);

// Arm bone lengths, and where the shoulders sit in chest space. Both arms are
// solved onto the weapon every frame, so these are load-bearing numbers rather
// than art: shorten them and the support hand can no longer reach a handguard.
const UPPER_ARM = 0.26;
const FORE_ARM = 0.24;
const SHOULDER_R = new THREE.Vector3(0.175, 0.185, 0);
const SHOULDER_L = new THREE.Vector3(-0.175, 0.185, 0);

const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_D = new THREE.Vector3();
const TMP_L = new THREE.Vector3();
const TMP_Q = new THREE.Quaternion();
const TMP_TWIST = new THREE.Quaternion();

function mats(teamColor) {
  return {
    uniform: pbr('fabric', '#41463a', { roughness: 0.92 }), // olive combat dress
    vest: pbr('fabric', '#2f333a', { roughness: 0.88 }),
    plate: pbr('polymer', '#3c4149', { roughness: 0.6, metalness: 0.12 }),
    helmet: pbr('polymer', '#404639', { roughness: 0.62, metalness: 0.1 }),
    strap: pbr('fabric', '#23262b', { roughness: 0.95 }),
    boot: pbr('rubber', '#26282c', { roughness: 0.95 }),
    glove: pbr('rubber', '#2c2f34', { roughness: 0.9 }),
    skin: solid(SKIN, { roughness: 0.72, metalness: 0 }),
    visor: solid('#101a24', { roughness: 0.12, metalness: 0.6, envMapIntensity: 1.4 }),
    // Team colour lives on a few accents so teams stay readable at a glance.
    team: solid(teamColor, { roughness: 0.5, metalness: 0.1, emissive: teamColor, emissiveIntensity: 0.22 }),
  };
}

export class Character {
  /**
   * @param teamColor accent colour
   * @param detail    false trims small gear for distant / mobile rendering
   */
  constructor(teamColor, detail = true) {
    this.detail = detail;
    this.m = mats(teamColor);
    this.root = new THREE.Group();

    this.phase = 0;
    this.lean = 0;
    this.smoothPitch = 0;
    this.breathe = 0;

    this.buildLegs();
    this.buildTorso();
    this.buildArms();
  }

  /* --------------------------------------------------------------- build */

  buildLegs() {
    const m = this.m;
    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    this.root.add(this.hips);

    gear()
      .add(box(0.30, 0.16, 0.20), m.uniform, { y: -0.02 })
      .add(box(0.32, 0.045, 0.215), m.strap, { y: 0.05 }) // belt
      .add(box(0.075, 0.09, 0.06), m.vest, { x: 0.15, y: 0.0, z: 0.02 }) // hip pouch
      .add(box(0.06, 0.075, 0.05), m.vest, { x: -0.155, y: -0.01, z: -0.03 })
      .build(this.hips);

    this.legs = [];
    for (const side of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.095, -0.06, 0);
      this.hips.add(thigh);
      gear()
        .add(capsule(0.082, 0.24), m.uniform, { y: -0.16 })
        .add(box(0.13, 0.10, 0.045), m.plate, { y: -0.28, z: 0.062 }) // knee pad
        .build(thigh);

      const shin = new THREE.Group();
      shin.position.y = -0.36;
      thigh.add(shin);
      gear()
        .add(capsule(0.062, 0.22), m.uniform, { y: -0.14 })
        .add(box(0.115, 0.10, 0.14), m.boot, { y: -0.29, z: 0.012 })
        .add(box(0.12, 0.045, 0.20), m.boot, { y: -0.335, z: 0.035 })
        .build(shin);

      this.legs.push({ thigh, shin, side });
    }
  }

  buildTorso() {
    const m = this.m;
    const d = this.detail;

    this.spine = new THREE.Group();
    this.spine.position.y = 0.08;
    this.hips.add(this.spine);

    this.chest = new THREE.Group();
    this.chest.position.y = 0.10;
    this.spine.add(this.chest);

    const b = gear();
    // Ribcage / combat shirt.
    b.add(capsule(0.155, 0.16, 10), m.uniform, { y: 0.09, sz: 0.72 });
    // Plate carrier front and back, with a shoulder yoke.
    b.add(box(0.30, 0.30, 0.115), m.vest, { y: 0.10 });
    b.add(box(0.245, 0.20, 0.02), m.plate, { y: 0.11, z: 0.065 });
    b.add(box(0.245, 0.20, 0.02), m.plate, { y: 0.11, z: -0.065 });
    b.add(box(0.30, 0.05, 0.145), m.strap, { y: 0.235 });
    // Magazine pouches across the chest.
    for (const x of d ? [-0.085, 0, 0.085] : [-0.085, 0.085]) {
      b.add(box(0.075, 0.11, 0.045), m.vest, { x, y: 0.045, z: 0.082 });
      if (d) b.add(box(0.078, 0.012, 0.048), m.strap, { x, y: 0.098, z: 0.083 });
    }
    // Team accent: chest stripe and back panel.
    b.add(box(0.26, 0.028, 0.012), m.team, { y: 0.205, z: 0.074 });
    b.add(box(0.16, 0.10, 0.012), m.team, { y: 0.12, z: -0.079 });
    // Backpack / radio.
    b.add(box(0.24, 0.26, 0.11), m.vest, { y: 0.09, z: -0.13 });
    if (d) {
      b.add(box(0.05, 0.06, 0.04), m.plate, { x: 0.075, y: 0.20, z: -0.14 });
      b.add(cyl(0.006, 0.006, 0.22, 6), m.plate, { x: 0.075, y: 0.32, z: -0.14, rz: 0.12 });
      b.add(box(0.10, 0.06, 0.05), m.vest, { x: -0.08, y: -0.02, z: -0.14 });
    }
    // Shoulders.
    for (const side of [-1, 1]) {
      b.add(ball(0.075), m.uniform, { x: side * 0.165, y: 0.185, sy: 0.85 });
      b.add(box(0.10, 0.055, 0.13), m.plate, { x: side * 0.175, y: 0.205 });
    }
    b.build(this.chest);

    // Neck + head.
    this.neck = new THREE.Group();
    this.neck.position.y = 0.255;
    this.chest.add(this.neck);
    gear().add(cyl(0.045, 0.05, 0.07, 8), m.skin, { y: 0.02 }).build(this.neck);

    this.head = new THREE.Group();
    this.head.position.y = 0.065;
    this.neck.add(this.head);

    const h = gear();
    h.add(ball(0.088, 14, 12), m.skin, { y: 0.03, sz: 1.08 });
    // Balaclava / lower face cover.
    h.add(box(0.13, 0.075, 0.115), m.strap, { y: -0.005, z: 0.015 });
    // Helmet: dome, brim and rails.
    h.add(ball(0.108, 16, 12), m.helmet, { y: 0.055, sy: 0.92 });
    h.add(box(0.20, 0.03, 0.20), m.helmet, { y: 0.005, sy: 1 });
    if (d) {
      h.add(box(0.02, 0.02, 0.11), m.plate, { x: 0.098, y: 0.045 });
      h.add(box(0.02, 0.02, 0.11), m.plate, { x: -0.098, y: 0.045 });
      h.add(box(0.045, 0.035, 0.03), m.plate, { y: 0.075, z: -0.098 }); // NVG mount
    }
    // Team band around the helmet.
    h.add(cyl(0.111, 0.111, 0.022, 16), m.team, { y: 0.035 });
    // Goggles across the eyes.
    h.add(box(0.165, 0.05, 0.02), m.visor, { y: 0.045, z: 0.082 });
    h.add(box(0.175, 0.022, 0.026), m.strap, { y: 0.048, z: 0.05 });
    h.build(this.head);
  }

  buildArms() {
    const m = this.m;
    this.arms = {};

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.175, 0.185, 0);
      this.chest.add(shoulder);

      gear()
        .add(capsule(0.056, 0.18, 8), m.uniform, { y: -0.13 })
        .build(shoulder);

      const fore = new THREE.Group();
      fore.position.y = -UPPER_ARM;
      shoulder.add(fore);
      gear()
        .add(capsule(0.046, 0.16, 8), m.uniform, { y: -0.115 })
        .add(box(0.072, 0.085, 0.075), m.glove, { y: -0.235 })
        .build(fore);

      this.arms[side < 0 ? 'left' : 'right'] = { shoulder, fore };
    }

    // The weapon hangs off the chest, shouldered: the butt pad sits in the
    // shoulder pocket and the barrel runs forward past the support hand.
    this.weaponMount = new THREE.Group();
    this.weaponMount.position.set(0.10, 0.13, -0.20);
    this.chest.add(this.weaponMount);
  }

  /**
   * @param weapon the object `buildWeapon` returns; its `grip` and `support`
   *               contacts are what the arms are solved onto.
   */
  attachWeapon(weapon) {
    if (this.weapon) this.weaponMount.remove(this.weapon);
    this.weapon = weapon.group;
    weapon.group.position.set(0, 0, 0);
    weapon.group.rotation.set(0, 0, 0);
    this.weaponMount.add(weapon.group);

    // The support hand cannot always reach the foregrip on a short pair of
    // arms, so it takes the nearest point on the handguard it can hold.
    const grip = weapon.grip || { y: -0.09, z: 0.11 };
    const support = weapon.support || { y: -0.05, z: -0.30 };
    this.gripLocal = new THREE.Vector3(grip.x || 0, grip.y || 0, grip.z || 0);
    this.supportLocal = new THREE.Vector3(support.x || 0, support.y || 0, support.z || 0);
    const reach = (UPPER_ARM + FORE_ARM) * 0.96;
    const p = this.weaponMount.position;
    const inReach = () => TMP_A.copy(this.supportLocal).add(p).distanceTo(SHOULDER_L) <= reach;
    for (let i = 0; i < 30 && !inReach(); i++) this.supportLocal.z += 0.02;
  }

  /**
   * Two-bone IK. Rotates a shoulder and its elbow so the hand lands on
   * `target` (chest space). Posing the arms by hand looks fine for exactly one
   * weapon and one aim angle; solving them keeps both hands on the gun as the
   * weapon changes and the whole mount pitches with the player's aim.
   *
   * @param roll twist about the shoulder-to-hand axis, which is the one degree
   *             of freedom the two bones leave free — it swings the elbow.
   */
  solveArm(arm, shoulderPos, target, roll) {
    const d = TMP_D.copy(target).sub(shoulderPos);
    const reach = UPPER_ARM + FORE_ARM;
    const dist = Math.min(d.length(), reach * 0.999);
    if (dist < 1e-4) return;

    // Law of cosines for the elbow, then fold the forearm forward by it.
    const cos = Math.max(-1, Math.min(1, (UPPER_ARM ** 2 + FORE_ARM ** 2 - dist ** 2) / (2 * UPPER_ARM * FORE_ARM)));
    const bend = Math.PI - Math.acos(cos);
    arm.fore.rotation.set(bend, 0, 0);

    // Where that puts the hand in shoulder space, then swing the shoulder so
    // the two directions line up and twist to place the elbow.
    TMP_L.set(0, -UPPER_ARM - FORE_ARM * Math.cos(bend), -FORE_ARM * Math.sin(bend)).normalize();
    d.normalize();
    TMP_Q.setFromUnitVectors(TMP_L, d);
    TMP_TWIST.setFromAxisAngle(d, roll);
    arm.shoulder.quaternion.copy(TMP_TWIST.multiply(TMP_Q));
  }

  /** Puts both hands back on the weapon after the mount has been pitched. */
  poseArms() {
    if (!this.gripLocal) return;
    this.weaponMount.updateMatrix();
    const grip = TMP_A.copy(this.gripLocal).applyMatrix4(this.weaponMount.matrix);
    const support = TMP_B.copy(this.supportLocal).applyMatrix4(this.weaponMount.matrix);
    this.solveArm(this.arms.right, SHOULDER_R, grip, -0.55);
    this.solveArm(this.arms.left, SHOULDER_L, support, 0.75);
  }

  /* ------------------------------------------------------------ animation */

  /**
   * @param s  { speed, crouching, pitch, onGround }
   * @param dt seconds
   */
  pose(s, dt) {
    const speed = s.speed || 0;
    const moving = speed > 0.5;

    // Aim pitch is split between the chest and the head so the whole body
    // leans into the shot instead of the head swivelling on its own.
    this.smoothPitch += (s.pitch - this.smoothPitch) * Math.min(1, dt * 12);
    const pitch = Math.max(-1.1, Math.min(1.1, this.smoothPitch));
    this.chest.rotation.x = pitch * 0.55;
    this.head.rotation.x = pitch * 0.4;
    this.weaponMount.rotation.x = pitch * 0.45;

    // Crouch: drop the hips, fold the legs, bring the torso forward.
    const crouch = s.crouching ? 1 : 0;
    this.crouchBlend = (this.crouchBlend ?? crouch) + (crouch - (this.crouchBlend ?? crouch)) * Math.min(1, dt * 12);
    const cb = this.crouchBlend;
    this.hips.position.y = 0.92 - cb * 0.36;
    this.spine.rotation.x = cb * 0.35;

    if (moving && s.onGround !== false) {
      this.phase += dt * (2.4 + speed * 0.95);
      const stride = Math.min(0.75, 0.22 + speed * 0.075);
      const swing = Math.sin(this.phase);
      const swing2 = Math.sin(this.phase + Math.PI);

      this.legs[0].thigh.rotation.x = swing * stride - cb * 0.9;
      this.legs[1].thigh.rotation.x = swing2 * stride - cb * 0.9;
      // Knees only bend one way.
      this.legs[0].shin.rotation.x = Math.max(0, -swing + 0.2) * stride * 1.4 + cb * 1.5;
      this.legs[1].shin.rotation.x = Math.max(0, -swing2 + 0.2) * stride * 1.4 + cb * 1.5;

      // Vertical bob and a slight roll, both tied to the stride.
      this.root.position.y = Math.abs(Math.sin(this.phase)) * 0.022 * (1 - cb * 0.6);
      this.hips.rotation.z = Math.sin(this.phase) * 0.05;
      this.chest.rotation.z = -Math.sin(this.phase) * 0.045;
      this.chest.rotation.y = Math.sin(this.phase) * 0.06;
    } else {
      // Idle: settle the legs and add a slow breath.
      const k = Math.min(1, dt * 8);
      for (const leg of this.legs) {
        leg.thigh.rotation.x += (-cb * 0.9 - leg.thigh.rotation.x) * k;
        leg.shin.rotation.x += (cb * 1.5 - leg.shin.rotation.x) * k;
      }
      this.breathe += dt * 1.6;
      this.root.position.y += (0 - this.root.position.y) * k;
      this.chest.position.y = 0.10 + Math.sin(this.breathe) * 0.004;
      this.hips.rotation.z += (0 - this.hips.rotation.z) * k;
      this.chest.rotation.z += (0 - this.chest.rotation.z) * k;
      this.chest.rotation.y += (0 - this.chest.rotation.y) * k;
    }

    if (s.onGround === false) {
      // Airborne: tuck the legs.
      this.legs[0].thigh.rotation.x = -0.55;
      this.legs[1].thigh.rotation.x = -0.25;
      this.legs[0].shin.rotation.x = 0.9;
      this.legs[1].shin.rotation.x = 0.5;
    }

    // Last, because the arms follow the weapon and the weapon has just moved.
    this.poseArms();
  }

  /** Recoil shove for the third-person model when this player fires. */
  kick() {
    this.chest.rotation.x -= 0.06;
    if (this.weapon) this.weapon.position.z += 0.03;
  }

  setTeamColor(color) {
    this.m.team.color.set(color);
    this.m.team.emissive.set(color);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }
}
