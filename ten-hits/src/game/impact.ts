import type {
  ColorStage,
  ImpactGrade,
  PowerProfile,
  ProxyStage,
  ShoeProfile,
  TargetSide,
  TargetState
} from './types';

export interface ImpactInput {
  grade: ImpactGrade;
  contacted: TargetSide;
  anger: number;
  shoe: ShoeProfile;
  power: PowerProfile;
  left: TargetState;
  right: TargetState;
  random: () => number;
}

export interface ImpactResult {
  left: TargetState;
  right: TargetState;
  ruptured: boolean;
  ruptureSide: TargetSide | null;
}

interface GradeRule {
  min: number;
  max: number;
  /** Fatigue a proxy must exceed after the hit before a rupture roll happens. */
  ruptureGate: number;
  ruptureBase: number;
  bothSides: boolean;
}

const GRADE_RULES: Record<Exclude<ImpactGrade, 'miss'>, GradeRule> = {
  graze: { min: 0.02, max: 0.06, ruptureGate: Infinity, ruptureBase: 0, bothSides: false },
  'single-compression': {
    min: 0.1,
    max: 0.22,
    ruptureGate: 0.42,
    ruptureBase: 0.06,
    bothSides: false
  },
  'center-compression': {
    min: 0.18,
    max: 0.34,
    ruptureGate: 0.18,
    ruptureBase: 0.16,
    bothSides: true
  }
};

const COLOR_THRESHOLDS = [0.12, 0.32, 0.58];
const PROXY_STAGES: ProxyStage[] = [
  'normal',
  'initial',
  'damaged',
  'critical',
  'ruptured'
];

export function createTargetState(): TargetState {
  return {
    reversible: 0,
    permanent: 0,
    elasticity: 1,
    fatigue: 0,
    bias: 0,
    colorStage: 0,
    ruptured: false
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Derives the categorical color stage. Callers never see the raw numbers. */
export function deriveColorStage(target: TargetState): ColorStage {
  if (target.ruptured) return 4;
  const worst = Math.max(target.permanent, target.fatigue);
  let stage = 0;
  for (const threshold of COLOR_THRESHOLDS) {
    if (worst >= threshold) stage += 1;
  }
  return stage as ColorStage;
}

export function proxyStage(target: TargetState): ProxyStage {
  return PROXY_STAGES[deriveColorStage(target)] ?? 'normal';
}

function damageAmount(rule: GradeRule, input: ImpactInput): number {
  const roll = clamp01(input.random());
  const base = rule.min + (rule.max - rule.min) * roll;
  // Power and shoe pressure move the hit inside its band, never outside it, so
  // a graze can never do compression-level damage.
  const modifier =
    (0.6 + 0.4 * input.power.impulse) * (0.75 + 0.35 * input.shoe.localPressure);
  return Math.min(rule.max, Math.max(rule.min, base * modifier));
}

function applyDamage(
  target: TargetState,
  amount: number,
  input: ImpactInput,
  side: TargetSide
): TargetState {
  const fatigueFactor = 0.75 + 0.5 * input.shoe.localPressure;
  const elasticity = Math.max(0.25, target.elasticity - amount * 0.5);
  return {
    reversible: clamp01(target.reversible + amount * 1.6),
    permanent: clamp01(target.permanent + amount),
    elasticity,
    fatigue: clamp01(target.fatigue + amount * fatigueFactor),
    bias: Math.max(-0.35, Math.min(0.35, target.bias + amount * (side === 'left' ? -0.3 : 0.3))),
    colorStage: target.colorStage,
    ruptured: target.ruptured
  };
}

function withColorStage(target: TargetState): TargetState {
  return { ...target, colorStage: deriveColorStage(target) };
}

/**
 * Resolves one contact into bounded, non-numeric visual damage.
 *
 * Rupture is gated twice: the grade must allow it at all, and the proxy must
 * already be fatigued past that grade's threshold. A fresh proxy therefore can
 * never rupture, no matter how angry the attacker is.
 */
export function resolveImpact(input: ImpactInput): ImpactResult {
  if (input.grade === 'miss') {
    return {
      left: withColorStage(input.left),
      right: withColorStage(input.right),
      ruptured: false,
      ruptureSide: null
    };
  }

  const rule = GRADE_RULES[input.grade];
  let left = input.left;
  let right = input.right;

  if (rule.bothSides) {
    left = applyDamage(left, damageAmount(rule, input), input, 'left');
    right = applyDamage(right, damageAmount(rule, input), input, 'right');
  } else if (input.contacted === 'left') {
    left = applyDamage(left, damageAmount(rule, input), input, 'left');
  } else {
    right = applyDamage(right, damageAmount(rule, input), input, 'right');
  }

  const candidates: Array<{ side: TargetSide; state: TargetState }> = rule.bothSides
    ? [
        { side: 'left', state: left },
        { side: 'right', state: right }
      ]
    : input.contacted === 'left'
      ? [{ side: 'left', state: left }]
      : [{ side: 'right', state: right }];

  let ruptureSide: TargetSide | null = null;
  const worst = candidates.reduce((a, b) => (b.state.fatigue > a.state.fatigue ? b : a));

  if (Number.isFinite(rule.ruptureGate) && worst.state.fatigue > rule.ruptureGate) {
    const chance = Math.min(
      0.95,
      Math.max(
        0,
        rule.ruptureBase +
          input.anger * 0.08 +
          worst.state.fatigue * 0.35 +
          input.shoe.localPressure * 0.08
      )
    );
    if (input.random() < chance) ruptureSide = worst.side;
  }

  if (ruptureSide === 'left') left = { ...left, ruptured: true };
  if (ruptureSide === 'right') right = { ...right, ruptured: true };

  return {
    left: withColorStage(left),
    right: withColorStage(right),
    ruptured: ruptureSide !== null,
    ruptureSide
  };
}

/** Between attacks the reversible part of the deformation springs back. */
export function recoverTarget(target: TargetState, seconds: number): TargetState {
  if (target.ruptured) return target;
  const rate = 0.55 * target.elasticity;
  return withColorStage({
    ...target,
    reversible: Math.max(0, target.reversible - rate * seconds)
  });
}

/** 0..1 squash used by the renderer, combining recoverable and lasting damage. */
export function squashFactor(target: TargetState): number {
  if (target.ruptured) return 1;
  return clamp01(target.permanent * 0.7 + target.reversible * 0.3);
}

export function crackingFactor(target: TargetState): number {
  if (target.ruptured) return 1;
  return clamp01((target.fatigue - 0.3) / 0.7);
}
