// First-person weapon: the same model the avatars carry, plus gloved hands,
// sway, bob, recoil, a reload sequence and true sight-aligned aiming.

import * as THREE from 'three';
import { buildWeapon } from './weapons.js';
import { pbr } from './materials.js';
import { Bucket, box, cyl, capsule } from './parts.js';

// Hip and aim placement in view space (the weapon camera sits at the origin
// looking down -z). ADS is derived from the weapon's own sight height so the
// player really does look through the optic.
const REST = new THREE.Vector3(0.17, -0.185, -0.44);
const ADS_Z = -0.34;
const SCALE = 0.82;

const HAND_UV = 12;

// Where the arms come from, in the weapon's own space. Both forearms are aimed
// at these points and then run off the bottom of the frame, which is what sells
// the hands as attached to a body rather than floating in front of the camera.
// They have to sit well below the weapon: aim a forearm anywhere near the
// weapon's own height and it lies across the receiver a few centimetres from
// the near plane, filling a third of the screen with a blurred sleeve.
const SHOULDER = {
  right: new THREE.Vector3(0.05, -0.34, 0.86),
  left: new THREE.Vector3(-0.44, -0.36, 0.80),
};
const ARM_AXIS = new THREE.Vector3(0, 0, -1);

export class ViewModel {
  /**
   * @param weaponScene view-space scene drawn after the world
   * @param camera      the world camera, used to place muzzle effects
   */
  constructor(weaponScene, camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.position.copy(REST);
    this.root.scale.setScalar(SCALE);
    weaponScene.add(this.root);

    this.rig = new THREE.Group(); // carries recoil + reload motion
    this.root.add(this.rig);

    this.hands = this.buildHands();
    this.rig.add(this.hands.group);

    this.recoil = 0;
    this.recoilVel = 0;
    this.recoilRot = 0;
    this.bobPhase = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.ads = 0;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.boltT = 0;
    this.heroId = null;
    this.setHero('ranger');
  }

  /**
   * Builds two gloved hands and two forearms. The hands are modelled in a
   * canonical grip: whatever is being held runs up the +Y axis through the
   * origin, the back of the hand sits behind it at +Z, the fingers curl round
   * the front, and the wrist leaves at the top. Every weapon presents a raked
   * pistol grip and an angled foregrip, so that one pose fits all eight
   * contacts and only the rake changes.
   *
   * Forearms are separate objects rather than children of the hands: aiming
   * them at a shoulder anchor is a one-line quaternion, where posing them
   * through the hand would need a wrist joint the model does not have.
   */
  buildHands() {
    const glove = pbr('rubber', '#2b2e33', { roughness: 0.92, envMapIntensity: 0.35 });
    const cuff = pbr('fabric', '#23262b', { roughness: 0.95, envMapIntensity: 0.3 });
    const sleeve = pbr('fabric', '#3c4136', { roughness: 0.94, envMapIntensity: 0.3 });
    const group = new THREE.Group();

    const makeHand = (side) => {
      const g = new THREE.Group();
      const b = new Bucket(HAND_UV);
      // Back of the hand, behind the grip.
      b.add(box(0.046, 0.098, 0.032), glove, { x: side * 0.006, y: 0.004, z: 0.038 });
      // Four fingers stacked down the grip, each wrapping round to the front.
      for (let i = 0; i < 4; i++) {
        const y = 0.030 - i * 0.022;
        const taper = 1 - i * 0.08;
        b.add(box(0.030, 0.019 * taper, 0.052), glove, { x: -side * 0.014, y, z: 0.012 });
        b.add(box(0.040 * taper, 0.018 * taper, 0.026), glove, { x: -side * 0.012, y: y - 0.003, z: -0.024 });
      }
      // Knuckles, raised where the fingers turn the corner.
      b.add(box(0.020, 0.086, 0.030), glove, { x: -side * 0.026, y: 0.002, z: 0.008 });
      // Thumb: up the near side and laid across the front of the grip.
      b.add(box(0.021, 0.046, 0.026), glove, { x: side * 0.028, y: 0.006, z: 0.020, rz: -side * 0.45 });
      b.add(box(0.046, 0.020, 0.024), glove, { x: side * 0.008, y: 0.036, z: 0.002, rz: -side * 0.2 });
      // Wrist cuff where the glove meets the sleeve.
      b.add(cyl(0.030, 0.034, 0.036, 10), cuff, { y: 0.060, z: 0.020, rx: -0.25 });
      b.build(g, false);
      return g;
    };

    const makeArm = () => {
      const g = new THREE.Group();
      // Built along -Z so a single setFromUnitVectors aims it at the shoulder.
      new Bucket(HAND_UV)
        .add(capsule(0.034, 0.30, 10), sleeve, { z: -0.19, rx: Math.PI / 2 })
        .build(g, false);
      return g;
    };

    const right = makeHand(1);
    const left = makeHand(-1);
    const rightArm = makeArm();
    const leftArm = makeArm();
    group.add(right, left, rightArm, leftArm);
    return { group, right, left, rightArm, leftArm };
  }

  /**
   * Puts a hand on a contact point and swings its forearm back to the shoulder.
   * The wrist sits a little above the hand's origin, along whatever rake the
   * grip has, which is why the offset is rotated by the hand's own euler.
   */
  placeHand(hand, arm, contact, shoulder) {
    hand.position.set(contact.x || 0, contact.y || 0, contact.z || 0);
    hand.rotation.set(contact.rx || 0, contact.ry || 0, contact.rz || 0);

    const wrist = new THREE.Vector3(0, 0.068, 0.022).applyEuler(hand.rotation).add(hand.position);
    arm.position.copy(wrist);
    arm.quaternion.setFromUnitVectors(ARM_AXIS, shoulder.clone().sub(wrist).normalize());
    arm.userData.rest = wrist.clone();
  }

  setHero(heroId) {
    if (this.heroId === heroId) return;
    this.heroId = heroId;

    if (this.weapon) {
      this.rig.remove(this.weapon.group);
      this.weapon.group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
    }
    this.weapon = buildWeapon(heroId, true);
    this.rig.add(this.weapon.group);
    this.scopeHero = heroId === 'marksman';

    // Each weapon states where its two hand contacts are, so the hands land on
    // the actual grips rather than on a table of numbers kept in step by hand.
    const h = this.hands;
    this.placeHand(h.right, h.rightArm, this.weapon.grip, SHOULDER.right);
    this.placeHand(h.left, h.leftArm, this.weapon.support, SHOULDER.left);
    this.supportRest = h.left.position.z;
  }

  kick(strength = 1) {
    this.recoilVel += 0.055 * strength;
    this.recoil += 0.01 * strength;
    this.recoilRot += 0.05 * strength;
    this.boltT = 1;
  }

  startReload(ms) {
    this.reloadDur = ms / 1000;
    this.reloadT = this.reloadDur;
  }

  /** World position of the muzzle, for tracers and flashes. */
  muzzleWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    this.weapon.muzzle.getWorldPosition(out);
    return this.camera.localToWorld(out);
  }

  /** World position of the ejection port, for flying brass. */
  ejectWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    out.set(0.05, 0.02, 0.02);
    this.rig.localToWorld(out);
    return this.camera.localToWorld(out);
  }

  update(dt, s) {
    const decay = (per60) => Math.pow(per60, Math.min(4, dt * 60));
    const step = Math.min(4, dt * 60);

    // Sway: the weapon trails fast mouse movement.
    const swayTarget = -Math.max(-1, Math.min(1, s.yawDelta * 9));
    const swayTargetY = -Math.max(-1, Math.min(1, s.pitchDelta * 9));
    this.swayX += (swayTarget - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (swayTargetY - this.swayY) * Math.min(1, dt * 9);

    // Aiming blends towards putting the sight on the screen centre.
    const wantAds = s.zoom && this.reloadT <= 0 ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 13);

    const speed = Math.min(9, s.speed || 0);
    if (s.onGround && speed > 0.6) this.bobPhase += dt * (5 + speed * 1.15);
    const bobAmt = (speed / 9) * 0.015 * (1 - this.ads * 0.85);
    const bobX = Math.cos(this.bobPhase) * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmt * 0.9;

    // Recoil springs.
    this.recoil += this.recoilVel * step;
    this.recoilVel *= decay(0.72);
    this.recoil *= decay(0.82);
    this.recoil = Math.min(this.recoil, 0.13);
    this.recoilRot *= decay(0.8);

    // Sight-aligned ADS: lift the weapon so its optic sits on the crosshair.
    const sightDrop = -(this.weapon.sightHeight ?? 0.08);
    const ax = 0;
    const ay = sightDrop;
    this.root.position.set(
      THREE.MathUtils.lerp(REST.x, ax, this.ads) + this.swayX * 0.045 * (1 - this.ads * 0.7) + bobX,
      THREE.MathUtils.lerp(REST.y, ay, this.ads) + this.swayY * 0.035 * (1 - this.ads * 0.7) + bobY - this.recoil * 0.3,
      THREE.MathUtils.lerp(REST.z, ADS_Z, this.ads) + this.recoil * 1.0,
    );
    this.root.rotation.set(
      this.swayY * 0.11 * (1 - this.ads * 0.8) - this.recoilRot,
      this.swayX * 0.15 * (1 - this.ads * 0.8),
      (this.swayX * 0.07 + 0.03) * (1 - this.ads),
    );

    this.animateBolt(dt);
    this.animateReload(dt);

    // The sniper's scope overlay replaces the model once fully aimed.
    const scoped = this.scopeHero && this.ads > 0.8;
    this.root.visible = !!s.alive && !scoped;
  }

  animateBolt(dt) {
    if (this.boltT > 0) this.boltT = Math.max(0, this.boltT - dt * 14);
    const bolt = this.weapon.bolt;
    if (!bolt) return;
    const rest = bolt.userData.rest;
    const travel = bolt.userData.travel || 0;
    // Snap back, ride forward.
    const k = this.boltT > 0.5 ? (1 - this.boltT) * 2 : this.boltT * 2;
    bolt.position.z = rest.z + k * travel;

    // On a pump gun the support hand is what works the action, so it travels
    // with the forend instead of hovering where the forend used to be.
    if (this.weapon.supportRidesBolt) {
      this.hands.left.position.z = this.supportRest + k * travel;
      this.hands.leftArm.position.z = this.hands.leftArm.userData.rest.z + k * travel;
    }
  }

  animateReload(dt) {
    if (this.reloadT <= 0) {
      if (this.rig.position.lengthSq() > 1e-6 || this.rig.rotation.x !== 0) {
        const k = Math.pow(0.8, Math.min(4, dt * 60));
        this.rig.position.multiplyScalar(k);
        this.rig.rotation.x *= k;
        this.rig.rotation.z *= k;
      }
      return;
    }

    this.reloadT -= dt;
    const t = 1 - Math.max(0, this.reloadT) / this.reloadDur; // 0..1

    // Tip the weapon into view, swap the magazine, bring it back on target.
    const dip = Math.sin(Math.min(1, t) * Math.PI);
    this.rig.position.set(-0.03 * dip, -0.10 * dip, 0.04 * dip);
    this.rig.rotation.x = 0.5 * dip;
    this.rig.rotation.z = -0.35 * dip;

    const mag = this.weapon.mag;
    if (mag) {
      const rest = mag.userData.rest;
      if (t < 0.4) {
        // Old magazine falls away.
        const k = t / 0.4;
        mag.position.set(rest.x, rest.y - k * 0.3, rest.z);
        mag.rotation.x = k * 0.9;
        mag.visible = k < 0.95;
      } else if (t < 0.72) {
        mag.visible = false;
      } else {
        // Fresh magazine seated.
        const k = Math.min(1, (t - 0.72) / 0.22);
        mag.visible = true;
        mag.position.set(rest.x, rest.y - (1 - k) * 0.22, rest.z);
        mag.rotation.x = (1 - k) * 0.5;
      }
    }
    // Cycle the action at the end of the reload.
    if (t > 0.9 && this.boltT === 0) this.boltT = 1;
  }
}
