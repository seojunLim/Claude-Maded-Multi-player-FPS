// Pooled visual effects: tracers, sparks, blood, bullet scorches, muzzle
// flashes, death bursts and heal pulses. Everything reuses fixed buffers so
// combat never allocates during a frame.

import * as THREE from 'three';

const TRACERS = 96;
const PARTICLES = 900;
const DECALS = 40;
const FLASHES = 6;
const RINGS = 12;

function sparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,235,180,0.75)');
  grad.addColorStop(1, 'rgba(255,180,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(10,10,12,0.95)');
  grad.addColorStop(0.45, 'rgba(20,20,24,0.6)');
  grad.addColorStop(1, 'rgba(30,30,36,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(12,12,14,${0.25 + Math.random() * 0.3})`;
    g.lineWidth = 1 + Math.random() * 2;
    const a = Math.random() * Math.PI * 2;
    g.beginPath();
    g.moveTo(32, 32);
    g.lineTo(32 + Math.cos(a) * 26, 32 + Math.sin(a) * 26);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,225,150,0.9)');
  grad.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // star flare
  g.strokeStyle = 'rgba(255,240,200,0.9)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(4, 32);
  g.lineTo(60, 32);
  g.moveTo(32, 10);
  g.lineTo(32, 54);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    // ---- tracers (line segments with per-vertex fade) ----
    const tGeo = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(TRACERS * 6);
    this.tracerCol = new Float32Array(TRACERS * 6);
    tGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3));
    this.tracers = new THREE.LineSegments(
      tGeo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    this.tracerLife = new Float32Array(TRACERS);
    this.tracerHue = new Array(TRACERS).fill(null);
    this.tracerNext = 0;

    // ---- particles ----
    const pGeo = new THREE.BufferGeometry();
    this.partPos = new Float32Array(PARTICLES * 3);
    this.partCol = new Float32Array(PARTICLES * 3);
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.partPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.partCol, 3));
    this.particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 0.09,
        map: sparkTexture(),
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.particles.frustumCulled = false;
    scene.add(this.particles);
    this.partVel = new Float32Array(PARTICLES * 3);
    this.partLife = new Float32Array(PARTICLES);
    this.partMax = new Float32Array(PARTICLES);
    this.partBase = new Float32Array(PARTICLES * 3);
    this.partGrav = new Float32Array(PARTICLES);
    this.partNext = 0;

    // ---- bullet scorches ----
    const scorch = scorchTexture();
    this.decals = [];
    for (let i = 0; i < DECALS; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.3),
        new THREE.MeshBasicMaterial({
          map: scorch,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
        }),
      );
      m.visible = false;
      scene.add(m);
      this.decals.push({ mesh: m, life: 0 });
    }
    this.decalNext = 0;

    // ---- muzzle flashes ----
    const flash = flashTexture();
    this.flashes = [];
    for (let i = 0; i < FLASHES; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: flash,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        }),
      );
      s.visible = false;
      scene.add(s);
      this.flashes.push({ sprite: s, life: 0 });
    }
    this.flashNext = 0;
    this.flashLight = new THREE.PointLight(0xffd9a0, 0, 12, 2);
    scene.add(this.flashLight);
    this.flashLightLife = 0;

    // ---- expanding rings (deaths, heals, abilities) ----
    this.rings = [];
    for (let i = 0; i < RINGS; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.86, 1, 40),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, from: 0, to: 1, flat: true });
    }
    this.ringNext = 0;
  }

  /* ------------------------------------------------------------ spawners */

  tracer(from, to, color = 0xfff2c4, life = 0.075) {
    const i = this.tracerNext++ % TRACERS;
    const o = i * 6;
    this.tracerPos[o] = from.x;
    this.tracerPos[o + 1] = from.y;
    this.tracerPos[o + 2] = from.z;
    this.tracerPos[o + 3] = to.x;
    this.tracerPos[o + 4] = to.y;
    this.tracerPos[o + 5] = to.z;
    const c = new THREE.Color(color);
    this.tracerHue[i] = c;
    this.tracerLife[i] = life;
    this.tracers.geometry.attributes.position.needsUpdate = true;
  }

  particle(x, y, z, vx, vy, vz, color, life, gravity = 9) {
    const i = this.partNext++ % PARTICLES;
    const o = i * 3;
    this.partPos[o] = x;
    this.partPos[o + 1] = y;
    this.partPos[o + 2] = z;
    this.partVel[o] = vx;
    this.partVel[o + 1] = vy;
    this.partVel[o + 2] = vz;
    const c = new THREE.Color(color);
    this.partBase[o] = c.r;
    this.partBase[o + 1] = c.g;
    this.partBase[o + 2] = c.b;
    this.partLife[i] = life;
    this.partMax[i] = life;
    this.partGrav[i] = gravity;
  }

  impact(point, normal, surf = 'wall') {
    const metal = surf === 'building' || surf === 'platform' || surf === 'pillar';
    const n = normal || { x: 0, y: 1, z: 0 };
    const count = metal ? 10 : 7;
    for (let i = 0; i < count; i++) {
      const spread = 2.6;
      this.particle(
        point.x + n.x * 0.02,
        point.y + n.y * 0.02,
        point.z + n.z * 0.02,
        n.x * 2 + (Math.random() - 0.5) * spread,
        n.y * 2 + Math.random() * spread,
        n.z * 2 + (Math.random() - 0.5) * spread,
        metal ? 0xfff0c0 : 0xb9a98c,
        0.22 + Math.random() * 0.3,
        metal ? 11 : 7,
      );
    }
    // puff of dust
    for (let i = 0; i < 4; i++) {
      this.particle(
        point.x,
        point.y,
        point.z,
        (Math.random() - 0.5) * 0.7 + n.x * 0.6,
        Math.random() * 0.7,
        (Math.random() - 0.5) * 0.7 + n.z * 0.6,
        0x4a4a52,
        0.5,
        0.6,
      );
    }
    this.decal(point, n);
  }

  decal(point, normal) {
    const d = this.decals[this.decalNext++ % DECALS];
    const m = d.mesh;
    m.visible = true;
    m.material.opacity = 0.85;
    d.life = 8;
    const s = 0.22 + Math.random() * 0.16;
    m.scale.set(s / 0.3, s / 0.3, 1);
    m.position.set(point.x + normal.x * 0.015, point.y + normal.y * 0.015, point.z + normal.z * 0.015);
    m.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    m.rotateZ(Math.random() * Math.PI);
  }

  blood(point, dirTowards) {
    const d = dirTowards || { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 9; i++) {
      this.particle(
        point.x,
        point.y,
        point.z,
        d.x * 1.6 + (Math.random() - 0.5) * 2.4,
        1.2 + Math.random() * 1.6,
        d.z * 1.6 + (Math.random() - 0.5) * 2.4,
        i % 3 === 0 ? 0xff6b8a : 0xc2183c,
        0.35 + Math.random() * 0.25,
        12,
      );
    }
  }

  muzzle(pos, dir, scale = 1) {
    const f = this.flashes[this.flashNext++ % FLASHES];
    f.sprite.visible = true;
    f.sprite.position.set(pos.x + dir.x * 0.1, pos.y + dir.y * 0.1, pos.z + dir.z * 0.1);
    const s = (0.5 + Math.random() * 0.25) * scale;
    f.sprite.scale.set(s, s, s);
    f.sprite.material.opacity = 1;
    f.sprite.material.rotation = Math.random() * Math.PI;
    f.life = 0.055;

    this.flashLight.position.copy(f.sprite.position);
    this.flashLight.intensity = 6 * scale;
    this.flashLightLife = 0.06;

    for (let i = 0; i < 3; i++) {
      this.particle(
        pos.x,
        pos.y,
        pos.z,
        dir.x * (4 + Math.random() * 5) + (Math.random() - 0.5),
        dir.y * (4 + Math.random() * 5) + (Math.random() - 0.5) + 0.4,
        dir.z * (4 + Math.random() * 5) + (Math.random() - 0.5),
        0xffd08a,
        0.1 + Math.random() * 0.1,
        3,
      );
    }
  }

  ring(pos, { color = 0xffffff, from = 0.4, to = 6, life = 0.5, flat = true } = {}) {
    const r = this.rings[this.ringNext++ % RINGS];
    r.mesh.visible = true;
    r.mesh.position.set(pos.x, pos.y + (flat ? 0.08 : 0), pos.z);
    r.mesh.material.color.set(color);
    r.mesh.material.opacity = 0.85;
    r.mesh.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    r.life = life;
    r.max = life;
    r.from = from;
    r.to = to;
    r.flat = flat;
  }

  death(pos, color = 0xffffff) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      this.particle(
        pos.x,
        pos.y + 0.9,
        pos.z,
        Math.cos(a) * sp,
        1 + Math.random() * 4,
        Math.sin(a) * sp,
        i % 4 === 0 ? 0xffffff : color,
        0.5 + Math.random() * 0.5,
        10,
      );
    }
    this.ring({ x: pos.x, y: pos.y, z: pos.z }, { color, from: 0.3, to: 3.2, life: 0.55 });
  }

  heal(pos, radius) {
    this.ring(pos, { color: 0x22d3ee, from: 0.5, to: radius, life: 0.75 });
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.8;
      this.particle(
        pos.x + Math.cos(a) * r,
        pos.y + 0.2,
        pos.z + Math.sin(a) * r,
        0,
        2 + Math.random() * 2,
        0,
        0x67e8f9,
        0.7,
        -1.5,
      );
    }
  }

  abilityBurst(pos, color) {
    this.ring(pos, { color, from: 0.4, to: 4.5, life: 0.5 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particle(
        pos.x,
        pos.y + 1,
        pos.z,
        Math.cos(a) * 3,
        Math.random() * 2,
        Math.sin(a) * 3,
        color,
        0.4,
        2,
      );
    }
  }

  /* -------------------------------------------------------------- update */

  update(dt) {
    this.time += dt;

    // tracers
    let tracerDirty = false;
    for (let i = 0; i < TRACERS; i++) {
      if (this.tracerLife[i] <= 0) continue;
      this.tracerLife[i] -= dt;
      const c = this.tracerHue[i];
      const k = Math.max(0, this.tracerLife[i] / 0.075);
      const o = i * 6;
      const r = c.r * k;
      const g = c.g * k;
      const b = c.b * k;
      // Head of the tracer stays brighter than the tail.
      this.tracerCol[o] = r * 0.25;
      this.tracerCol[o + 1] = g * 0.25;
      this.tracerCol[o + 2] = b * 0.25;
      this.tracerCol[o + 3] = r;
      this.tracerCol[o + 4] = g;
      this.tracerCol[o + 5] = b;
      if (this.tracerLife[i] <= 0) {
        for (let j = 0; j < 6; j++) this.tracerCol[o + j] = 0;
      }
      tracerDirty = true;
    }
    if (tracerDirty) this.tracers.geometry.attributes.color.needsUpdate = true;

    // particles
    let partDirty = false;
    for (let i = 0; i < PARTICLES; i++) {
      if (this.partLife[i] <= 0) continue;
      this.partLife[i] -= dt;
      const o = i * 3;
      if (this.partLife[i] <= 0) {
        this.partCol[o] = this.partCol[o + 1] = this.partCol[o + 2] = 0;
        partDirty = true;
        continue;
      }
      this.partVel[o + 1] -= this.partGrav[i] * dt;
      this.partPos[o] += this.partVel[o] * dt;
      this.partPos[o + 1] += this.partVel[o + 1] * dt;
      this.partPos[o + 2] += this.partVel[o + 2] * dt;
      const k = this.partLife[i] / this.partMax[i];
      this.partCol[o] = this.partBase[o] * k;
      this.partCol[o + 1] = this.partBase[o + 1] * k;
      this.partCol[o + 2] = this.partBase[o + 2] * k;
      partDirty = true;
    }
    if (partDirty) {
      this.particles.geometry.attributes.position.needsUpdate = true;
      this.particles.geometry.attributes.color.needsUpdate = true;
    }

    // decals
    for (const d of this.decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.visible = false;
        d.mesh.material.opacity = 0;
      } else if (d.life < 2) {
        d.mesh.material.opacity = 0.85 * (d.life / 2);
      }
    }

    // muzzle flashes
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.sprite.visible = false;
        f.sprite.material.opacity = 0;
      } else {
        f.sprite.material.opacity = Math.min(1, f.life / 0.055);
      }
    }
    if (this.flashLightLife > 0) {
      this.flashLightLife -= dt;
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity * (this.flashLightLife > 0 ? 0.75 : 0));
      if (this.flashLightLife <= 0) this.flashLight.intensity = 0;
    }

    // rings
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = 1 - Math.max(0, r.life) / r.max;
      const s = r.from + (r.to - r.from) * k;
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = 0.85 * (1 - k);
      if (r.life <= 0) {
        r.mesh.visible = false;
        r.mesh.material.opacity = 0;
      }
    }
  }
}
