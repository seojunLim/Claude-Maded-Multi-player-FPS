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
    this.touchSensitivity = opts.touchSensitivity ?? 1;
    this.invertY = opts.invertY ?? false;
    this.locked = false;
    this.firing = false;
    this.firePressed = false;
    this.zooming = false;
    this.typing = false;
    this.actions = { reload: 0, ability: 0, respawn: 0, start: 0 };
    this.onKey = null; // (code, event) => boolean  — return true to swallow
    this.onLockChange = null;
    this.onTouchUi = null; // (what, on) => void

    // Touch state. `touchMode` flips on at the first touch and off again if the
    // player goes back to mouse + keyboard, so hybrid devices support both.
    this.touch = null;
    this.touchMode = false;
    this.aimAssist = 0; // 0..1, scaled down while assist is pulling the view
    this.tapFireUntil = 0;

    this._bind();
  }

  attachTouch(controls) {
    this.touch = controls;
  }

  /** Called by the touch look surface with a screen-space drag delta. */
  lookBy(dx, dy) {
    const s = 0.0034 * this.touchSensitivity * (1 - this.aimAssist * 0.45);
    this.yaw -= dx * s;
    this.pitch += (this.invertY ? dy : -dy) * s;
    this._clampPitch();
  }

  /** Analog movement from the stick, or null when the keyboard is driving. */
  analog() {
    if (!this.touchMode || !this.touch) return null;
    const cmd = this.touch.command();
    return cmd.mx || cmd.mz ? cmd : null;
  }

  reset(yaw = 0, pitch = 0) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.keys = 0;
    this.firing = false;
    this.zooming = false;
    this.touch?.releaseAll();
  }

  /** Pointer lock is meaningless on a touch screen, so it is skipped there. */
  requestLock() {
    if (this.touchMode) return;
    if (!this.locked) this.canvas.requestPointerLock?.();
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock?.();
  }

  get bitmask() {
    let k = this.keys;
    if (this.zooming) k |= KEY.ZOOM;
    if (this.touchMode && this.touch?.sprint) k |= KEY.SPRINT;
    return k;
  }

  _clampPitch() {
    const limit = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
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

    // First touch anywhere switches to touch controls; using the mouse or
    // keyboard switches back, so 2-in-1 devices support both.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') {
          this.touchMode = true;
          this.touch?.enable();
        }
      },
      { capture: true, passive: true },
    );

    document.addEventListener(
      'mousemove',
      (e) => {
        if (!this.locked) return;
        if (e.movementX || e.movementY) this.touchMode = false;
        const s = 0.0022 * this.sensitivity * (1 - this.aimAssist * 0.3);
        this.yaw -= e.movementX * s;
        this.pitch += (this.invertY ? e.movementY : -e.movementY) * s;
        this._clampPitch();
      },
      { passive: true },
    );

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.touchMode) return; // synthesised by a touch, already handled
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
      if (this.touchMode) return;
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
        this.touchMode = false; // a real keyboard is in play
        e.preventDefault();
      }
      if (e.code === 'KeyR') this.actions.reload = 1;
      // Starting a match early has to be a key: while the pointer is locked the
      // mouse belongs to the canvas and cannot reach the lobby panel's buttons.
      if (e.code === 'KeyF') this.actions.start = 1;
      if (e.code === 'KeyQ') this.actions.ability = 1;
      if (e.code === 'Space') this.actions.respawn = 1;
    });

    window.addEventListener('keyup', (e) => {
      const bit = BINDS[e.code];
      if (bit) this.keys &= ~bit;
    });

    const letGo = () => {
      this.keys = 0;
      this.firing = false;
      this.zooming = false;
      this.touch?.releaseAll();
    };
    window.addEventListener('blur', letGo);
    // Backgrounding a phone (call, lock screen) must not leave keys stuck down.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) letGo();
    });
  }
}
