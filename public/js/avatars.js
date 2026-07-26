// Remote player avatars: body, animation, nameplate, shield and the
// see-through silhouette used by the marksman's RECON ability.

import * as THREE from 'three';
import { TEAMS } from '/shared/constants.js';
import { getHero } from '/shared/heroes.js';

const geo = {
  torso: new THREE.CapsuleGeometry(0.3, 0.52, 6, 12),
  head: new THREE.SphereGeometry(0.21, 14, 10),
  visor: new THREE.BoxGeometry(0.3, 0.1, 0.06),
  limb: new THREE.BoxGeometry(0.15, 0.62, 0.16),
  arm: new THREE.BoxGeometry(0.13, 0.44, 0.14),
  pack: new THREE.BoxGeometry(0.34, 0.34, 0.16),
  gunBody: new THREE.BoxGeometry(0.1, 0.13, 0.72),
  gunBarrel: new THREE.BoxGeometry(0.06, 0.06, 0.5),
  gunMag: new THREE.BoxGeometry(0.08, 0.2, 0.1),
  shield: new THREE.SphereGeometry(1.05, 18, 12),
};

function nameplateCanvas() {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 84;
  return c;
}

export class Avatar {
  constructor(info) {
    this.id = info.id;
    this.team = info.team;
    this.heroId = info.hero;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = true;

    const teamColor = TEAMS[this.team]?.color ?? 0xffffff;
    const hero = getHero(this.heroId);

    this.matBody = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.55, metalness: 0.1 });
    this.matDark = new THREE.MeshStandardMaterial({ color: 0x3a4553, roughness: 0.7, metalness: 0.12 });
    this.matTrim = new THREE.MeshStandardMaterial({
      color: hero.color,
      roughness: 0.4,
      metalness: 0.1,
      emissive: new THREE.Color(hero.color).multiplyScalar(0.45),
    });

    // Body is assembled inside a pivot so the whole avatar can lean.
    this.pivot = new THREE.Group();
    this.group.add(this.pivot);

    this.torso = new THREE.Mesh(geo.torso, this.matBody);
    this.torso.position.y = 1.12;
    this.pivot.add(this.torso);

    this.pack = new THREE.Mesh(geo.pack, this.matDark);
    this.pack.position.set(0, 1.18, 0.24);
    this.pivot.add(this.pack);

    this.headGroup = new THREE.Group();
    this.headGroup.position.y = 1.58;
    this.head = new THREE.Mesh(geo.head, this.matDark);
    this.headGroup.add(this.head);
    this.visor = new THREE.Mesh(geo.visor, this.matTrim);
    this.visor.position.set(0, 0.02, -0.19);
    this.headGroup.add(this.visor);
    this.pivot.add(this.headGroup);

    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(geo.limb, this.matDark);
      leg.position.set(side * 0.16, 0.42, 0);
      this.pivot.add(leg);
      this.legs.push(leg);
    }

    this.armGroup = new THREE.Group();
    this.armGroup.position.set(0, 1.28, 0);
    this.pivot.add(this.armGroup);

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(geo.arm, this.matBody);
      arm.position.set(side * 0.3, -0.1, -0.2);
      arm.rotation.x = -1.2;
      this.armGroup.add(arm);
    }

    this.gun = new THREE.Group();
    this.gun.position.set(0.14, -0.16, -0.42);
    const body = new THREE.Mesh(geo.gunBody, this.matDark);
    this.gun.add(body);
    const barrel = new THREE.Mesh(geo.gunBarrel, this.matDark);
    barrel.position.z = -0.55;
    if (hero.id === 'marksman') barrel.scale.set(1.1, 1.1, 1.6);
    if (hero.id === 'sentinel') barrel.scale.set(1.7, 1.7, 0.8);
    this.gun.add(barrel);
    const mag = new THREE.Mesh(geo.gunMag, this.matTrim);
    mag.position.set(0, -0.15, 0.05);
    this.gun.add(mag);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, -0.85);
    this.gun.add(this.muzzle);
    this.armGroup.add(this.gun);

    for (const m of [this.torso, this.head, this.pack, ...this.legs]) {
      m.castShadow = true;
    }

    // Shield bubble (sentinel BULWARK).
    this.shield = new THREE.Mesh(
      geo.shield,
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.shield.position.y = 1.0;
    this.shield.visible = false;
    this.group.add(this.shield);

    // Wall-piercing silhouette used while revealed.
    this.silhouette = new THREE.Group();
    const silMat = new THREE.MeshBasicMaterial({
      color: teamColor,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
    });
    const silBody = new THREE.Mesh(geo.torso, silMat);
    silBody.position.y = 1.12;
    silBody.scale.setScalar(1.06);
    const silHead = new THREE.Mesh(geo.head, silMat);
    silHead.position.y = 1.58;
    this.silhouette.add(silBody, silHead);
    this.silhouette.renderOrder = 999;
    this.silhouette.visible = false;
    this.group.add(this.silhouette);

    // Nameplate.
    this.plateCanvas = nameplateCanvas();
    this.plateTex = new THREE.CanvasTexture(this.plateCanvas);
    this.plate = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.plateTex, transparent: true, depthTest: false, sizeAttenuation: true }),
    );
    this.plate.position.y = 2.16;
    this.plate.renderOrder = 1000;
    this.group.add(this.plate);

    this.name = info.name || '';
    this.hp = 1;
    this.maxHp = 1;
    this.stepPhase = 0;
    this.lastStepSound = 0;
    this.smoothPitch = 0;
    this.drawPlate();
  }

  setInfo(info) {
    if (info.name !== undefined && info.name !== this.name) {
      this.name = info.name;
      this.drawPlate();
    }
    if (info.hero && info.hero !== this.heroId) {
      this.heroId = info.hero;
      const hero = getHero(info.hero);
      this.matTrim.color.set(hero.color);
      this.matTrim.emissive.set(new THREE.Color(hero.color).multiplyScalar(0.45));
      this.drawPlate();
    }
    if (info.team !== undefined && info.team !== this.team) {
      this.team = info.team;
      const c = TEAMS[this.team]?.color ?? 0xffffff;
      this.matBody.color.set(c);
      this.silhouette.children.forEach((m) => m.material.color.set(c));
      this.drawPlate();
    }
  }

  drawPlate() {
    const g = this.plateCanvas.getContext('2d');
    const w = this.plateCanvas.width;
    const teamCss = TEAMS[this.team]?.cssColor ?? '#fff';
    g.clearRect(0, 0, w, 84);

    const frac = Math.max(0, Math.min(1, this.maxHp ? this.hp / this.maxHp : 0));
    // health bar
    g.fillStyle = 'rgba(4,8,14,0.72)';
    g.fillRect(38, 50, w - 76, 18);
    g.fillStyle = frac > 0.35 ? teamCss : '#f87171';
    g.fillRect(40, 52, (w - 80) * frac, 14);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.strokeRect(38, 50, w - 76, 18);

    g.font = '700 30px ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(this.name.toUpperCase(), w / 2, 26);
    g.fillStyle = teamCss;
    g.fillText(this.name.toUpperCase(), w / 2, 26);
    this.plateTex.needsUpdate = true;
  }

  setHealth(hp, maxHp) {
    const changed = Math.abs(hp - this.hp) > 0.5 || maxHp !== this.maxHp;
    this.hp = hp;
    this.maxHp = maxHp;
    if (changed) this.drawPlate();
  }

  /**
   * @param s   interpolated snapshot state {x,y,z,yaw,pitch,crouching,moving,shield}
   * @param ctx {camera, dt, revealed, friendly}
   */
  update(s, ctx) {
    const g = this.group;
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.yaw;

    const crouch = s.crouching ? 0.62 : 1;
    this.pivot.scale.y = crouch;
    this.pivot.position.y = 0;

    this.smoothPitch += (s.pitch - this.smoothPitch) * Math.min(1, ctx.dt * 14);
    this.headGroup.rotation.x = Math.max(-0.7, Math.min(0.7, this.smoothPitch));
    this.armGroup.rotation.x = this.smoothPitch * 0.85;

    // Walk cycle driven by horizontal speed.
    const speed = s.speed || 0;
    if (speed > 0.6) {
      this.stepPhase += ctx.dt * (5.5 + speed * 0.9);
      const swing = Math.min(0.85, 0.22 + speed * 0.06);
      this.legs[0].rotation.x = Math.sin(this.stepPhase) * swing;
      this.legs[1].rotation.x = -Math.sin(this.stepPhase) * swing;
      this.torso.position.y = 1.12 + Math.abs(Math.sin(this.stepPhase * 2)) * 0.02;
    } else {
      this.legs[0].rotation.x *= 0.85;
      this.legs[1].rotation.x *= 0.85;
    }

    this.shield.visible = !!s.shield;
    if (this.shield.visible) {
      this.shield.rotation.y += ctx.dt * 0.8;
      this.shield.material.opacity = 0.12 + Math.sin(performance.now() * 0.006) * 0.05;
    }

    this.silhouette.visible = !!ctx.revealed && !ctx.friendly;

    // Nameplates stay legible at range without becoming billboards up close.
    const dist = ctx.camera.position.distanceTo(g.position);
    const scale = Math.max(1.1, Math.min(4.2, dist * 0.055));
    this.plate.scale.set(scale, scale * 0.26, 1);
    this.plate.visible = dist < 120 && (ctx.friendly || dist < 65 || ctx.revealed);
    this.plate.position.y = (s.crouching ? 1.55 : 2.16) + scale * 0.06;
  }

  /** Foot-fall timing for remote step sounds. */
  wantsStepSound(now, speed) {
    if (speed < 1.5) return false;
    const gap = speed > 7 ? 300 : 400;
    if (now - this.lastStepSound < gap) return false;
    this.lastStepSound = now;
    return true;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.plateTex.dispose();
    this.plate.material.dispose();
    this.matBody.dispose();
    this.matDark.dispose();
    this.matTrim.dispose();
    this.shield.material.dispose();
    this.silhouette.children.forEach((m) => m.material.dispose());
  }
}
