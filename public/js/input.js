// Keyboard/mouse capture. Owns pointer lock and turns raw events into the
// key bitmask the simulation consumes.

import { KEY } from '/shared/constants.js';

const BINDS = {
  KeyW: KEY.FORWARD,
  ArrowUp: KEY.FORWARD,
  KeyS: KEY.BACK,
  ArrowDown: KEY.BACK,
  KeyA: KEY.LEFT,
  ArrowLeft: KEY.LEFT,
  KeyD: KEY.RIGHT,
  ArrowRight: KEY.RIGHT,
  Space: KEY.JUMP,
  ShiftLeft: KEY.SPRINT,
  ShiftRight: KEY.SPRINT,
  ControlLeft: KEY.CROUCH,
  KeyC: KEY.CROUCH,
};

export class Input {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.keys = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = opts.sensitivity ?? 1;
    this.invertY = opts.invertY ?? false;
    this.locked = false;
    this.firing = false;
    this.firePressed = false;
    this.zooming = false;
    this.typing = false;
    this.actions = { reload: 0, ability: 0, respawn: 0 };
    this.onKey = null; // (code, event) => boolean  — return true to swallow
    this.onLockChange = null;
    this._bind();
  }

  reset(yaw = 0, pitch = 0) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.keys = 0;
    this.firing = false;
    this.zooming = false;
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock?.();
  }

  get bitmask() {
    let k = this.keys;
    if (this.zooming) k |= KEY.ZOOM;
    return k;
  }

  /** Consumes a one-shot action flag. */
  take(name) {
    if (this.actions[name]) {
      this.actions[name] = 0;
      return true;
    }
    return false;
  }

  /** Consumes a single click (for semi-auto / bolt weapons). */
  takeClick() {
    if (this.firePressed) {
      this.firePressed = false;
      return true;
    }
    return false;
  }

  _bind() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys = 0;
        this.firing = false;
        this.zooming = false;
      }
      this.onLockChange?.(this.locked);
    });

    document.addEventListener(
      'mousemove',
      (e) => {
        if (!this.locked) return;
        const s = 0.0022 * this.sensitivity;
        this.yaw -= e.movementX * s;
        this.pitch += (this.invertY ? e.movementY : -e.movementY) * s;
        const limit = Math.PI / 2 - 0.02;
        this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
        if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
        if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
      },
      { passive: true },
    );

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) {
        this.requestLock();
        return;
      }
      if (e.button === 0) {
        this.firing = true;
        this.firePressed = true;
      }
      if (e.button === 2) this.zooming = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.zooming = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (this.onKey?.(e.code, e)) return;
      if (this.typing) return;
      const bit = BINDS[e.code];
      if (bit) {
        this.keys |= bit;
        e.preventDefault();
      }
      if (e.code === 'KeyR') this.actions.reload = 1;
      if (e.code === 'KeyQ') this.actions.ability = 1;
      if (e.code === 'Space') this.actions.respawn = 1;
    });

    window.addEventListener('keyup', (e) => {
      const bit = BINDS[e.code];
      if (bit) this.keys &= ~bit;
    });

    window.addEventListener('blur', () => {
      this.keys = 0;
      this.firing = false;
      this.zooming = false;
    });
  }
}
