import { describe, expect, it } from 'vitest';
import { createQualityMonitor } from '../../src/performance/quality';

function feed(monitor: ReturnType<typeof createQualityMonitor>, ms: number, frames: number) {
  let level = monitor.level();
  for (let i = 0; i < frames; i += 1) level = monitor.sample(ms);
  return level;
}

describe('quality monitor', () => {
  it('starts on high', () => {
    expect(createQualityMonitor().level()).toBe('high');
  });

  it('drops one level after sustained slow frames', () => {
    const monitor = createQualityMonitor();
    expect(feed(monitor, 30, 200)).toBe('medium');
  });

  it('drops to low only after a second sustained slowdown', () => {
    const monitor = createQualityMonitor();
    feed(monitor, 30, 200);
    expect(feed(monitor, 40, 200)).toBe('low');
  });

  it('never drops below low', () => {
    const monitor = createQualityMonitor();
    feed(monitor, 60, 800);
    expect(monitor.level()).toBe('low');
  });

  it('keeps high quality at a healthy frame rate', () => {
    const monitor = createQualityMonitor();
    expect(feed(monitor, 16, 400)).toBe('high');
  });

  it('never raises quality during an active strike', () => {
    const monitor = createQualityMonitor();
    feed(monitor, 30, 200);
    monitor.setStriking(true);
    feed(monitor, 8, 600);
    expect(monitor.level()).toBe('medium');
  });

  it('ignores absurd deltas from a stalled tab', () => {
    const monitor = createQualityMonitor();
    feed(monitor, 5000, 10);
    expect(monitor.level()).toBe('high');
  });
});
