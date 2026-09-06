// Top-down radar. The static level is pre-rendered once, then only the
// blips are redrawn each frame.

import { TEAMS } from '/shared/constants.js';
import { MAP_KINDS } from '/shared/map.js';

const COLORS = {
  [MAP_KINDS.WALL]: '#3a4557',
  [MAP_KINDS.BUILDING]: '#48566c',
  [MAP_KINDS.PLATFORM]: '#5a6b85',
  [MAP_KINDS.CRATE]: '#6b6350',
  [MAP_KINDS.STEP]: '#4a5468',
  [MAP_KINDS.PILLAR]: '#55637b',
};

export class Minimap {
  constructor(canvas, map, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    // Free-for-all has no halves to tint, and only domination has a point.
    this.teams = opts.teams !== false;
    this.zone = opts.zone || null;
    this.zoneState = null;
    this.size = canvas.width;
    this.scale = this.size / (map.half * 2);
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = this.size;
    this.renderBase();
  }

  toPx(x, z) {
    return [(x + this.map.half) * this.scale, (z + this.map.half) * this.scale];
  }

  renderBase() {
    const g = this.base.getContext('2d');
    g.clearRect(0, 0, this.size, this.size);
    g.fillStyle = 'rgba(9,14,22,0.72)';
    g.fillRect(0, 0, this.size, this.size);

    // Team-tinted spawn halves.
    for (const team of this.teams ? TEAMS : []) {
      const grad = g.createLinearGradient(0, team.id === 0 ? this.size : 0, 0, this.size / 2);
      grad.addColorStop(0, team.cssColor + '2b');
      grad.addColorStop(1, 'transparent');
      g.fillStyle = grad;
      g.fillRect(0, team.id === 0 ? this.size * 0.62 : 0, this.size, this.size * 0.38);
    }

    for (const b of this.map.boxes) {
      const color = COLORS[b.kind];
      if (!color || b.max[1] <= 0.25) continue;
      const [x0, z0] = this.toPx(b.min[0], b.min[2]);
      const [x1, z1] = this.toPx(b.max[0], b.max[2]);
      // Taller geometry reads as more opaque.
      g.globalAlpha = Math.min(0.95, 0.35 + b.max[1] / 12);
      g.fillStyle = color;
      g.fillRect(x0, z0, Math.max(1.5, x1 - x0), Math.max(1.5, z1 - z0));
    }
    g.globalAlpha = 1;
  }

  drawZone(g) {
    const z = this.zone;
    const [cx, cz] = this.toPx(z.x, z.z);
    const r = z.r * this.scale;
    const st = this.zoneState;
    const color = st && st.owner >= 0 ? TEAMS[st.owner].cssColor : '#e2e8f0';
    g.save();
    g.globalAlpha = st && st.contested ? 0.34 : 0.2;
    g.fillStyle = color;
    g.beginPath();
    g.arc(cx, cz, r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = color;
    g.lineWidth = 2;
    // A dashed ring is the standard "nobody owns this yet" read.
    g.setLineDash(st && st.contested ? [4, 3] : []);
    g.beginPath();
    g.arc(cx, cz, r, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  /** Domination feeds the live control-point state in every snapshot. */
  setZoneState(state) {
    this.zoneState = state;
  }

  /**
   * @param view {x,z,yaw,team}
   * @param blips [{x,z,team,alive,self,revealed,ping}]
   */
  draw(view, blips) {
    const g = this.ctx;
    const s = this.size;
    g.clearRect(0, 0, s, s);
    g.drawImage(this.base, 0, 0);

    if (this.zone) this.drawZone(g);

    // View cone.
    const [px, pz] = this.toPx(view.x, view.z);
    g.save();
    g.translate(px, pz);
    g.rotate(-view.yaw);
    const cone = g.createLinearGradient(0, 0, 0, -46);
    cone.addColorStop(0, 'rgba(226,240,255,0.30)');
    cone.addColorStop(1, 'rgba(226,240,255,0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-26, -46);
    g.lineTo(26, -46);
    g.closePath();
    g.fill();
    g.restore();

    for (const b of blips) {
      const [x, z] = this.toPx(b.x, b.z);
      const color = TEAMS[b.team]?.cssColor ?? '#fff';
      if (b.ping) {
        // Gunfire ping ring.
        g.strokeStyle = color;
        g.globalAlpha = b.ping;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, z, 4 + (1 - b.ping) * 9, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      if (!b.alive) continue;
      if (b.self) {
        g.save();
        g.translate(x, z);
        g.rotate(-view.yaw);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(0, -5.5);
        g.lineTo(4, 4);
        g.lineTo(-4, 4);
        g.closePath();
        g.fill();
        g.restore();
        continue;
      }
      g.fillStyle = color;
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, z, b.revealed ? 3.6 : 3, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
}
