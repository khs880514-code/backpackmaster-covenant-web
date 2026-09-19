import { describe, expect, it } from 'vitest';
import { SHOES, powerProfile } from '../../src/game/config';
import {
  createTargetState,
  deriveColorStage,
  flinchImpulse,
  proxyStage,
  resolveImpact,
  type ImpactInput
} from '../../src/game/impact';
import type { ImpactGrade, TargetSide, TargetState } from '../../src/game/types';

interface FixtureOptions {
  grade?: ImpactGrade;
  anger?: number;
  random?: number;
  contacted?: TargetSide;
  left?: Partial<TargetState>;
  right?: Partial<TargetState>;
  power?: number;
}

function fixture(options: FixtureOptions = {}): ImpactInput {
  const random = options.random ?? 0.5;
  return {
    grade: options.grade ?? 'graze',
    contacted: options.contacted ?? 'left',
    anger: options.anger ?? 0,
    shoe: SHOES.pump,
    power: powerProfile(options.power ?? 5),
    left: { ...createTargetState(), ...options.left },
    right: { ...createTargetState(), ...options.right },
    random: () => random
  };
}

describe('resolveImpact', () => {
  it('never ruptures a healthy proxy on a graze', () => {
    const result = resolveImpact(fixture({ grade: 'graze', anger: 5, random: 0 }));
    expect(result.left.ruptured).toBe(false);
    expect(result.right.ruptured).toBe(false);
    expect(result.ruptured).toBe(false);
  });

  it('deforms only the contacted side on single compression', () => {
    const result = resolveImpact(
      fixture({ grade: 'single-compression', contacted: 'left' })
    );
    expect(result.left.permanent).toBeGreaterThan(result.right.permanent);
  });

  it('allows high anger to rupture on a center compression', () => {
    const result = resolveImpact(
      fixture({
        grade: 'center-compression',
        anger: 5,
        random: 0,
        left: { fatigue: 0.5, permanent: 0.5 },
        right: { fatigue: 0.5, permanent: 0.5 }
      })
    );
    // One side going is a loss of half the pair, not the end of the run.
    expect(result.ruptureSide).not.toBeNull();
    expect(result.ruptured).toBe(false);
  });

  it('ends the run only once both sides have gone', () => {
    const first = resolveImpact(
      fixture({
        grade: 'center-compression',
        anger: 5,
        random: 0,
        left: { fatigue: 0.5, permanent: 0.5 },
        right: { fatigue: 0.5, permanent: 0.5 }
      })
    );
    expect(first.ruptured).toBe(false);

    const second = resolveImpact(
      fixture({
        grade: 'center-compression',
        anger: 5,
        random: 0,
        left: first.left,
        right: first.right
      })
    );
    expect(second.left.ruptured && second.right.ruptured).toBe(true);
    expect(second.ruptured).toBe(true);
  });

  it('turns on whatever is left once one side has gone', () => {
    // Everything the pair used to share lands on the survivor, or standing
    // still would simply outlast the run.
    const lonely = resolveImpact(
      fixture({
        grade: 'single-compression',
        contacted: 'right',
        anger: 0,
        random: 0.5,
        left: { fatigue: 0.9, permanent: 0.9, ruptured: true },
        right: { fatigue: 0.3, permanent: 0.3 }
      })
    );
    const paired = resolveImpact(
      fixture({
        grade: 'single-compression',
        contacted: 'right',
        anger: 0,
        random: 0.5,
        left: { fatigue: 0.9, permanent: 0.9 },
        right: { fatigue: 0.3, permanent: 0.3 }
      })
    );
    expect(lonely.right.ruptured).toBe(true);
    expect(paired.right.ruptured).toBe(false);
  });

  it('leaves both sides untouched on a miss', () => {
    const result = resolveImpact(fixture({ grade: 'miss' }));
    expect(result.left.permanent).toBe(0);
    expect(result.right.permanent).toBe(0);
    expect(result.ruptured).toBe(false);
  });

  it('adds only light permanent deformation on a graze', () => {
    const result = resolveImpact(fixture({ grade: 'graze', random: 1 }));
    expect(result.left.permanent).toBeGreaterThan(0);
    expect(result.left.permanent).toBeLessThanOrEqual(0.06);
  });

  it('hits both sides on a center compression', () => {
    const result = resolveImpact(fixture({ grade: 'center-compression', random: 0 }));
    expect(result.left.permanent).toBeGreaterThanOrEqual(0.18);
    expect(result.right.permanent).toBeGreaterThanOrEqual(0.18);
  });

  it('cannot rupture a fresh proxy on a single compression', () => {
    const result = resolveImpact(
      fixture({ grade: 'single-compression', anger: 5, random: 0 })
    );
    expect(result.ruptured).toBe(false);
  });

  it('is deterministic for the same input', () => {
    const a = resolveImpact(fixture({ grade: 'single-compression', random: 0.33 }));
    const b = resolveImpact(fixture({ grade: 'single-compression', random: 0.33 }));
    expect(a.left.permanent).toBe(b.left.permanent);
  });

  it('gives a stiletto more local damage than a pump at equal power', () => {
    const base = fixture({ grade: 'single-compression', random: 0.5 });
    const pump = resolveImpact(base);
    const stiletto = resolveImpact({ ...base, shoe: SHOES.stiletto });
    expect(stiletto.left.permanent).toBeGreaterThan(pump.left.permanent);
  });
});

describe('deriveColorStage', () => {
  it('walks the four thresholds and ends at rupture', () => {
    const at = (overrides: Partial<TargetState>): number =>
      deriveColorStage({ ...createTargetState(), ...overrides });
    expect(at({})).toBe(0);
    expect(at({ permanent: 0.2 })).toBe(1);
    expect(at({ permanent: 0.4 })).toBe(2);
    expect(at({ fatigue: 0.7 })).toBe(3);
    expect(at({ ruptured: true })).toBe(4);
  });

  it('maps stages onto categorical proxy names with no numbers', () => {
    expect(proxyStage({ ...createTargetState(), ruptured: true })).toBe('ruptured');
    expect(proxyStage(createTargetState())).toBe('normal');
  });
});

describe('flinchImpulse', () => {
  it('stays still until a contact registers', () => {
    expect(flinchImpulse('miss', 10)).toEqual({ offset: 0, fold: 0 });
  });

  it('matches the authored curve at full power on a centre contact', () => {
    const impulse = flinchImpulse('center-compression', 10);
    // 0.0025 + power * 0.0025 metres, 0.35 + power * 0.42 degrees.
    expect(impulse.offset).toBeCloseTo(0.0275, 6);
    expect((impulse.fold * 180) / Math.PI).toBeCloseTo(4.55, 4);
  });

  it('grows with power', () => {
    for (let level = 2; level <= 10; level += 1) {
      expect(flinchImpulse('single-compression', level).offset).toBeGreaterThan(
        flinchImpulse('single-compression', level - 1).offset
      );
    }
  });

  it('scales with how hard the contact was', () => {
    const graze = flinchImpulse('graze', 5).offset;
    const single = flinchImpulse('single-compression', 5).offset;
    const centre = flinchImpulse('center-compression', 5).offset;
    expect(graze).toBeLessThan(single);
    expect(single).toBeLessThan(centre);
  });

  it('clamps a power level from outside the allowed range', () => {
    expect(flinchImpulse('graze', 99).offset).toBeCloseTo(
      flinchImpulse('graze', 10).offset,
      9
    );
    expect(flinchImpulse('graze', -3).offset).toBeCloseTo(
      flinchImpulse('graze', 1).offset,
      9
    );
  });

  it('keeps the flinch small enough to read as a reaction, not a knockback', () => {
    expect(flinchImpulse('center-compression', 10).offset).toBeLessThan(0.05);
  });
});
