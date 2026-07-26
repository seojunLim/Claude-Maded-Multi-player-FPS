// On-screen controls for phones and tablets.
//
// Only `pointerType === 'touch'` events are handled, so a hybrid laptop keeps
// working with mouse + keyboard and only shows these controls once the player
// actually touches the screen.

import { KEY, MOVE_UNIT } from '/shared/constants.js';

/**
 * Pointer capture keeps a drag alive when the finger leaves the element, but it
 * throws if the pointer is already gone. It must never take the control action
 * down with it, so every call goes through here and runs last.
 */
function capture(el, pointerId) {
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    /* pointer already released — the drag simply ends at the element edge */
  }
}

const STICK_RADIUS = 62; // px travel before the stick is fully pushed
const SPRINT_AT = 0.88; // fraction of full push that starts sprinting
const DEAD_ZONE = 0.14;

export class TouchControls {
  constructor(root, input) {
    this.root = root;
    this.input = input;
    this.active = false;

    this.stick = root.querySelector('#tstick');
    this.knob = root.querySelector('#tknob');
    this.look = root.querySelector('#tlook');

    this.stickId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.lookId = null;
    this.lookLast = { x: 0, y: 0 };

    // Analog move vector in [-1, 1], consumed by the input layer.
    this.moveX = 0;
    this.moveZ = 0;
    this.sprint = false;

    this.bindStick();
    this.bindLook();
    this.bindButtons();
  }

  /** Reveals the controls the first time a touch is seen. */
  enable() {
    if (this.active) return;
    this.active = true;
    this.root.classList.remove('hidden');
    document.body.classList.add('touch-mode');
  }

  bindStick() {
    const zone = this.root.querySelector('#tstickzone');

    zone.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch' || this.stickId !== null) return;
        this.enable();
        this.stickId = e.pointerId;
        // The stick re-centres wherever the thumb lands.
        this.stickOrigin = { x: e.clientX, y: e.clientY };
        this.stick.style.left = `${e.clientX}px`;
        this.stick.style.top = `${e.clientY}px`;
        this.stick.classList.add('on');
        e.preventDefault();
        capture(zone, e.pointerId);
      },
      { passive: false },
    );

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, STICK_RADIUS);
      if (dist > 0) {
        dx = (dx / dist) * clamped;
        dy = (dy / dist) * clamped;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

      const mag = clamped / STICK_RADIUS;
      if (mag < DEAD_ZONE) {
        this.moveX = 0;
        this.moveZ = 0;
        this.sprint = false;
        return;
      }
      // Screen down (+y) means walking backwards (+z in local space).
      const nx = dist > 0 ? dx / clamped : 0;
      const nz = dist > 0 ? dy / clamped : 0;
      this.moveX = nx * mag;
      this.moveZ = nz * mag;
      this.sprint = mag > SPRINT_AT && nz < -0.4;
    });

    const release = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.moveX = 0;
      this.moveZ = 0;
      this.sprint = false;
      this.knob.style.transform = 'translate(0px, 0px)';
      this.stick.classList.remove('on');
      // Hand the resting position back to the stylesheet.
      this.stick.style.removeProperty('left');
      this.stick.style.removeProperty('top');
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
  }

  bindLook() {
    this.look.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch' || this.lookId !== null) return;
        this.enable();
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        capture(this.look, e.pointerId);
      },
      { passive: false },
    );

    this.look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.input.lookBy(dx, dy);
    });

    const release = (e) => {
      if (e.pointerId !== this.lookId) return;
      this.lookId = null;
    };
    this.look.addEventListener('pointerup', release);
    this.look.addEventListener('pointercancel', release);

    // A quick tap on the look area fires once — handy for the sniper.
    let tapStart = 0;
    let tapPos = { x: 0, y: 0 };
    this.look.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      tapStart = performance.now();
      tapPos = { x: e.clientX, y: e.clientY };
    });
    this.look.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      const moved = Math.hypot(e.clientX - tapPos.x, e.clientY - tapPos.y);
      if (performance.now() - tapStart < 220 && moved < 12) {
        this.input.firePressed = true;
        this.input.tapFireUntil = performance.now() + 90;
      }
    });
  }

  bindButtons() {
    for (const btn of this.root.querySelectorAll('[data-act]')) {
      const act = btn.dataset.act;
      const toggle = btn.dataset.toggle === '1';

      btn.addEventListener(
        'pointerdown',
        (e) => {
          if (e.pointerType !== 'touch') return;
          e.preventDefault();
          e.stopPropagation();
          this.enable();
          if (toggle) {
            const on = !btn.classList.contains('on');
            btn.classList.toggle('on', on);
            this.applyToggle(act, on);
          } else {
            btn.classList.add('held');
            this.press(act, true);
          }
          capture(btn, e.pointerId);
        },
        { passive: false },
      );

      const up = (e) => {
        if (e.pointerType !== 'touch') return;
        btn.classList.remove('held');
        if (!toggle) this.press(act, false);
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }

  press(act, down) {
    const input = this.input;
    switch (act) {
      case 'fire':
        input.firing = down;
        if (down) input.firePressed = true;
        break;
      case 'jump':
        if (down) input.keys |= KEY.JUMP;
        else input.keys &= ~KEY.JUMP;
        break;
      case 'reload':
        if (down) input.actions.reload = 1;
        break;
      case 'ability':
        if (down) input.actions.ability = 1;
        break;
      case 'respawn':
        if (down) input.actions.respawn = 1;
        break;
      default:
        break;
    }
  }

  applyToggle(act, on) {
    const input = this.input;
    if (act === 'crouch') {
      if (on) input.keys |= KEY.CROUCH;
      else input.keys &= ~KEY.CROUCH;
    } else if (act === 'zoom') {
      input.zooming = on;
    } else if (act === 'scoreboard') {
      input.onTouchUi?.('scoreboard', on);
    } else if (act === 'chat') {
      input.onTouchUi?.('chat', on);
    }
  }

  /** Clears held state, e.g. after dying or when the tab loses focus. */
  releaseAll() {
    this.moveX = 0;
    this.moveZ = 0;
    this.sprint = false;
    this.stickId = null;
    this.lookId = null;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.stick.classList.remove('on');
    this.stick.style.removeProperty('left');
    this.stick.style.removeProperty('top');
    for (const btn of this.root.querySelectorAll('[data-act]')) {
      if (btn.dataset.toggle !== '1') btn.classList.remove('held');
    }
  }

  /** Quantised analog vector for the network command. */
  command() {
    if (!this.moveX && !this.moveZ) return { mx: 0, mz: 0 };
    return {
      mx: Math.round(this.moveX * MOVE_UNIT),
      mz: Math.round(this.moveZ * MOVE_UNIT),
    };
  }

  setDead(dead) {
    this.root.classList.toggle('dead', dead);
  }
}

/**
 * True only when a finger is the *primary* way to point — phones and tablets
 * without a trackpad. A touchscreen laptop reports a fine pointer with hover,
 * so it starts in mouse mode and flips to these controls the moment the player
 * actually touches the screen.
 */
export function looksLikeTouchDevice() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const noHover = window.matchMedia?.('(hover: none)').matches;
  return !!(coarse && noHover);
}

/** True whenever the screen can be touched at all, primary input or not. */
export function hasTouchSupport() {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}
