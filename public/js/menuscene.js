// The main screen's live 3D backdrop: your soldier standing in the arena you
// picked, with the camera drifting slowly around them.
//
// It runs the same Stage, the same arena geometry and the same character model
// the match does, so the front screen is a real preview rather than artwork
// that can drift out of date. It gives up its WebGL context the moment a match
// starts — two live contexts on a phone is one too many.

import * as THREE from 'three';
import { buildMap } from '/shared/map.js';
import { makeWorld, traceWorld } from '/shared/physics.js';
import { getHero } from '/shared/heroes.js';
import { Stage } from './world.js';
import { Character } from './character.js';
import { buildWeapon } from './weapons.js';

// Where the camera sits relative to the soldier.
const ORBIT_RADIUS = 4.6;
const ORBIT_HEIGHT = 1.85;
const LOOK_HEIGHT = 1.2;
const ORBIT_SPEED = 0.085; // radians per second
// How close to a wall the camera is allowed to get when it pulls in.
const CAMERA_SKIN = 0.35;

export class MenuScene {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.mobile = !!opts.mobile;
    this.stage = new Stage(canvas, {
      fov: 52,
      shadows: !this.mobile,
      mobile: this.mobile,
    });
    // Nothing is aiming down sights here, so the view-model camera is unused.
    this.stage.weaponCamera.layers.disableAll();

    // Character.pose() owns root.position.y for its walk bob, so the model
    // hangs off a holder that carries the world placement — the same split the
    // in-match avatars use.
    this.holder = new THREE.Group();
    this.character = new Character(0x9fc7f5, !this.mobile);
    this.character.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.holder.add(this.character.root);
    this.stage.scene.add(this.holder);

    // A key light that rides with the camera. The arena keeps its own lighting,
    // but the soldier is the subject of the shot and must never fall into a
    // building's shadow just because the anchor happens to sit in one.
    this.key = new THREE.DirectionalLight(0xdce9ff, 1.25);
    this.key.target = this.holder;
    this.stage.scene.add(this.key);

    this.heroId = null;
    this.mapId = null;
    this.angle = Math.PI * 0.25;
    this.stand = new THREE.Vector3();
    this.raf = 0;
    this.last = 0;
    this.running = false;

    this.onResize = () => this.stage.resize();
    window.addEventListener('resize', this.onResize);
  }

  /** Swaps the arena under the soldier's feet. */
  setMap(mapId) {
    if (mapId === this.mapId) return;
    this.mapId = mapId;
    const map = buildMap(mapId);
    this.stage.applyTheme(map.theme);
    // The scrim that keeps the menu text readable also dims the arena, so the
    // preview is graded a stop brighter than the same map is in a match.
    this.stage.renderer.toneMappingExposure = this.stage.theme.exposure * 1.22;
    this.stage.clearLevel();
    this.stage.buildLevel(map);

    // Each arena authors an open spot with a view of its centrepiece. Drop the
    // soldier onto whatever surface is actually under it rather than assuming
    // the anchor sits on the ground slab.
    const spot = map.preview || map.zone || { x: 0, z: 0 };
    this.world = makeWorld(map);
    // Start the probe just above head height so a roof far overhead cannot
    // catch it and leave the soldier standing in mid-air.
    const down = traceWorld(this.world, { x: spot.x, y: 4, z: spot.z }, { x: 0, y: -1, z: 0 }, 10);
    this.stand.set(spot.x, down ? down.point.y : 0, spot.z);
    this.holder.position.copy(this.stand);
  }

  /** Swaps the weapon in the soldier's hands. */
  setHero(heroId) {
    if (heroId === this.heroId) return;
    this.heroId = heroId;
    if (this.weapon) {
      this.character.weaponMount.remove(this.weapon.group);
      this.weapon.group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
    }
    this.weapon = buildWeapon(heroId, !this.mobile);
    this.weapon.group.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.character.attachWeapon(this.weapon);
    this.character.setTeamColor(getHero(heroId).color);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      // Long gaps (a backgrounded tab) must not teleport the camera, and the
      // first rAF timestamp can predate the clock read in start() — a negative
      // step runs every smoothed value in the pose away to infinity.
      const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      this.tick(dt);
      this.stage.render();
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  tick(dt) {
    this.angle += dt * ORBIT_SPEED;
    const cam = this.stage.camera;
    const look = { x: this.stand.x, y: this.stand.y + LOOK_HEIGHT, z: this.stand.z };

    // Third-person camera collision: swing out to the full radius, but pull in
    // to just short of whatever the arena puts in the way. Without this the
    // orbit spends part of every lap inside a crate.
    const dir = {
      x: Math.sin(this.angle),
      y: (ORBIT_HEIGHT - LOOK_HEIGHT) / ORBIT_RADIUS,
      z: Math.cos(this.angle),
    };
    const len = Math.hypot(dir.x, dir.y, dir.z);
    dir.x /= len;
    dir.y /= len;
    dir.z /= len;
    const hit = traceWorld(this.world, look, dir, ORBIT_RADIUS);
    const dist = hit ? Math.max(2.8, hit.dist - CAMERA_SKIN) : ORBIT_RADIUS;
    cam.position.set(look.x + dir.x * dist, look.y + dir.y * dist, look.z + dir.z * dist);
    cam.lookAt(look.x, look.y, look.z);
    this.key.position.set(cam.position.x, cam.position.y + 2.4, cam.position.z);

    // The soldier keeps turning to face the lens, so the arena sweeps past
    // behind them instead of the model spinning on the spot.
    this.holder.rotation.y = this.angle;
    this.character.pose({ speed: 0, pitch: -0.05, crouching: false, onGround: true }, dt);
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.stage.scene.remove(this.holder);
    this.character.dispose();
    this.stage.dispose();
  }
}

/**
 * Starts the preview, or returns null if this browser cannot give us a second
 * WebGL context — the caller falls back to the 2D backdrop.
 */
export function tryStartMenuScene(canvas, opts) {
  try {
    return new MenuScene(canvas, opts);
  } catch {
    return null;
  }
}
