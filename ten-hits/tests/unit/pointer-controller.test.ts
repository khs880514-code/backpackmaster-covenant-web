import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPointerController } from '../../src/input/pointer-controller';

class FakePointerEvent extends Event {
  pointerId: number;
  clientX: number;
  clientY: number;

  constructor(type: string, init: { pointerId: number; clientX: number; clientY: number }) {
    super(type, { bubbles: true, cancelable: true });
    this.pointerId = init.pointerId;
    this.clientX = init.clientX;
    this.clientY = init.clientY;
  }
}

function makeSurface(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0 }) as DOMRect;
  (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
  (canvas as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture =
    () => {};
  document.body.appendChild(canvas);
  return canvas;
}

function down(el: Element, id: number, x: number, y: number): void {
  el.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: id, clientX: x, clientY: y }));
}
function move(el: Element, id: number, x: number, y: number): void {
  el.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: id, clientX: x, clientY: y }));
}
function up(el: Element, id: number, x: number, y: number): void {
  el.dispatchEvent(new FakePointerEvent('pointerup', { pointerId: id, clientX: x, clientY: y }));
}

describe('pointer controller', () => {
  let surface: HTMLCanvasElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    surface = makeSurface();
    vi.restoreAllMocks();
  });

  it('emits pelvis movement for a one-pointer drag', () => {
    const pelvisMove = vi.fn();
    const controller = createPointerController(surface, { pelvisMove });
    down(surface, 1, 200, 200);
    move(surface, 1, 280, 200);
    expect(pelvisMove).toHaveBeenCalled();
    const last = pelvisMove.mock.calls.at(-1)![0] as { x: number; y: number };
    expect(last.x).toBeGreaterThan(0);
    controller.destroy();
  });

  it('normalizes movement by the smaller viewport dimension', () => {
    const pelvisMove = vi.fn();
    const controller = createPointerController(surface, { pelvisMove });
    down(surface, 1, 200, 200);
    move(surface, 1, 400, 200);
    const last = pelvisMove.mock.calls.at(-1)![0] as { x: number; y: number };
    expect(last.x).toBeCloseTo(1, 3);
    controller.destroy();
  });

  it('emits exactly one flick for a fast release', () => {
    const pelvisFlick = vi.fn();
    const controller = createPointerController(surface, { pelvisFlick, now: () => performance.now() });
    let clock = 0;
    const timed = createPointerController(surface, { pelvisFlick, now: () => clock });
    controller.destroy();
    down(surface, 2, 200, 200);
    clock = 20;
    move(surface, 2, 340, 200);
    up(surface, 2, 340, 200);
    expect(pelvisFlick).toHaveBeenCalledTimes(1);
    timed.destroy();
  });

  it('switches to orbit with two pointers and stops pelvis movement', () => {
    const pelvisMove = vi.fn();
    const orbit = vi.fn();
    const controller = createPointerController(surface, { pelvisMove, orbit });
    down(surface, 1, 150, 200);
    down(surface, 2, 250, 200);
    pelvisMove.mockClear();
    move(surface, 1, 120, 210);
    expect(orbit).toHaveBeenCalled();
    expect(pelvisMove).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('emits zoom when the two-pointer distance changes', () => {
    const zoom = vi.fn();
    const controller = createPointerController(surface, { zoom });
    down(surface, 1, 150, 200);
    down(surface, 2, 250, 200);
    move(surface, 2, 350, 200);
    expect(zoom).toHaveBeenCalled();
    controller.destroy();
  });

  it('clears every active gesture on pointer cancel', () => {
    const pelvisMove = vi.fn();
    const controller = createPointerController(surface, { pelvisMove });
    down(surface, 1, 200, 200);
    surface.dispatchEvent(
      new FakePointerEvent('pointercancel', { pointerId: 1, clientX: 200, clientY: 200 })
    );
    pelvisMove.mockClear();
    move(surface, 1, 300, 200);
    expect(pelvisMove).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('prevents default only while a gesture is active', () => {
    const controller = createPointerController(surface, { pelvisMove: () => {} });
    const idle = new FakePointerEvent('pointermove', { pointerId: 9, clientX: 10, clientY: 10 });
    surface.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    down(surface, 1, 200, 200);
    const active = new FakePointerEvent('pointermove', { pointerId: 1, clientX: 220, clientY: 200 });
    surface.dispatchEvent(active);
    expect(active.defaultPrevented).toBe(true);
    controller.destroy();
  });

  it('removes its listeners on destroy', () => {
    const pelvisMove = vi.fn();
    const controller = createPointerController(surface, { pelvisMove });
    controller.destroy();
    down(surface, 1, 200, 200);
    move(surface, 1, 300, 200);
    expect(pelvisMove).not.toHaveBeenCalled();
  });
});
