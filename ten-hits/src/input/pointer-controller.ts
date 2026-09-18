import type { Vec2 } from '../game/types';

export interface PointerHandlers {
  pelvisMove?: (delta: Vec2) => void;
  pelvisFlick?: (direction: Vec2) => void;
  orbit?: (delta: Vec2) => void;
  zoom?: (delta: number) => void;
  /** Injectable clock so flick detection is testable without real timers. */
  now?: () => number;
}

export interface PointerController {
  destroy(): void;
  activeGesture(): 'none' | 'pelvis' | 'orbit';
}

/** Normalized units per second that separate a drag from a flick. */
const FLICK_THRESHOLD = 0.85;

interface TrackedPointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  velocity: Vec2;
}

/**
 * Interprets touch and mouse gestures. One pointer steers the pelvis, two
 * pointers orbit and zoom the camera, and the two modes never fire together.
 */
export function createPointerController(
  surface: HTMLElement,
  handlers: PointerHandlers
): PointerController {
  const now = handlers.now ?? (() => performance.now());
  const pointers = new Map<number, TrackedPointer>();
  let gesture: 'none' | 'pelvis' | 'orbit' = 'none';
  let pinchDistance = 0;

  /** Half the smaller viewport dimension maps to one normalized unit. */
  function scale(): number {
    const rect = surface.getBoundingClientRect();
    return Math.max(1, Math.min(rect.width, rect.height) / 2);
  }

  function capture(id: number): void {
    const target = surface as unknown as { setPointerCapture?: (id: number) => void };
    target.setPointerCapture?.(id);
  }

  function release(id: number): void {
    const target = surface as unknown as { releasePointerCapture?: (id: number) => void };
    try {
      target.releasePointerCapture?.(id);
    } catch {
      // A pointer that was never captured is not an error worth surfacing.
    }
  }

  function currentPinch(): number {
    const list = [...pointers.values()];
    if (list.length < 2) return 0;
    const [a, b] = list as [TrackedPointer, TrackedPointer];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onDown(event: PointerEvent): void {
    const time = now();
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: time,
      velocity: { x: 0, y: 0 }
    });
    capture(event.pointerId);
    event.preventDefault();

    if (pointers.size === 1) {
      gesture = 'pelvis';
    } else if (pointers.size >= 2) {
      gesture = 'orbit';
      pinchDistance = currentPinch();
    }
  }

  function onMove(event: PointerEvent): void {
    const tracked = pointers.get(event.pointerId);
    if (!tracked) return;
    event.preventDefault();

    const time = now();
    const dt = (time - tracked.lastTime) / 1000;
    const unit = scale();
    if (dt > 0) {
      tracked.velocity = {
        x: (event.clientX - tracked.lastX) / unit / dt,
        y: (event.clientY - tracked.lastY) / unit / dt
      };
      tracked.lastX = event.clientX;
      tracked.lastY = event.clientY;
      tracked.lastTime = time;
    }
    tracked.x = event.clientX;
    tracked.y = event.clientY;

    if (gesture === 'pelvis' && pointers.size === 1) {
      handlers.pelvisMove?.({
        x: (tracked.x - tracked.startX) / unit,
        y: -(tracked.y - tracked.startY) / unit
      });
      return;
    }

    if (gesture === 'orbit') {
      handlers.orbit?.({
        x: (event.clientX - tracked.startX) / unit,
        y: (event.clientY - tracked.startY) / unit
      });
      const pinch = currentPinch();
      if (pinchDistance > 0 && Math.abs(pinch - pinchDistance) > 0.5) {
        handlers.zoom?.((pinchDistance - pinch) / unit);
        pinchDistance = pinch;
      }
    }
  }

  function onUp(event: PointerEvent): void {
    const tracked = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    release(event.pointerId);

    if (tracked && gesture === 'pelvis') {
      const speed = Math.hypot(tracked.velocity.x, tracked.velocity.y);
      if (speed >= FLICK_THRESHOLD) {
        handlers.pelvisFlick?.({
          x: tracked.velocity.x / speed,
          y: -tracked.velocity.y / speed
        });
      }
    }

    if (pointers.size === 0) {
      gesture = 'none';
      pinchDistance = 0;
    } else if (pointers.size === 1) {
      // Dropping back to one pointer restarts that pointer as a fresh drag.
      const remaining = [...pointers.values()][0]!;
      remaining.startX = remaining.x;
      remaining.startY = remaining.y;
      gesture = 'pelvis';
    }
  }

  function onCancel(): void {
    for (const id of pointers.keys()) release(id);
    pointers.clear();
    gesture = 'none';
    pinchDistance = 0;
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    handlers.zoom?.(event.deltaY / 400);
  }

  surface.addEventListener('pointerdown', onDown as EventListener);
  surface.addEventListener('pointermove', onMove as EventListener);
  surface.addEventListener('pointerup', onUp as EventListener);
  surface.addEventListener('pointercancel', onCancel as EventListener);
  surface.addEventListener('wheel', onWheel as EventListener, { passive: false });

  return {
    destroy(): void {
      onCancel();
      surface.removeEventListener('pointerdown', onDown as EventListener);
      surface.removeEventListener('pointermove', onMove as EventListener);
      surface.removeEventListener('pointerup', onUp as EventListener);
      surface.removeEventListener('pointercancel', onCancel as EventListener);
      surface.removeEventListener('wheel', onWheel as EventListener);
    },
    activeGesture(): 'none' | 'pelvis' | 'orbit' {
      return gesture;
    }
  };
}

export { FLICK_THRESHOLD };
