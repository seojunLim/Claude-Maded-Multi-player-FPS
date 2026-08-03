// Remote player avatars: the geared soldier model, its weapon, the nameplate,
// the sentinel's shield and the see-through silhouette used by RECON.

import * as THREE from 'three';
import { TEAMS } from '/shared/constants.js';
import { Character } from './character.js';
import { buildWeapon } from './weapons.js';

const shieldGeo = new THREE.SphereGeometry(1.05, 18, 12);
const silTorso = new THREE.CapsuleGeometry(0.19, 0.34, 4, 8);
const silHead = new THREE.SphereGeometry(0.13, 10, 8);

function nameplateCanvas() {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 84;
  return c;
}

export class Avatar {
  constructor(info, opts = {}) {
    this.id = info.id;
    this.team = info.team;
    this.heroId = info.hero;
    this.detail = opts.detail !== false;
    this.group = new THREE.Group();

    const teamColor = TEAMS[this.team]?.color ?? 0xffffff;
    this.character = new Character(teamColor, this.detail);
    this.group.add(this.character.root);
    this.setWeapon(this.heroId);

    // Shield bubble (sentinel BULWARK).
    this.shield = new THREE.Mesh(
      shieldGeo,
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
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
    });
    const body = new THREE.Mesh(silTorso, silMat);
    body.position.y = 1.18;
    const head = new THREE.Mesh(silHead, silMat);
    head.position.y = 1.62;
    this.silhouette.add(body, head);
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
    this.lastStepSound = 0;
    this.drawPlate();
  }

  setWeapon(heroId) {
    if (this.weapon) {
      this.character.weaponMount.remove(this.weapon.group);
      this.weapon.group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
    }
    // Distant models skip the small details — rail slots, turrets, fluting.
    this.weapon = buildWeapon(heroId, false);
    this.character.attachWeapon(this.weapon);
  }

  setInfo(info) {
    if (info.name !== undefined && info.name !== this.name) {
      this.name = info.name;
      this.drawPlate();
    }
    if (info.hero && info.hero !== this.heroId) {
      this.heroId = info.hero;
      this.setWeapon(info.hero);
    }
    if (info.team !== undefined && info.team !== this.team) {
      this.team = info.team;
      const c = TEAMS[this.team]?.color ?? 0xffffff;
      this.character.setTeamColor(c);
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
   * @param s   interpolated snapshot state
   * @param ctx { camera, dt, revealed, friendly }
   */
  update(s, ctx) {
    const g = this.group;
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.yaw;

    this.character.pose(
      { speed: s.speed || 0, crouching: s.crouching, pitch: s.pitch, onGround: true },
      Math.min(0.05, ctx.dt),
    );

    this.shield.visible = !!s.shield;
    if (this.shield.visible) {
      this.shield.rotation.y += ctx.dt * 0.8;
      this.shield.material.opacity = 0.12 + Math.sin(performance.now() * 0.006) * 0.05;
    }

    this.silhouette.visible = !!ctx.revealed && !ctx.friendly;

    const dist = ctx.camera.position.distanceTo(g.position);
    const scale = Math.max(1.1, Math.min(4.2, dist * 0.055));
    this.plate.scale.set(scale, scale * 0.26, 1);
    this.plate.visible = dist < 120 && (ctx.friendly || dist < 65 || ctx.revealed);
    this.plate.position.y = (s.crouching ? 1.55 : 2.05) + scale * 0.06;
  }

  /** Muzzle position in world space, for tracers and flashes. */
  muzzleWorld(out = new THREE.Vector3()) {
    this.weapon.muzzle.getWorldPosition(out);
    return out;
  }

  fired() {
    this.character.kick();
  }

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
    this.shield.material.dispose();
    this.silhouette.children.forEach((m) => m.material.dispose());
    this.character.dispose();
  }
}
