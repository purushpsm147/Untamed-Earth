import { beforeAll, describe, expect, it } from 'vitest';

// Minimal browser surface that Input touches (no DOM library needed).
type L = (e: Record<string, unknown>) => void;
class Target {
  private ls = new Map<string, L[]>();
  addEventListener(t: string, f: L): void { this.ls.set(t, [...(this.ls.get(t) ?? []), f]); }
  fire(t: string, e: Record<string, unknown>): void { for (const f of this.ls.get(t) ?? []) f({ preventDefault() {}, target: null, repeat: false, ...e }); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
}
const win = new Target();
let Input: typeof import('../../apps/web/src/input/Input').Input;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window = Object.assign(win, { innerWidth: 1280, innerHeight: 720 });
  g.document = { pointerLockElement: null };
  for (const n of ['HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLButtonElement']) g[n] = class {};
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
  Input = (await import('../../apps/web/src/input/Input')).Input;
});

describe('input on slow devices', () => {
  it('a key tapped entirely between two frames still moves for one frame, and only one', () => {
    const input = new Input(new Target() as unknown as HTMLElement, null);
    input.poll(0.016);
    expect(input.moveX).toBe(0);
    win.fire('keydown', { code: 'KeyA' });
    win.fire('keyup', { code: 'KeyA' });
    input.poll(0.4); // the next (slow) frame
    expect(input.moveX).toBe(-1);
    input.poll(0.4);
    expect(input.moveX).toBe(0);
  });
  it('a held key keeps working and release stops it', () => {
    const input = new Input(new Target() as unknown as HTMLElement, null);
    win.fire('keydown', { code: 'KeyW' });
    input.poll(0.1);
    input.poll(0.1);
    expect(input.moveZ).toBe(1);
    win.fire('keyup', { code: 'KeyW' });
    input.poll(0.1);
    expect(input.moveZ).toBe(0);
  });
});
