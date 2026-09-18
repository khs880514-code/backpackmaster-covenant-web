import { describe, expect, it } from 'vitest';
import {
  STRIKE_SURFACE_LENGTH,
  createGameEngine,
  geometricContact,
  type EngineOptions
} from '../../src/game/engine';
import { SHOES } from '../../src/game/config';
import type { ImpactGrade } from '../../src/game/types';

function engineWith(grades: ImpactGrade[], overrides: Partial<EngineOptions> = {}) {
  let index = 0;
  return createGameEngine({
    pose: 'standing-front',
    shoe: 'pump',
    power: 5,
    seed: 11,
    // Injected adapter replaces geometric collision so the run is deterministic.
    resolveContact: () => {
      const grade = grades[Math.min(index, grades.length - 1)] ?? 'graze';
      index += 1;
      return { grade, contacted: 'left' as const };
    },
    ...overrides
  });
}

/** Advances the engine in fixed 1/60 chunks until it settles or times out. */
function runUntilSettled(engine: ReturnType<typeof createGameEngine>, maxSeconds = 240) {
  const step = 1 / 60;
  let snapshot = engine.snapshot();
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += step) {
    snapshot = engine.update(step);
    if (snapshot.phase === 'won' || snapshot.phase === 'lost') break;
  }
  return snapshot;
}

describe('game engine', () => {
  it('starts in setup with ten empty dots', () => {
    const engine = engineWith(['graze']);
    const snapshot = engine.snapshot();
    expect(snapshot.phase).toBe('setup');
    expect(snapshot.hitDots).toHaveLength(10);
    expect(snapshot.hitDots.every((dot) => dot === false)).toBe(true);
    expect(snapshot.result).toBe('in-progress');
  });

  it('wins after ten grazing contacts', () => {
    const engine = engineWith(Array.from({ length: 10 }, () => 'graze' as ImpactGrade));
    engine.start();
    const snapshot = runUntilSettled(engine);
    expect(snapshot.phase).toBe('won');
    expect(snapshot.result).toBe('survived');
    expect(snapshot.hitDots.every((dot) => dot === true)).toBe(true);
    expect(engine.attackCount()).toBe(10);
  });

  it('needs an eleventh attack when the first one misses', () => {
    const engine = engineWith([
      'miss',
      ...Array.from({ length: 10 }, () => 'graze' as ImpactGrade)
    ]);
    engine.start();
    const snapshot = runUntilSettled(engine);
    expect(snapshot.phase).toBe('won');
    expect(snapshot.hitDots.filter(Boolean)).toHaveLength(10);
    expect(engine.attackCount()).toBe(11);
  });

  it('loses when a proxy ruptures', () => {
    const engine = engineWith(
      Array.from({ length: 12 }, () => 'center-compression' as ImpactGrade),
      { power: 10 }
    );
    engine.start();
    const snapshot = runUntilSettled(engine);
    expect(snapshot.phase).toBe('lost');
    expect(snapshot.result).toBe('ruptured');
    expect(snapshot.proxies.some((proxy) => proxy.stage === 'ruptured')).toBe(true);
  });

  it('publishes only categorical proxy data', () => {
    const engine = engineWith(['graze']);
    engine.start();
    const snapshot = engine.update(1 / 60);
    for (const proxy of snapshot.proxies) {
      expect(['normal', 'initial', 'damaged', 'critical', 'ruptured']).toContain(
        proxy.stage
      );
      expect(Object.keys(proxy)).not.toContain('fatigue');
      expect(Object.keys(proxy)).not.toContain('permanent');
    }
  });

  it('produces the same result regardless of frame pacing', () => {
    const grades = Array.from({ length: 10 }, () => 'graze' as ImpactGrade);
    const fast = engineWith(grades);
    fast.start();
    for (let i = 0; i < 6000; i += 1) fast.update(1 / 120);

    const slow = engineWith(grades);
    slow.start();
    for (let i = 0; i < 1500; i += 1) slow.update(1 / 30);

    expect(fast.snapshot().phase).toBe(slow.snapshot().phase);
    expect(fast.snapshot().hitDots).toEqual(slow.snapshot().hitDots);
  });

  it('clamps pelvis movement to the pose limits', () => {
    const engine = engineWith(['graze'], { pose: 'kneeling-front' });
    engine.start();
    engine.movePelvis({ x: 5, y: 0 });
    const snapshot = engine.update(1 / 60);
    expect(snapshot.anchor.x).toBeLessThanOrEqual(0.651);
  });

  it('reports the selected setup on every snapshot', () => {
    const engine = engineWith(['graze'], { pose: 'kneeling-front', shoe: 'stiletto', power: 8 });
    const snapshot = engine.snapshot();
    expect(snapshot.pose).toBe('kneeling-front');
    expect(snapshot.shoe).toBe('stiletto');
    expect(snapshot.power).toBe(8);
  });

  it('never advances more than eight substeps for one huge delta', () => {
    const engine = engineWith(['graze']);
    engine.start();
    const before = engine.simulationTime();
    engine.update(10);
    expect(engine.simulationTime() - before).toBeLessThanOrEqual(8 / 120 + 1e-9);
  });
});

describe('the striking surface', () => {
  const shoe = SHOES.pump;
  const plan = {} as never;
  const at = (x: number, y: number, z: number) => ({ x, y, z });

  /** Toe at the origin, instep trailing 13cm back along +Z toward the attacker. */
  const toe = at(0, 0.9, 0);
  const instep = at(0, 0.9, STRIKE_SURFACE_LENGTH);

  function grade(proxy: { x: number; y: number; z: number }) {
    return geometricContact({
      foot: toe,
      instep,
      left: proxy,
      right: at(proxy.x + 0.084, proxy.y, proxy.z),
      shoe,
      plan
    }).grade;
  }

  it('registers a contact on the toe', () => {
    expect(grade(at(0, 0.9, 0))).not.toBe('miss');
  });

  it('still registers one further back, on the instep', () => {
    // Sliding the pair along the length of the foot is not a dodge: the shoe
    // is still passing through it.
    expect(grade(at(0, 0.9, STRIKE_SURFACE_LENGTH))).not.toBe('miss');
    expect(grade(at(0, 0.9, STRIKE_SURFACE_LENGTH * 0.5))).not.toBe('miss');
  });

  it('grades the whole surface as evenly as the toe alone', () => {
    const alongTheFoot = [0, 0.25, 0.5, 0.75, 1].map((t) =>
      grade(at(0, 0.9, STRIKE_SURFACE_LENGTH * t))
    );
    expect(new Set(alongTheFoot).size).toBe(1);
  });

  it('still misses when the pair moves off the side of the foot', () => {
    // Sideways is the axis a dodge actually works on.
    expect(grade(at(0.4, 0.9, 0))).toBe('miss');
  });

  it('misses past the far end of the surface', () => {
    expect(grade(at(0, 0.9, STRIKE_SURFACE_LENGTH + 0.5))).toBe('miss');
  });
});
