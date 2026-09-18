import { describe, expect, it } from 'vitest';
import { POSES } from '../../src/game/config';
import { clampPelvis, poseAnchor } from '../../src/game/pose';

describe('clampPelvis', () => {
  it('reduces lateral movement while kneeling', () => {
    expect(clampPelvis({ x: 1, y: 0 }, POSES['kneeling-front']).x).toBeCloseTo(0.65);
  });

  it('leaves interior points untouched', () => {
    const inside = clampPelvis({ x: 0.2, y: -0.1 }, POSES['standing-front']);
    expect(inside.x).toBeCloseTo(0.2);
    expect(inside.y).toBeCloseTo(-0.1);
  });

  it('projects diagonal overshoot back onto the ellipse', () => {
    const pose = POSES['kneeling-front'];
    const clamped = clampPelvis({ x: 4, y: 4 }, pose);
    const radius =
      (clamped.x / pose.lateralLimit) ** 2 + (clamped.y / pose.depthLimit) ** 2;
    expect(radius).toBeCloseTo(1, 5);
  });

  it('survives a zero vector without producing NaN', () => {
    const clamped = clampPelvis({ x: 0, y: 0 }, POSES['standing-front']);
    expect(Number.isNaN(clamped.x)).toBe(false);
    expect(Number.isNaN(clamped.y)).toBe(false);
  });

  it('places the kneeling anchor lower than the standing anchor', () => {
    expect(poseAnchor(POSES['kneeling-front'])).toBeLessThan(
      poseAnchor(POSES['standing-front'])
    );
  });
});
