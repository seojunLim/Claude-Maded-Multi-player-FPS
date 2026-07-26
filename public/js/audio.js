// All sound is synthesised with WebAudio — no asset downloads, and every
// weapon gets its own character.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.enabled = true;
    this.lastStep = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      this.enabled = false;
      return;
    }
    const ctx = new Ctx();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;

    const master = ctx.createGain();
    master.gain.value = 0.62;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    // Shared white-noise buffer for every noise-based sound.
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this.startAmbient();
  }

  get t() {
    return this.ctx.currentTime;
  }

  /** Gain + stereo pan node chain for a sound coming from a world position. */
  spatial(worldPos, listener, refDist = 9, maxDist = 90) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    let vol = 1;
    let pan = 0;
    if (worldPos && listener) {
      const dx = worldPos.x - listener.x;
      const dy = (worldPos.y || 0) - (listener.y || 0);
      const dz = worldPos.z - listener.z;
      const dist = Math.hypot(dx, dy, dz);
      vol = refDist / (refDist + Math.max(0, dist - refDist) * 1.25);
      if (dist > maxDist) vol = 0;
      // Project onto the listener's right vector for a simple stereo image.
      const rx = Math.cos(listener.yaw || 0);
      const rz = -Math.sin(listener.yaw || 0);
      const len = Math.hypot(dx, dz) || 1;
      pan = Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / len) * 0.85));
      gain.dist = dist;
    }
    gain.gain.value = vol;
    let out = gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      out = p;
    }
    out.connect(this.master);
    gain.tail = out;
    return gain;
  }

  burst(dest, { dur = 0.12, freq = 1800, q = 1, type = 'lowpass', gain = 1, sweepTo = null, delay = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t0 = this.t + delay;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (sweepTo) {
      filter.frequency.setValueAtTime(freq, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    }
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(t0, Math.random() * 0.4);
    src.stop(t0 + dur + 0.05);
  }

  tone(dest, { freq = 440, dur = 0.12, gain = 0.3, type = 'sine', to = null, delay = 0 }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    const t0 = this.t + delay;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------- weapons

  shot(heroId, worldPos, listener, own = false) {
    if (!this.ctx) return;
    const out = this.spatial(worldPos, listener, own ? 1e6 : 10, 130);
    if (out.gain.value <= 0.001) return;
    const far = !own && (out.gain.dist || 0) > 26;

    const profiles = {
      ranger: { dur: 0.15, freq: 4200, sweep: 500, thump: 120, gain: 0.85 },
      medic: { dur: 0.1, freq: 5200, sweep: 900, thump: 165, gain: 0.6 },
      sentinel: { dur: 0.34, freq: 2600, sweep: 180, thump: 72, gain: 1.15 },
      marksman: { dur: 0.42, freq: 6200, sweep: 260, thump: 88, gain: 1.25 },
    };
    const p = profiles[heroId] || profiles.ranger;
    const g = own ? p.gain * 0.5 : p.gain;

    this.burst(out, { dur: p.dur, freq: far ? 1200 : p.freq, sweepTo: p.sweep, gain: g, q: 0.7 });
    this.tone(out, { freq: p.thump, to: p.thump * 0.45, dur: p.dur * 0.9, gain: g * 0.45, type: 'sine' });
    if (far) {
      // Crude reflection so distant fire feels like it is in a big space.
      this.burst(out, { dur: 0.32, freq: 700, gain: g * 0.35, delay: 0.07, sweepTo: 220 });
    }
  }

  impact(worldPos, listener, surf = 'wall') {
    if (!this.ctx) return;
    const out = this.spatial(worldPos, listener, 7, 55);
    if (out.gain.value <= 0.002) return;
    const metal = surf === 'building' || surf === 'platform' || surf === 'pillar';
    this.burst(out, { dur: metal ? 0.09 : 0.05, freq: metal ? 3800 : 2200, gain: 0.5, type: 'bandpass', q: 2 });
    if (metal) this.tone(out, { freq: 1500 + Math.random() * 900, to: 600, dur: 0.09, gain: 0.12, type: 'triangle' });
  }

  fleshHit(worldPos, listener) {
    if (!this.ctx) return;
    const out = this.spatial(worldPos, listener, 8, 45);
    this.burst(out, { dur: 0.08, freq: 700, gain: 0.5, type: 'lowpass' });
  }

  dryFire() {
    if (!this.ctx) return;
    const out = this.spatial(null, null);
    this.burst(out, { dur: 0.03, freq: 3000, gain: 0.25, type: 'bandpass', q: 4 });
  }

  reload(long = false) {
    if (!this.ctx) return;
    const out = this.spatial(null, null);
    out.gain.value = 0.5;
    this.burst(out, { dur: 0.05, freq: 2400, gain: 0.5, type: 'bandpass', q: 3 });
    this.burst(out, { dur: 0.06, freq: 1600, gain: 0.45, type: 'bandpass', q: 3, delay: long ? 0.45 : 0.28 });
    this.burst(out, { dur: 0.04, freq: 3400, gain: 0.4, type: 'bandpass', q: 5, delay: long ? 0.75 : 0.5 });
  }

  // ------------------------------------------------------------ feedback

  hitmarker(kill = false) {
    if (!this.ctx) return;
    const out = this.spatial(null, null);
    out.gain.value = 0.45;
    if (kill) {
      this.tone(out, { freq: 880, dur: 0.09, gain: 0.4, type: 'square' });
      this.tone(out, { freq: 1320, dur: 0.14, gain: 0.35, type: 'square', delay: 0.07 });
      this.tone(out, { freq: 1760, dur: 0.2, gain: 0.3, type: 'sine', delay: 0.14 });
    } else {
      this.tone(out, { freq: 1500, dur: 0.05, gain: 0.3, type: 'sine' });
    }
  }

  hurt() {
    if (!this.ctx) return;
    const out = this.spatial(null, null);
    out.gain.value = 0.5;
    this.burst(out, { dur: 0.16, freq: 900, sweepTo: 200, gain: 0.55 });
    this.tone(out, { freq: 220, to: 90, dur: 0.22, gain: 0.2, type: 'sawtooth' });
  }

  die() {
    if (!this.ctx) return;
    const out = this.spatial(null, null);
    out.gain.value = 0.6;
    this.tone(out, { freq: 420, to: 60, dur: 0.9, gain: 0.3, type: 'triangle' });
    this.burst(out, { dur: 0.5, freq: 1200, sweepTo: 120, gain: 0.4 });
  }

  spawn() {
    if (!this.ctx) return;
    const out = this.spatial(null, null);
    out.gain.value = 0.4;
    this.tone(out, { freq: 300, to: 900, dur: 0.28, gain: 0.22, type: 'sine' });
    this.tone(out, { freq: 600, to: 1800, dur: 0.3, gain: 0.12, type: 'sine', delay: 0.05 });
  }

  ability(heroId, worldPos, listener, own) {
    if (!this.ctx) return;
    const out = this.spatial(worldPos, listener, own ? 1e6 : 12, 60);
    const g = own ? 0.4 : 0.25;
    if (heroId === 'medic') {
      this.tone(out, { freq: 520, to: 1560, dur: 0.5, gain: g, type: 'sine' });
      this.tone(out, { freq: 780, to: 2340, dur: 0.45, gain: g * 0.6, type: 'sine', delay: 0.08 });
    } else if (heroId === 'sentinel') {
      this.tone(out, { freq: 140, to: 380, dur: 0.5, gain: g, type: 'square' });
      this.burst(out, { dur: 0.4, freq: 500, gain: g * 0.5, sweepTo: 1800 });
    } else if (heroId === 'marksman') {
      this.tone(out, { freq: 1200, to: 2600, dur: 0.35, gain: g * 0.8, type: 'triangle' });
      this.tone(out, { freq: 1800, to: 900, dur: 0.5, gain: g * 0.4, type: 'sine', delay: 0.12 });
    } else {
      this.tone(out, { freq: 260, to: 1300, dur: 0.42, gain: g, type: 'sawtooth' });
    }
  }

  footstep(speed, crouching) {
    if (!this.ctx) return;
    const now = performance.now();
    const gap = crouching ? 640 : speed > 7 ? 300 : 400;
    if (now - this.lastStep < gap) return;
    this.lastStep = now;
    const out = this.spatial(null, null);
    out.gain.value = crouching ? 0.1 : 0.2;
    this.burst(out, { dur: 0.07, freq: 500 + Math.random() * 400, gain: 0.4, sweepTo: 180 });
  }

  remoteStep(worldPos, listener) {
    if (!this.ctx) return;
    const out = this.spatial(worldPos, listener, 4, 26);
    if (out.gain.value < 0.02) return;
    this.burst(out, { dur: 0.07, freq: 600, gain: 0.35, sweepTo: 200 });
  }

  ui(kind) {
    if (!this.ctx) return;
    const out = this.spatial(null, null);
    out.gain.value = 0.3;
    if (kind === 'win') {
      [523, 659, 784, 1046].forEach((f, i) => this.tone(out, { freq: f, dur: 0.4, gain: 0.25, type: 'triangle', delay: i * 0.13 }));
    } else if (kind === 'lose') {
      [523, 415, 330, 262].forEach((f, i) => this.tone(out, { freq: f, dur: 0.45, gain: 0.22, type: 'triangle', delay: i * 0.15 }));
    } else {
      this.tone(out, { freq: 700, dur: 0.07, gain: 0.2, type: 'square' });
    }
  }

  startAmbient() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    g.connect(this.master);
    for (const f of [44, 57.5, 88]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      osc.connect(og);
      og.connect(g);
      osc.start();
    }
    // Slow filtered noise "wind".
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    lfo.connect(lfoGain);
    lfoGain.connect(ng.gain);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(g);
    src.start();
    lfo.start();
  }
}
