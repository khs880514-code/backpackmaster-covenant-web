import { describe, expect, it } from 'vitest';
import { contactBands, createGameEngine, followThroughDepth } from '../../src/game/engine';
import { SHOES, SHOE_IDS } from '../../src/game/config';
import { createTargetOverlay } from '../../src/render/targets';
import type { GameSnapshot, ImpactGrade, ShoeId } from '../../src/game/types';

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

  // The offsets below moved when the pair went from a spring to real cords:
  // a measured dodge is now a larger fraction of a much smaller hip range
  // (0.45m -> 0.10m), and the window it survives in is wider. The shape being
  // asserted is unchanged — still is fatal, measured grazes, fleeing misses.
  it('rewards a measured dodge with grazing contact and wins', () => {
    const measured = sweep(0.4);
    expect(measured.share('graze')).toBeGreaterThan(0.6);
    expect(measured.share('single-compression')).toBeLessThan(0.2);
    expect(measured.won).toBeGreaterThanOrEqual(4);
  });

  it('punishes fleeing with clean misses', () => {
    const fleeing = sweep(0.9);
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

describe('damage progression', () => {
  /** Samples one proxy at every phase change through a whole run. */
  function trace(seed: number) {
    const engine = createGameEngine({
      pose: 'standing-front',
      shoe: 'pump',
      power: 7,
      seed
    });
    engine.start();

    const rows: Array<{ stage: number; cracking: number; squash: number }> = [];
    let snapshot: GameSnapshot = engine.snapshot();
    let previous = snapshot.phase;

    for (let i = 0; i < 60 * 200; i += 1) {
      snapshot = engine.update(1 / 60);
      // Dodge enough to survive a few attacks. Standing still at power 7 is
      // now fatal on the first contact, which is too short a run to prove a
      // progression never reverses.
      if (snapshot.phase === 'strike') {
        engine.movePelvis({ x: snapshot.foot.x > 0 ? -0.4 : 0.4, y: 0 });
      } else if (snapshot.phase === 'recovery') {
        engine.movePelvis({ x: 0, y: 0 });
      }
      if (snapshot.phase !== previous) {
        const proxy = snapshot.proxies[0]!;
        rows.push({
          stage: proxy.colorStage,
          cracking: proxy.cracking,
          squash: proxy.squash
        });
        previous = snapshot.phase;
      }
      if (snapshot.phase === 'won' || snapshot.phase === 'lost') break;
    }
    return rows;
  }

  it('never walks damage backwards', () => {
    for (const seed of [1, 4, 9]) {
      const rows = trace(seed);
      expect(rows.length).toBeGreaterThan(4);
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i]!.stage).toBeGreaterThanOrEqual(rows[i - 1]!.stage);
        expect(rows[i]!.cracking).toBeGreaterThanOrEqual(rows[i - 1]!.cracking - 1e-9);
      }
    }
  });

  it('lets the recoverable part of a dent spring back', () => {
    // Squash is the one channel that breathes: a proxy relaxes between
    // attacks, onto a permanent floor that itself never drops.
    const rows = trace(4);
    const relaxed = rows.some((row, i) => i > 0 && row.squash < rows[i - 1]!.squash - 1e-6);
    expect(relaxed).toBe(true);
  });

  it('keeps the proxy at constant volume while it deforms', () => {
    const overlay = createTargetOverlay();
    for (const squash of [0, 0.25, 0.5, 0.75, 1]) {
      overlay.apply({
        side: 'left',
        stage: 'damaged',
        colorStage: 2,
        squash,
        cracking: 0,
        imprint: null,
        core: 0,
        position: { x: 0, y: 0 }
      });
      const { x, y, z } = overlay.group.scale;
      expect(x * y * z).toBeCloseTo(1, 6);
    }
    overlay.dispose();
  });
});

describe('strike follow-through', () => {
  it('drives deeper the harder the strike is', () => {
    for (let level = 2; level <= 10; level += 1) {
      expect(followThroughDepth(level)).toBeGreaterThan(followThroughDepth(level - 1));
    }
    expect(followThroughDepth(1)).toBeGreaterThan(0);
  });

  it('carries the shoe past the contact plane during the impact hold', () => {
    const engine = createGameEngine({
      pose: 'standing-front',
      shoe: 'pump',
      power: 10,
      seed: 2
    });
    engine.start();

    let atContact: number | null = null;
    let deepest = Infinity;
    let snapshot: GameSnapshot = engine.snapshot();
    let previous = snapshot.phase;

    for (let i = 0; i < 60 * 30; i += 1) {
      snapshot = engine.update(1 / 60);
      if (snapshot.phase === 'impact') {
        if (previous !== 'impact') atContact = snapshot.foot.z;
        deepest = Math.min(deepest, snapshot.foot.z);
      }
      previous = snapshot.phase;
      if (atContact !== null && snapshot.phase === 'recovery') break;
    }

    expect(atContact).not.toBeNull();
    // Depth is along -Z, toward the player, so the deepest point is smaller.
    expect(deepest).toBeLessThan(atContact! - followThroughDepth(10) * 0.7);
  });

  it('leaves permanent core damage that never recovers', () => {
    const engine = createGameEngine({
      pose: 'standing-front',
      shoe: 'pump',
      power: 8,
      seed: 3
    });
    engine.start();

    let highest = 0;
    let snapshot: GameSnapshot = engine.snapshot();
    for (let i = 0; i < 60 * 200; i += 1) {
      snapshot = engine.update(1 / 60);
      for (const proxy of snapshot.proxies) {
        expect(proxy.core).toBeGreaterThanOrEqual(0);
        expect(proxy.core).toBeLessThanOrEqual(1);
      }
      const worst = Math.max(snapshot.proxies[0]!.core, snapshot.proxies[1]!.core);
      expect(worst).toBeGreaterThanOrEqual(highest - 1e-9);
      highest = Math.max(highest, worst);
      if (snapshot.phase === 'won' || snapshot.phase === 'lost') break;
    }
    expect(highest).toBeGreaterThan(0.2);
  });

  it('records how badly a run went in the core it leaves behind', () => {
    const still = runTo(0);
    const measured = runTo(0.3);
    expect(still).toBeGreaterThan(measured);
  });
});

/** Highest permanent core damage reached while dodging by `offset`. */
function runTo(offset: number): number {
  let worst = 0;
  for (const seed of [1, 2, 3, 4]) {
    const engine = createGameEngine({
      pose: 'standing-front',
      shoe: 'pump',
      power: 5,
      seed
    });
    engine.start();
    let snapshot: GameSnapshot = engine.snapshot();
    for (let i = 0; i < 60 * 300; i += 1) {
      snapshot = engine.update(1 / 60);
      worst = Math.max(worst, snapshot.proxies[0]!.core, snapshot.proxies[1]!.core);
      if (snapshot.phase === 'strike') {
        engine.movePelvis({ x: snapshot.foot.x > 0 ? -offset : offset, y: 0 });
      } else if (snapshot.phase === 'recovery') {
        engine.movePelvis({ x: 0, y: 0 });
      }
      if (snapshot.phase === 'won' || snapshot.phase === 'lost') break;
    }
  }
  return worst;
}

describe('shoe shape drives the strike', () => {
  it('sizes the judgement bands from each shoe, not from one shared number', () => {
    const bands = SHOE_IDS.map((id) => contactBands(SHOES[id]).graze);
    expect(new Set(bands.map((b) => b.toFixed(4))).size).toBe(SHOE_IDS.length);
  });

  it('gives a narrower toe a tighter window than a broader one', () => {
    // Measured toe widths: stiletto 6.0cm, strap 8.2cm.
    expect(SHOES.stiletto.contactWidth).toBeLessThan(SHOES.strap.contactWidth);
    expect(contactBands(SHOES.stiletto).graze).toBeLessThan(
      contactBands(SHOES.strap).graze
    );
  });

  it('puts more force through less shoe when the toe is pointed', () => {
    expect(SHOES.stiletto.localPressure).toBeGreaterThan(SHOES.strap.localPressure);
    expect(SHOES.platform.mass).toBeGreaterThan(SHOES.stiletto.mass);
    // Heavier shoes pull back more slowly.
    expect(SHOES.platform.recovery).toBeLessThan(SHOES.stiletto.recovery);
  });

  it('leaves every shoe winnable somewhere in its own window', () => {
    for (const shoe of SHOE_IDS) {
      const best = [0.2, 0.25, 0.3, 0.35].reduce((most, offset) => {
        const wins = [1, 2, 3, 4].filter((seed) => winsWith(seed, offset, shoe)).length;
        return Math.max(most, wins);
      }, 0);
      expect(best, `${shoe} is unwinnable`).toBeGreaterThan(0);
    }
  });

  it('makes the pointed shoe harder to survive than the broad one', () => {
    const peak = (shoe: ShoeId): number =>
      [0.2, 0.25, 0.3, 0.35].reduce((most, offset) => {
        const wins = [1, 2, 3, 4, 5, 6].filter((seed) => winsWith(seed, offset, shoe)).length;
        return Math.max(most, wins);
      }, 0);
    expect(peak('stiletto')).toBeLessThan(peak('pump'));
  });
});

/** One run dodging by `offset`; true when it survives all ten contacts. */
function winsWith(seed: number, offset: number, shoe: ShoeId): boolean {
  const engine = createGameEngine({ pose: 'standing-front', shoe, power: 5, seed });
  engine.start();
  let snapshot: GameSnapshot = engine.snapshot();
  for (let i = 0; i < 60 * 300; i += 1) {
    snapshot = engine.update(1 / 60);
    if (snapshot.phase === 'strike') {
      engine.movePelvis({ x: snapshot.foot.x > 0 ? -offset : offset, y: 0 });
    } else if (snapshot.phase === 'recovery') {
      engine.movePelvis({ x: 0, y: 0 });
    }
    if (snapshot.phase === 'won' || snapshot.phase === 'lost') break;
  }
  return snapshot.phase === 'won';
}

describe('the hit that ends the run', () => {
  /** Plays without dodging at full power until the run settles. */
  function playToEnd(seed: number) {
    const engine = createGameEngine({
      pose: 'standing-front',
      shoe: 'stiletto',
      power: 10,
      seed
    });
    engine.start();

    let impactFrames = 0;
    let sawContact = false;
    let snapshot = engine.snapshot();
    for (let i = 0; i < 60 * 300; i += 1) {
      snapshot = engine.update(1 / 60);
      if (snapshot.phase === 'won' || snapshot.phase === 'lost') break;
      impactFrames = snapshot.phase === 'impact' ? impactFrames + 1 : 0;
      if (snapshot.phase === 'impact' && snapshot.contact) sawContact = true;
    }
    return { phase: snapshot.phase, impactFrames, sawContact };
  }

  it('is reviewed before the result screen, not skipped past it', () => {
    for (const seed of [1, 5, 12]) {
      const run = playToEnd(seed);
      expect(['won', 'lost']).toContain(run.phase);
      // The deciding contact used to go straight to the result, giving the one
      // hit worth understanding no review at all. It now holds the longest.
      expect(run.impactFrames / 60).toBeGreaterThan(2);
      expect(run.sawContact).toBe(true);
    }
  });

  it('holds the deciding hit longer than an ordinary one', () => {
    const engine = createGameEngine({
      pose: 'standing-front',
      shoe: 'stiletto',
      power: 10,
      seed: 5
    });
    engine.start();

    const holds: number[] = [];
    let frames = 0;
    let previous = engine.snapshot().phase;
    for (let i = 0; i < 60 * 300; i += 1) {
      const snapshot = engine.update(1 / 60);
      if (snapshot.phase === 'impact') frames += 1;
      else if (previous === 'impact') {
        holds.push(frames / 60);
        frames = 0;
      }
      previous = snapshot.phase;
      if (snapshot.phase === 'won' || snapshot.phase === 'lost') {
        if (frames > 0) holds.push(frames / 60);
        break;
      }
    }
    expect(holds.length).toBeGreaterThan(1);
    const last = holds.at(-1)!;
    for (const hold of holds.slice(0, -1)) expect(last).toBeGreaterThan(hold);
  });
});

describe('the strike arc', () => {
  /** Samples the foot through one strike. */
  function strikePath(pose: Parameters<typeof createGameEngine>[0]['pose']) {
    const engine = createGameEngine({ pose, shoe: 'pump', power: 6, seed: 2 });
    engine.start();
    const path: Array<{ x: number; y: number; z: number }> = [];
    let previous = 'setup';
    for (let i = 0; i < 4000; i += 1) {
      engine.update(1 / 120);
      const snapshot = engine.update(0);
      if (snapshot.phase === 'strike') path.push({ ...snapshot.foot });
      if (previous === 'strike' && snapshot.phase !== 'strike') break;
      previous = snapshot.phase;
    }
    return path;
  }

  it('drives up into the target instead of coming down onto it', () => {
    // The animation plays a kick from underneath. The approach point used to
    // sit above the target, so the foot rose past it and dropped onto it — and
    // because the dent is read off this same segment, it was pressed downward
    // into a target being kicked upward.
    const path = strikePath('standing-front');
    expect(path.length).toBeGreaterThan(6);

    const from = path[path.length - 6]!;
    const to = path[path.length - 1]!;
    const rise = to.y - from.y;
    const reach = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    expect(rise).toBeGreaterThan(0);
    expect(rise / reach).toBeGreaterThan(0.3);
  });

  it('does not swing under a target lying on the floor', () => {
    // There is no room beneath one, and asking for it puts the foot through
    // the ground and out the far side without touching anything.
    const path = strikePath('spread-standing');
    const lowest = path.reduce((low, step) => Math.min(low, step.y), Infinity);
    expect(lowest).toBeGreaterThan(-0.02);
  });
});
