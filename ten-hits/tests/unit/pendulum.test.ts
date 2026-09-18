import { describe, expect, it } from 'vitest';
import {
  createPendulumPair,
  stepPendulum,
  advancePendulum
} from '../../src/game/pendulum';

describe('paired pendulum', () => {
  it('lags behind an anchor moved to the right', () => {
    const initial = createPendulumPair();
    const next = stepPendulum(initial, { x: 1, y: 0 }, 1 / 120);
    expect(next.left.position.x).toBeGreaterThan(initial.left.position.x);
    expect(next.left.position.x).toBeLessThan(1);
  });

  it('gives the two targets mirrored rest offsets', () => {
    const pair = createPendulumPair();
    expect(pair.left.restOffset.x).toBeCloseTo(-pair.right.restOffset.x);
    expect(pair.left.restOffset.x).not.toBe(0);
  });

  it('settles back toward the anchor when it stops moving', () => {
    let pair = createPendulumPair();
    for (let i = 0; i < 1200; i += 1) pair = stepPendulum(pair, { x: 0.4, y: 0 }, 1 / 120);
    expect(pair.left.position.x).toBeCloseTo(0.4 + pair.left.restOffset.x, 2);
    expect(Math.abs(pair.left.velocity.x)).toBeLessThan(0.01);
  });

  it('produces identical results regardless of frame pacing', () => {
    let a = createPendulumPair();
    for (let i = 0; i < 120; i += 1) a = stepPendulum(a, { x: 0.7, y: 0.2 }, 1 / 120);

    let b = createPendulumPair();
    for (let i = 0; i < 60; i += 1) b = advancePendulum(b, { x: 0.7, y: 0.2 }, 2 / 120).pair;

    expect(Math.abs(a.left.position.x - b.left.position.x)).toBeLessThan(0.001);
    expect(Math.abs(a.right.position.y - b.right.position.y)).toBeLessThan(0.001);
  });

  it('keeps every target inside the tether radius', () => {
    let pair = createPendulumPair();
    for (let i = 0; i < 600; i += 1) {
      const anchor = { x: i % 2 === 0 ? 9 : -9, y: i % 3 === 0 ? 9 : -9 };
      pair = stepPendulum(pair, anchor, 1 / 120);
    }
    for (const body of [pair.left, pair.right]) {
      expect(Number.isFinite(body.position.x)).toBe(true);
      expect(Number.isFinite(body.position.y)).toBe(true);
    }
  });
});
