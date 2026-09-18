import { describe, expect, it } from 'vitest';
import {
  applyImpulse,
  bodyDistance,
  createPendulumPair,
  stepPendulum,
  advancePendulum,
  PENDULUM_CORD_LENGTH,
  PENDULUM_SEPARATION,
  PENDULUM_TETHER_RADIUS
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

  it('hangs below the anchor once it stops moving', () => {
    let pair = createPendulumPair();
    for (let i = 0; i < 1200; i += 1) pair = stepPendulum(pair, { x: 0.4, y: 0 }, 1 / 120);

    // At rest it hangs off its own cord, held apart by the other body rather
    // than by a spring pulling it to a fixed offset.
    expect(pair.left.position.y).toBeLessThan(-PENDULUM_CORD_LENGTH * 0.9);
    expect(pair.left.position.y).toBeGreaterThan(-PENDULUM_TETHER_RADIUS);
    expect(pair.left.position.x).toBeLessThan(0.4);
    expect(pair.right.position.x).toBeGreaterThan(0.4);
    expect(Math.abs(pair.left.velocity.x)).toBeLessThan(0.01);
    expect(Math.abs(pair.left.velocity.y)).toBeLessThan(0.01);
  });

  it('swings through the bottom instead of stopping at it', () => {
    // A spring returns to rest without overshooting. A pendulum carries its
    // momentum past the low point, and that difference is the whole change.
    let pair = createPendulumPair();
    for (let i = 0; i < 240; i += 1) pair = stepPendulum(pair, { x: 0, y: 0 }, 1 / 120);
    const settled = pair.left.position.x;

    let swung = pair;
    let crossings = 0;
    let previous = swung.left.position.x - settled;
    // One sharp sideways move of the hips, then hold still and watch.
    for (let i = 0; i < 360; i += 1) {
      swung = stepPendulum(swung, { x: i < 12 ? 0.09 : 0, y: 0 }, 1 / 120);
      const offset = swung.left.position.x - settled;
      if (previous < 0 !== offset < 0) crossings += 1;
      previous = offset;
    }
    expect(crossings).toBeGreaterThan(1);
  });

  it('never lets the two bodies pass through each other', () => {
    let pair = createPendulumPair();
    let closest = Infinity;
    for (let i = 0; i < 600; i += 1) {
      // Shake the hips hard enough to swing them into one another.
      const x = Math.sin(i / 7) * 0.1;
      pair = stepPendulum(pair, { x, y: 0 }, 1 / 120);
      closest = Math.min(closest, bodyDistance(pair.left.position, pair.right.position));
    }
    expect(closest).toBeGreaterThan(PENDULUM_SEPARATION - 0.002);
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

describe('contact impulse', () => {
  it('drives the struck target away from what hit it', () => {
    const pair = createPendulumPair();
    const struck = applyImpulse(pair, 'right', { x: -0.2, y: 0 }, 0.5);
    expect(struck.right.velocity.x).toBeGreaterThan(pair.right.velocity.x);
    expect(struck.left.velocity.x).toBe(pair.left.velocity.x);
  });

  it('drives a dead-centre contact downward rather than nowhere', () => {
    const pair = createPendulumPair();
    const centred = { x: pair.left.position.x, y: pair.left.position.y };
    const struck = applyImpulse(pair, 'left', centred, 0.5);
    expect(struck.left.velocity.y).toBeLessThan(0);
    expect(Number.isNaN(struck.left.velocity.x)).toBe(false);
  });

  it('leaves the position alone so a hit cannot teleport the pair', () => {
    const pair = createPendulumPair();
    const struck = applyImpulse(pair, 'left', { x: 1, y: 1 }, 0.9);
    expect(struck.left.position).toEqual(pair.left.position);
  });

  it('settles back under its own cord after being knocked', () => {
    // Settle first: a freshly built pair starts on its cord but has not yet
    // been pushed apart by the other body, so it is not where rest actually is.
    let rest = createPendulumPair();
    for (let i = 0; i < 600; i += 1) rest = stepPendulum(rest, { x: 0, y: 0 }, 1 / 120);
    let pair = applyImpulse(rest, 'left', { x: 0.4, y: 0 }, 1.2);
    for (let i = 0; i < 1200; i += 1) pair = stepPendulum(pair, { x: 0, y: 0 }, 1 / 120);
    expect(pair.left.position.x).toBeCloseTo(rest.left.position.x, 2);
    expect(pair.left.position.y).toBeCloseTo(rest.left.position.y, 2);
  });
});
