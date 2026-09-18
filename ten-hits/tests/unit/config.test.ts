import { describe, expect, it } from 'vitest';
import { POSES, SHOES, powerProfile } from '../../src/game/config';

describe('game configuration', () => {
  it('ships the two approved poses and three approved shoes', () => {
    expect(Object.keys(POSES)).toEqual(['standing-front', 'kneeling-front']);
    expect(Object.keys(SHOES)).toEqual(['pump', 'stiletto', 'platform']);
  });

  it('clamps power to 1 through 10', () => {
    expect(powerProfile(0).level).toBe(1);
    expect(powerProfile(99).level).toBe(10);
  });

  it('increases speed and impulse monotonically with power', () => {
    for (let level = 2; level <= 10; level += 1) {
      const lower = powerProfile(level - 1);
      const upper = powerProfile(level);
      expect(upper.speed).toBeGreaterThan(lower.speed);
      expect(upper.impulse).toBeGreaterThan(lower.impulse);
    }
  });

  it('keeps kneeling movement tighter than standing movement', () => {
    expect(POSES['kneeling-front'].lateralLimit).toBeLessThan(
      POSES['standing-front'].lateralLimit
    );
    expect(POSES['kneeling-front'].depthLimit).toBeLessThan(
      POSES['standing-front'].depthLimit
    );
  });
});
