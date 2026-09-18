import { describe, expect, it } from 'vitest';
import { POSES, SHOES, powerProfile } from '../../src/game/config';
import { sampleFootPath, selectAttack } from '../../src/game/attack-director';
import type { AttackContext } from '../../src/game/types';

function ctx(overrides: Partial<AttackContext> = {}): AttackContext {
  return {
    validHits: 0,
    anger: 0,
    seed: 1,
    pose: POSES['standing-front'],
    shoe: SHOES.pump,
    power: powerProfile(5),
    predictedTarget: { x: 0, y: 0 },
    recentPlayerDrift: { x: 0, y: 0 },
    leftDamage: 0,
    rightDamage: 0,
    ...overrides
  };
}

describe('selectAttack', () => {
  it('uses simple attacks for hits zero and one', () => {
    expect(selectAttack(ctx({ validHits: 0 })).kind).toBe('straight');
    expect(selectAttack(ctx({ validHits: 1, seed: 99 })).kind).toBe('straight');
  });

  it('introduces feints after the fourth valid hit', () => {
    const kinds = Array.from(
      { length: 20 },
      (_, seed) => selectAttack(ctx({ validHits: 5, seed })).kind
    );
    expect(kinds).toContain('feint');
  });

  it('never feints in the first band', () => {
    const kinds = Array.from(
      { length: 40 },
      (_, seed) => selectAttack(ctx({ validHits: 1, seed })).kind
    );
    expect(kinds).not.toContain('feint');
  });

  it('adds an extra precision multiplier at high anger', () => {
    expect(selectAttack(ctx({ anger: 5 })).precision).toBeGreaterThan(
      selectAttack(ctx({ anger: 0 })).precision
    );
  });

  it('is deterministic for the same context', () => {
    const a = selectAttack(ctx({ validHits: 6, seed: 12 }));
    const b = selectAttack(ctx({ validHits: 6, seed: 12 }));
    expect(a.kind).toBe(b.kind);
    expect(a.path[3].x).toBe(b.path[3].x);
  });

  it('favors the more deformed side in the final band', () => {
    const plan = selectAttack(
      ctx({ validHits: 8, leftDamage: 0.7, rightDamage: 0.05, seed: 4 })
    );
    expect(plan.favoredSide).toBe('left');
  });

  it('shortens the telegraph when the attacker is angry', () => {
    expect(selectAttack(ctx({ anger: 5 })).telegraphDuration).toBeLessThan(
      selectAttack(ctx({ anger: 0 })).telegraphDuration
    );
  });

  it('telegraphs faster while the player is kneeling', () => {
    expect(
      selectAttack(ctx({ pose: POSES['kneeling-front'] })).telegraphDuration
    ).toBeLessThan(selectAttack(ctx({ pose: POSES['standing-front'] })).telegraphDuration);
  });

  it('recovers faster in a shoe with more recovery', () => {
    expect(selectAttack(ctx({ shoe: SHOES.stiletto })).recoveryDuration).toBeLessThan(
      selectAttack(ctx({ shoe: SHOES.platform })).recoveryDuration
    );
  });

  it('produces positive phase durations for every band', () => {
    for (let validHits = 0; validHits <= 9; validHits += 1) {
      const plan = selectAttack(ctx({ validHits, seed: validHits }));
      expect(plan.telegraphDuration).toBeGreaterThan(0);
      expect(plan.strikeDuration).toBeGreaterThan(0);
      expect(plan.recoveryDuration).toBeGreaterThan(0);
    }
  });
});

describe('sampleFootPath', () => {
  it('starts and ends on the path endpoints', () => {
    const plan = selectAttack(ctx());
    const start = sampleFootPath(plan, 0);
    const end = sampleFootPath(plan, 1);
    expect(start.x).toBeCloseTo(plan.path[0].x);
    expect(end.z).toBeCloseTo(plan.path[3].z);
  });

  it('clamps progress outside the unit interval', () => {
    const plan = selectAttack(ctx());
    expect(sampleFootPath(plan, -3).x).toBeCloseTo(plan.path[0].x);
    expect(sampleFootPath(plan, 12).x).toBeCloseTo(plan.path[3].x);
  });

  it('moves continuously toward the target', () => {
    const plan = selectAttack(ctx());
    let previous = sampleFootPath(plan, 0);
    for (let i = 1; i <= 10; i += 1) {
      const point = sampleFootPath(plan, i / 10);
      expect(Math.hypot(point.x - previous.x, point.z - previous.z)).toBeLessThan(1.5);
      previous = point;
    }
  });
});
