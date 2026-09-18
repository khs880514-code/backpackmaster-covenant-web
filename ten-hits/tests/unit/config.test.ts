import { describe, expect, it } from 'vitest';
import { POSES, POSE_IDS, SHOES, powerProfile } from '../../src/game/config';

describe('game configuration', () => {
  it('ships the six approved poses and three approved shoes', () => {
    expect(POSE_IDS).toEqual([
      'standing-front',
      'kneeling-front',
      'seated-chair',
      'spread-standing',
      'crouch-front',
      'braced-back'
    ]);
    expect(Object.keys(POSES)).toEqual(POSE_IDS);
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

  it('keeps every pose profile inside sane bounds', () => {
    for (const id of POSE_IDS) {
      const pose = POSES[id];
      expect(pose.id).toBe(id);
      expect(pose.lateralLimit).toBeGreaterThan(0);
      expect(pose.lateralLimit).toBeLessThanOrEqual(1);
      expect(pose.depthLimit).toBeGreaterThan(0);
      expect(pose.telegraphMultiplier).toBeGreaterThan(0.5);
      expect(pose.anchorHeight).toBeGreaterThan(0.2);
      expect(pose.anchorHeight).toBeLessThan(1.2);
    }
  });

  it('keeps standing the most mobile pose and the spread pose the least', () => {
    const mobility = (id: (typeof POSE_IDS)[number]): number =>
      POSES[id].lateralLimit * POSES[id].depthLimit;
    const ranked = [...POSE_IDS].sort((a, b) => mobility(b) - mobility(a));
    expect(ranked[0]).toBe('standing-front');
    expect(ranked.at(-1)).toBe('spread-standing');
  });

  it('pays for low mobility with a longer telegraph', () => {
    expect(POSES['spread-standing'].telegraphMultiplier).toBeGreaterThan(
      POSES['standing-front'].telegraphMultiplier
    );
    expect(POSES['crouch-front'].telegraphMultiplier).toBeLessThan(
      POSES['standing-front'].telegraphMultiplier
    );
  });

  it('gives every pose a distinct target anchor height', () => {
    const heights = POSE_IDS.map((id) => POSES[id].anchorHeight);
    expect(new Set(heights).size).toBe(POSE_IDS.length);
  });
});
