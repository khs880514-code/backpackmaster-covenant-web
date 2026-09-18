import { expect, it } from 'vitest';
import { mulberry32 } from '../../src/game/random';

it('returns the same sequence for the same seed', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

it('stays inside the unit interval and differs across seeds', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const first = a();
  expect(first).toBeGreaterThanOrEqual(0);
  expect(first).toBeLessThan(1);
  expect(first).not.toBe(b());
});
