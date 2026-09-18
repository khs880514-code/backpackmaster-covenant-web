import { describe, expect, it } from 'vitest';
import { SHOES, powerProfile } from '../../src/game/config';
import {
  createTargetState,
  deriveColorStage,
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
    expect(result.ruptured).toBe(true);
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
