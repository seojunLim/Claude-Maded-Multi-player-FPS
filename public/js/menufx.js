// Animated menu backdrop: a slow parallax grid horizon with drifting embers.
//
// Deliberately a 2D canvas rather than a second WebGL context — the menu has
// to stay responsive on the same phones that then have to render the match.

const DPR_CAP = 2;

export function startMenuBackdrop(canvas, opts = {}) {
  if (!canvas) return () => {};
  const g = canvas.getContext('2d');
  if (!g) return () => {};

  // Respect the OS "reduce motion" switch, and go easy on touch hardware.
  const still = matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const reduced = !!opts.reduced || still;
  const motes = [];
  let w = 0;
  let h = 0;
  let raf = 0;
  let t = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, reduced ? 1.25 : DPR_CAP);
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    motes.length = 0;
    const count = reduced ? 28 : 70;
    for (let i = 0; i < count; i++) {
      motes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.4,
        // Slow upward drift, faster for the ones drawn larger — cheap parallax.
        v: Math.random() * 10 + 4,
        a: Math.random() * 0.5 + 0.1,
      });
    }
  }

  function grid(dt) {
    // A perspective floor grid receding to a horizon just under mid-screen.
    const horizon = h * 0.52;
    const rows = 22;
    g.lineWidth = 1;
    for (let i = 1; i <= rows; i++) {
      // Rows bunch up towards the horizon and scroll towards the viewer.
      const f = ((i + (t * 0.22) % 1) / rows) ** 2.4;
      const y = horizon + f * (h - horizon);
      g.strokeStyle = `rgba(90,160,230,${0.16 * (1 - f) + 0.02})`;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    const cols = 26;
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols - 0.5) * w * 2.6 + w / 2;
      g.strokeStyle = 'rgba(90,160,230,0.09)';
      g.beginPath();
      g.moveTo(w / 2, horizon);
      g.lineTo(x, h);
      g.stroke();
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    // The menu is hidden the whole time a match is running; do not burn a
    // frame budget the renderer needs.
    if (canvas.offsetParent === null) return;

    const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
    frame.last = now;
    t += dt;

    g.clearRect(0, 0, w, h);

    // Horizon glow.
    const glow = g.createRadialGradient(w / 2, h * 0.52, 0, w / 2, h * 0.52, Math.max(w, h) * 0.7);
    glow.addColorStop(0, 'rgba(56,189,248,0.16)');
    glow.addColorStop(0.45, 'rgba(30,64,120,0.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);

    grid(dt);

    for (const m of motes) {
      m.y -= m.v * dt;
      if (m.y < -4) {
        m.y = h + 4;
        m.x = Math.random() * w;
      }
      g.globalAlpha = m.a;
      g.fillStyle = m.r > 1.2 ? '#7dd3fc' : '#e2e8f0';
      g.beginPath();
      g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    if (!reduced) {
      // A slow scanning band, the one thing on screen that reads as "live".
      const sweep = ((t * 0.06) % 1) * (h + 200) - 100;
      const band = g.createLinearGradient(0, sweep - 90, 0, sweep + 90);
      band.addColorStop(0, 'rgba(125,211,252,0)');
      band.addColorStop(0.5, 'rgba(125,211,252,0.055)');
      band.addColorStop(1, 'rgba(125,211,252,0)');
      g.fillStyle = band;
      g.fillRect(0, sweep - 90, w, 180);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}
