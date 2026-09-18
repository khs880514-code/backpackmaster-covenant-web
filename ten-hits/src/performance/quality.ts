export type QualityLevel = 'high' | 'medium' | 'low';

const WINDOW_MS = 3000;
/** A frame longer than this came from a stall, not from real load. */
const OUTLIER_MS = 200;
const DROP_TO_MEDIUM_FPS = 45;
const DROP_TO_LOW_FPS = 35;
const RAISE_FPS = 58;

export interface QualityMonitor {
  sample(deltaMs: number): QualityLevel;
  level(): QualityLevel;
  setStriking(striking: boolean): void;
  reset(): void;
}

/**
 * Watches a rolling three-second window and steps quality down one level at a
 * time. A cooldown window after every change stops a single bad stretch from
 * collapsing straight to the lowest setting.
 */
export function createQualityMonitor(): QualityMonitor {
  let current: QualityLevel = 'high';
  let windowMs = 0;
  let frames = 0;
  let cooldown = false;
  let striking = false;

  function evaluate(): void {
    const fps = frames / (windowMs / 1000);
    windowMs = 0;
    frames = 0;

    if (cooldown) {
      cooldown = false;
      return;
    }

    if (current === 'high' && fps < DROP_TO_MEDIUM_FPS) {
      current = 'medium';
      cooldown = true;
      return;
    }
    if (current === 'medium' && fps < DROP_TO_LOW_FPS) {
      current = 'low';
      cooldown = true;
      return;
    }
    // Quality only climbs back while the player is not mid-strike, so a frame
    // spike never lands in the middle of the moment that decides the run.
    if (!striking && fps > RAISE_FPS && current !== 'high') {
      current = current === 'low' ? 'medium' : 'high';
      cooldown = true;
    }
  }

  return {
    sample(deltaMs: number): QualityLevel {
      if (Number.isFinite(deltaMs) && deltaMs > 0 && deltaMs <= OUTLIER_MS) {
        windowMs += deltaMs;
        frames += 1;
        if (windowMs >= WINDOW_MS) evaluate();
      }
      return current;
    },
    level: () => current,
    setStriking(value: boolean): void {
      striking = value;
    },
    reset(): void {
      current = 'high';
      windowMs = 0;
      frames = 0;
      cooldown = false;
    }
  };
}
