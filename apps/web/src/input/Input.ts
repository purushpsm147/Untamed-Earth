export type Action = 'eat' | 'drink' | 'rest' | 'release' | 'pause' | 'follow' | 'control' | 'diag' | 'help' | 'speedUp' | 'speedDown' | 'capture' | 'mute' | 'stats' | 'curiosity' | 'skip';

const KEY_ACTIONS: Record<string, Action> = {
  KeyE: 'eat', KeyF: 'drink', KeyR: 'rest', KeyX: 'release', Escape: 'pause', KeyG: 'follow', KeyP: 'control', F3: 'diag', KeyH: 'help',
  BracketRight: 'speedUp', BracketLeft: 'speedDown', KeyC: 'capture', KeyM: 'mute', KeyT: 'stats', KeyV: 'curiosity', KeyN: 'skip',
};
/** Standard-mapping gamepad buttons. */
const PAD_ACTIONS: Record<number, Action> = { 0: 'eat', 2: 'drink', 3: 'rest', 1: 'release', 9: 'pause', 5: 'speedUp', 4: 'speedDown' };

/**
 * Device-independent control state. Keyboard, mouse, touch and gamepad all feed the same
 * axes and action set, so game code never looks at raw devices.
 */
export class Input {
  moveX = 0; // strafe, +right
  moveZ = 0; // forward
  moveY = 0; // vertical
  lookX = 0; // accumulated yaw delta this frame (radians)
  lookY = 0;
  zoom = 0;
  fast = false;
  touch = false;
  /** Vertical axis from on-screen buttons. */
  touchY = 0;
  /** Set when the user clicks/taps without dragging: normalised device coordinates. */
  click: { x: number; y: number } | null = null;
  private readonly keys = new Set<string>();
  private readonly fired = new Set<Action>();
  private readonly held = new Set<Action>();
  private drag: { id: number; x: number; y: number; moved: number } | null = null;
  private stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private padPrev: boolean[] = [];
  private touchFast = false;
  enabled = false;

  constructor(private readonly el: HTMLElement, private readonly stickEl: HTMLElement | null) {
    window.addEventListener('keydown', (e) => {
      // Typing must not drive the game, but a slider or checkbox that merely holds focus must not swallow
      // the game's keys either. Escape always works; text fields and dropdowns keep every other key;
      // sliders keep the arrow keys; checkboxes keep Space. Tab is never intercepted (keyboard navigation).
      const t = e.target;
      if (e.code !== 'Escape' && (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)) {
        const kind = t instanceof HTMLInputElement ? t.type : 'select';
        if (kind !== 'range' && kind !== 'checkbox') return;
        if (kind === 'range' && e.code.startsWith('Arrow')) return;
        if (kind === 'checkbox' && e.code === 'Space') return;
      }
      // Space and Enter on a focused button activate that button, not the camera
      if (t instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
      const a = KEY_ACTIONS[e.code];
      if (a && !e.repeat) {
        this.fired.add(a);
        this.held.add(a);
      }
      if (e.code === 'F3' || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = KEY_ACTIONS[e.code];
      if (a) this.held.delete(a);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held.clear();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') {
        this.touch = true;
        if (e.clientX < window.innerWidth * 0.4 && !this.stick) {
          this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
          this.showStick();
          return;
        }
      }
      if (!this.drag) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic or already-released pointers cannot be captured; dragging still works without it */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === el) {
        this.lookX -= e.movementX * 0.0022;
        this.lookY -= e.movementY * 0.0022;
        return;
      }
      if (this.stick && e.pointerId === this.stick.id) {
        this.stick.x = e.clientX;
        this.stick.y = e.clientY;
        this.showStick();
      } else if (this.drag && e.pointerId === this.drag.id) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        const k = e.pointerType === 'touch' ? 0.005 : 0.0035;
        this.lookX -= dx * k;
        this.lookY -= dy * k;
      }
    });
    const up = (e: PointerEvent): void => {
      if (this.stick && e.pointerId === this.stick.id) {
        this.stick = null;
        this.showStick();
      } else if (this.drag && e.pointerId === this.drag.id) {
        if (this.drag.moved < 6 && this.enabled) {
          const r = el.getBoundingClientRect();
          this.click = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
        }
        this.drag = null;
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      if (this.enabled) this.zoom += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  private showStick(): void {
    const s = this.stickEl;
    if (!s) return;
    if (!this.stick) {
      s.style.display = 'none';
      return;
    }
    s.style.display = 'block';
    s.style.left = `${this.stick.x0 - 55}px`;
    s.style.top = `${this.stick.y0 - 55}px`;
    const knob = s.firstElementChild as HTMLElement;
    const dx = Math.max(-45, Math.min(45, this.stick.x - this.stick.x0));
    const dy = Math.max(-45, Math.min(45, this.stick.y - this.stick.y0));
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** On-screen buttons (touch UI) inject actions and held states through these. */
  trigger(a: Action): void {
    this.fired.add(a);
  }
  hold(a: Action, down: boolean): void {
    if (down) this.held.add(a);
    else this.held.delete(a);
  }
  setTouchFast(v: boolean): void {
    this.touchFast = v;
  }
  toggleCapture(): void {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
    else void this.el.requestPointerLock?.();
  }
  get captured(): boolean {
    return document.pointerLockElement === this.el;
  }

  /** Was the action pressed since the last frame? (edge-triggered; consumed on read) */
  pressed(a: Action): boolean {
    return this.fired.delete(a);
  }
  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  /** Sample devices into axes. Call once per frame before reading. */
  poll(dt: number): void {
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let my = (k.has("Space") ? 1 : 0) - (k.has("KeyQ") || k.has("ControlLeft") ? 1 : 0) + this.touchY;
    this.fast = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchFast;
    if (this.stick) {
      mx += Math.max(-1, Math.min(1, (this.stick.x - this.stick.x0) / 45));
      mz += Math.max(-1, Math.min(1, -(this.stick.y - this.stick.y0) / 45));
    }
    const pad = navigator.getGamepads?.().find((p) => p && p.connected && p.mapping === 'standard');
    if (pad) {
      const dz = (v: number): number => (Math.abs(v) < 0.15 ? 0 : v);
      mx += dz(pad.axes[0] ?? 0);
      mz -= dz(pad.axes[1] ?? 0);
      this.lookX -= dz(pad.axes[2] ?? 0) * dt * 2.2;
      this.lookY -= dz(pad.axes[3] ?? 0) * dt * 1.6;
      my += (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
      if (pad.buttons[10]?.pressed) this.fast = true;
      pad.buttons.forEach((b, i) => {
        const a = PAD_ACTIONS[i];
        if (a) {
          if (b.pressed && !this.padPrev[i]) this.fired.add(a);
          if (b.pressed) this.held.add(a);
          else if (this.padPrev[i]) this.held.delete(a);
        }
        this.padPrev[i] = b.pressed;
      });
    }
    this.moveX = Math.max(-1, Math.min(1, mx));
    this.moveZ = Math.max(-1, Math.min(1, mz));
    this.moveY = Math.max(-1, Math.min(1, my));
  }

  /** Clear per-frame accumulators. Call at the end of the frame. */
  endFrame(): void {
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    this.click = null;
  }
}
