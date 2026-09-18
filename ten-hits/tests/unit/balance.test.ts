import { describe, expect, it } from 'vitest';
import { createGameEngine } from '../../src/game/engine';
import type { GameSnapshot, ImpactGrade } from '../../src/game/types';

/**
 * The design goal is that a run is won by moving out of a direct compression
 * and into a grazing contact — not by standing still, and not by fleeing.
 * These tests pin that shape down so a tuning change cannot quietly flatten it.
 */
type Tally = Partial<Record<ImpactGrade, number>>;

/** Plays one run, dodging sideways by `offset` once the attacker commits. */
function play(seed: number, offset: number): { won: boolean; grades: Tally } {
  const engine = createGameEngine({
    pose: 'standing-front',
    shoe: 'pump',
    power: 5,
    seed
  });
  engine.start();

  const grades: Tally = {};
  let snapshot: GameSnapshot = engine.snapshot();
  let previous = snapshot.phase;

  for (let i = 0; i < 60 * 300; i += 1) {
    snapshot = engine.update(1 / 60);
    if (snapshot.phase === 'impact' && previous !== 'impact' && snapshot.lastGrade) {
      grades[snapshot.lastGrade] = (grades[snapshot.lastGrade] ?? 0) + 1;
    }
    previous = snapshot.phase;

    if (snapshot.phase === 'strike') {
      engine.movePelvis({ x: snapshot.foot.x > 0 ? -offset : offset, y: 0 });
    } else if (snapshot.phase === 'recovery') {
      engine.movePelvis({ x: 0, y: 0 });
    }
    if (snapshot.phase === 'won' || snapshot.phase === 'lost') break;
  }
  return { won: snapshot.phase === 'won', grades };
}

/** Aggregates a sweep of seeds into grade shares and a win count. */
function sweep(offset: number) {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const total: Tally = {};
  let won = 0;
  for (const seed of seeds) {
    const run = play(seed, offset);
    if (run.won) won += 1;
    for (const [grade, count] of Object.entries(run.grades)) {
      total[grade as ImpactGrade] = (total[grade as ImpactGrade] ?? 0) + count;
    }
  }
  const sum = Object.values(total).reduce((a, b) => a + b, 0) || 1;
  return {
    won,
    runs: seeds.length,
    share: (grade: ImpactGrade) => (total[grade] ?? 0) / sum
  };
}

describe('dodge balance', () => {
  it('punishes standing still with direct compressions', () => {
    const still = sweep(0);
    expect(still.share('single-compression')).toBeGreaterThan(0.6);
    expect(still.won).toBe(0);
  });

  it('rewards a measured dodge with grazing contact and wins', () => {
    const measured = sweep(0.3);
    expect(measured.share('graze')).toBeGreaterThan(0.6);
    expect(measured.share('single-compression')).toBeLessThan(0.2);
    expect(measured.won).toBeGreaterThanOrEqual(4);
  });

  it('punishes fleeing with clean misses', () => {
    const fleeing = sweep(0.6);
    expect(fleeing.share('miss')).toBeGreaterThan(0.8);
    expect(fleeing.won).toBe(0);
  });

  it('makes a small dodge measurably better than none', () => {
    // The whole complaint about an oversized proxy is that this stays flat.
    const still = sweep(0).share('graze');
    const measured = sweep(0.2).share('graze');
    expect(measured).toBeGreaterThan(still + 0.2);
  });

  it('keeps the target cluster small next to the room to dodge', () => {
    const engine = createGameEngine({
      pose: 'standing-front',
      shoe: 'pump',
      power: 5,
      seed: 1
    });
    engine.start();
    engine.update(0.5);
    const [left, right] = engine.snapshot().proxies;
    const gap = Math.abs(right.position.x - left.position.x);
    // Two proxies a hand's width apart, inside a stride of travel: a dodge has
    // to be able to clear the pair, or moving at all is pointless.
    expect(gap).toBeLessThan(0.12);
    expect(gap).toBeGreaterThan(0.05);
  });
});
