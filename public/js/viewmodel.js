// First-person weapon model with sway, bob, recoil, reload and ADS.

import * as THREE from 'three';
import { getHero } from '/shared/heroes.js';

// Pushed back and scaled down so a 90° FOV does not turn the weapon into a
// wall across the bottom of the screen.
const REST = new THREE.Vector3(0.3, -0.26, -0.72);
const ADS = new THREE.Vector3(0.0, -0.15, -0.52);
const VIEWMODEL_SCALE = 0.82;

function boxes(spec, mats) {
  const g = new THREE.Group();
  for (const b of spec) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mats[b.m]);
    m.position.set(b.x, b.y, b.z);
    if (b.rx) m.rotation.x = b.rx;
    g.add(m);
  }
  return g;
}

// Each weapon is a handful of boxes — readable in the corner of the screen
// without costing anything.
const SHAPES = {
  ranger: [
    { x: 0, y: 0, z: 0, w: 0.09, h: 0.1, d: 0.62, m: 'dark' },
    { x: 0, y: 0.075, z: -0.05, w: 0.05, h: 0.05, d: 0.34, m: 'metal' },
    { x: 0, y: -0.005, z: -0.44, w: 0.045, h: 0.045, d: 0.28, m: 'metal' },
    { x: 0, y: -0.14, z: 0.02, w: 0.07, h: 0.19, d: 0.11, m: 'trim' },
    { x: 0, y: -0.09, z: 0.24, w: 0.06, h: 0.13, d: 0.13, m: 'dark', rx: 0.3 },
    { x: 0, y: 0.085, z: 0.12, w: 0.03, h: 0.04, d: 0.06, m: 'trim' },
  ],
  sentinel: [
    { x: 0, y: 0, z: 0, w: 0.12, h: 0.13, d: 0.56, m: 'dark' },
    { x: 0, y: -0.03, z: -0.4, w: 0.1, h: 0.1, d: 0.3, m: 'metal' },
    { x: 0, y: -0.05, z: -0.16, w: 0.13, h: 0.06, d: 0.3, m: 'trim' },
    { x: 0, y: -0.14, z: 0.16, w: 0.08, h: 0.16, d: 0.12, m: 'dark', rx: 0.25 },
  ],
  marksman: [
    { x: 0, y: 0, z: 0, w: 0.08, h: 0.1, d: 0.78, m: 'dark' },
    { x: 0, y: 0, z: -0.62, w: 0.05, h: 0.05, d: 0.46, m: 'metal' },
    { x: 0, y: 0.105, z: -0.08, w: 0.07, h: 0.07, d: 0.3, m: 'metal' },
    { x: 0, y: 0.105, z: -0.24, w: 0.09, h: 0.09, d: 0.06, m: 'trim' },
    { x: 0, y: -0.13, z: 0.06, w: 0.06, h: 0.17, d: 0.1, m: 'dark' },
    { x: 0, y: -0.05, z: 0.34, w: 0.07, h: 0.12, d: 0.2, m: 'dark' },
  ],
  medic: [
    { x: 0, y: 0, z: 0, w: 0.085, h: 0.105, d: 0.42, m: 'dark' },
    { x: 0, y: 0.02, z: -0.3, w: 0.04, h: 0.04, d: 0.22, m: 'metal' },
    { x: 0, y: -0.13, z: -0.02, w: 0.065, h: 0.18, d: 0.1, m: 'trim' },
    { x: 0, y: -0.07, z: 0.2, w: 0.055, h: 0.11, d: 0.1, m: 'dark', rx: 0.35 },
    { x: 0.055, y: 0.06, z: -0.08, w: 0.03, h: 0.03, d: 0.16, m: 'trim' },
  ],
};

export class ViewModel {
  /**
   * @param weaponScene view-space scene drawn after the world
   * @param camera      the world camera, used to place muzzle effects
   */
  constructor(weaponScene, camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.position.copy(REST);
    this.root.scale.setScalar(VIEWMODEL_SCALE);
    // The weapon camera sits at the origin looking down -z, so positions in
    // this scene are already view-space offsets from the player's eye.
    weaponScene.add(this.root);

    // There is no environment map in this scene, so metalness has to stay low
    // — fully metallic surfaces would render almost black.
    this.mats = {
      dark: new THREE.MeshStandardMaterial({ color: 0x76829a, roughness: 0.55, metalness: 0.12 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xa6b3c6, roughness: 0.32, metalness: 0.3 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.4, metalness: 0.1, emissive: 0x143f24 }),
    };

    this.gun = new THREE.Group();
    this.root.add(this.gun);

    // Gloved hands so the weapon does not float.
    const handMat = new THREE.MeshStandardMaterial({ color: 0x424f66, roughness: 0.8 });
    this.frontHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.13), handMat);
    this.backHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.12), handMat);
    this.gun.add(this.frontHand, this.backHand);

    this.muzzle = new THREE.Object3D();
    this.gun.add(this.muzzle);

    this.recoil = 0;
    this.recoilVel = 0;
    this.bobPhase = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.ads = 0;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.heroId = null;
    this.setHero('ranger');
  }

  setHero(heroId) {
    if (this.heroId === heroId) return;
    this.heroId = heroId;
    const hero = getHero(heroId);
    this.mats.trim.color.set(hero.color);
    this.mats.trim.emissive.set(new THREE.Color(hero.color).multiplyScalar(0.25));

    // Rebuild the weapon, keeping the hands and muzzle marker.
    for (const child of [...this.gun.children]) {
      if (child === this.frontHand || child === this.backHand || child === this.muzzle) continue;
      this.gun.remove(child);
      child.geometry.dispose();
    }
    const shape = SHAPES[heroId] || SHAPES.ranger;
    const built = boxes(shape, this.mats);
    for (const m of [...built.children]) this.gun.add(m);

    // Place hands and muzzle relative to the barrel length.
    const barrel = shape.reduce((acc, b) => Math.min(acc, b.z - b.d / 2), 0);
    this.muzzle.position.set(0, 0, barrel);
    this.frontHand.position.set(0, -0.08, barrel * 0.45);
    this.backHand.position.set(0, -0.13, 0.1);
    this.scopeHero = heroId === 'marksman';
  }

  kick(strength = 1) {
    this.recoilVel += 0.06 * strength;
    this.recoil += 0.012 * strength;
  }

  startReload(ms) {
    this.reloadDur = ms / 1000;
    this.reloadT = this.reloadDur;
  }

  update(dt, s) {
    // Sway: the weapon lags behind fast mouse movement.
    const swayTarget = -Math.max(-1, Math.min(1, s.yawDelta * 9));
    const swayTargetY = -Math.max(-1, Math.min(1, s.pitchDelta * 9));
    this.swayX += (swayTarget - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (swayTargetY - this.swayY) * Math.min(1, dt * 9);

    // ADS blend.
    const wantAds = s.zoom ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 13);

    // Walk bob.
    const speed = Math.min(9, s.speed || 0);
    if (s.onGround && speed > 0.6) this.bobPhase += dt * (5 + speed * 1.15);
    const bobAmt = (speed / 9) * 0.016 * (1 - this.ads * 0.75);
    const bobX = Math.cos(this.bobPhase) * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmt * 0.9;

    // Recoil spring. Decay is normalised against a 60Hz step so a slow frame
    // cannot let kicks stack up and shove the weapon out of view.
    const decay = (per60) => Math.pow(per60, Math.min(4, dt * 60));
    this.recoil += this.recoilVel * Math.min(4, dt * 60);
    this.recoilVel *= decay(0.72);
    this.recoil *= decay(0.82);
    this.recoil = Math.min(this.recoil, 0.14);

    const target = REST.clone().lerp(ADS, this.ads);
    this.root.position.set(
      target.x + this.swayX * 0.05 + bobX,
      target.y + this.swayY * 0.04 + bobY - this.recoil * 0.35,
      target.z + this.recoil * 1.1,
    );
    this.root.rotation.set(
      this.swayY * 0.12 - this.recoil * 2.4,
      this.swayX * 0.16,
      this.swayX * 0.08 + (s.zoom ? 0 : 0.02),
    );

    // Reload: drop the weapon out of frame and spin it back.
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      const k = 1 - Math.max(0, this.reloadT) / this.reloadDur;
      const dip = Math.sin(Math.min(1, k) * Math.PI);
      this.gun.position.y = -dip * 0.16;
      this.gun.rotation.x = dip * 0.75;
      this.gun.rotation.z = dip * 0.35;
    } else if (this.gun.position.y !== 0) {
      const k = decay(0.8);
      this.gun.position.y *= k;
      this.gun.rotation.x *= k;
      this.gun.rotation.z *= k;
      if (Math.abs(this.gun.position.y) < 0.001) {
        this.gun.position.y = 0;
        this.gun.rotation.set(0, 0, 0);
      }
    }

    // Hide the model while scoped with the sniper — the scope overlay takes over.
    const scoped = this.scopeHero && this.ads > 0.75;
    this.root.visible = !!s.alive && !scoped;
  }

  /**
   * World position of the muzzle. The weapon lives in view space, so its
   * position is transformed through the world camera to place tracers and
   * flashes in the level.
   */
  muzzleWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.muzzle.getWorldPosition(out);
    return this.camera.localToWorld(out);
  }
}
