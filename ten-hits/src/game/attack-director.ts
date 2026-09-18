import { mixSeed, mulberry32 } from './random';
import type {
  AttackContext,
  AttackKind,
  AttackPlan,
  TargetSide,
  Vec3
} from './types';

/** Where the attacker's foot rests between attacks, in world units. */
const FOOT_REST: Vec3 = { x: 0.16, y: 0.07, z: 1.42 };

type Band = 0 | 1 | 2 | 3;

function bandOf(validHits: number): Band {
  if (validHits <= 1) return 0;
  if (validHits <= 3) return 1;
  if (validHits <= 6) return 2;
  return 3;
}

const BAND_KINDS: Record<Band, AttackKind[]> = {
  0: ['straight'],
  1: ['straight', 'straight', 'diagonal-left', 'diagonal-right'],
  2: ['straight', 'diagonal-left', 'diagonal-right', 'feint', 'feint'],
  3: ['diagonal-left', 'diagonal-right', 'feint', 'feint', 'straight']
};

const BAND_TELEGRAPH: Record<Band, number> = { 0: 1.15, 1: 0.98, 2: 0.82, 3: 0.68 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickKind(band: Band, random: () => number, context: AttackContext): AttackKind {
  const pool = BAND_KINDS[band];
  const drift = Math.abs(context.recentPlayerDrift.x);
  // A player who keeps sliding the same way earns a reverse feint.
  if (band >= 2 && drift > 0.45 && random() < 0.5) return 'feint';
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index] ?? 'straight';
}

/**
 * Picks the side before the kind, because late in the run the attacker hunts
 * the proxy that is already giving way and then bends the chosen attack
 * toward it, rather than letting a random diagonal override that read.
 */
function preferredSide(context: AttackContext, random: () => number): TargetSide | null {
  if (bandOf(context.validHits) === 3) {
    if (context.leftDamage > context.rightDamage + 0.05) return 'left';
    if (context.rightDamage > context.leftDamage + 0.05) return 'right';
  }
  return random() < 0.5 ? 'left' : 'right';
}

function alignKind(kind: AttackKind, side: TargetSide): AttackKind {
  if (kind !== 'diagonal-left' && kind !== 'diagonal-right') return kind;
  return side === 'left' ? 'diagonal-left' : 'diagonal-right';
}

/**
 * Builds a deterministic attack plan. The same context always produces the
 * same plan, which keeps replays and tests stable.
 */
export function selectAttack(context: AttackContext): AttackPlan {
  const band = bandOf(context.validHits);
  const random = mulberry32(mixSeed(context.seed, context.validHits * 7 + 1));

  const rolledKind = pickKind(band, random, context);
  const favoredSide = preferredSide(context, random) ?? 'left';
  const kind = alignKind(rolledKind, favoredSide);
  const sideSign = favoredSide === 'left' ? -1 : 1;

  const precision = clamp(
    0.34 + band * 0.08 + context.anger * 0.07 + (context.power.speed - 0.85) * 0.12,
    0,
    0.98
  );

  const telegraphDuration =
    (BAND_TELEGRAPH[band] * context.pose.telegraphMultiplier * (1 - context.anger * 0.06)) /
    context.power.speed;
  const strikeDuration = 0.36 / context.power.speed;
  const recoveryDuration = 0.62 / context.shoe.recovery;

  // Aim tracks the predicted target only as far as precision allows, so a calm
  // attacker in an early band leaves obvious room to slip aside.
  const jitter = (random() - 0.5) * (1 - precision) * 0.42;
  const aimX = context.predictedTarget.x * precision + jitter + sideSign * 0.07;
  const aimY = context.pose.anchorHeight + context.predictedTarget.y * precision * 0.35;
  const aimZ = -0.08;

  const lift = kind === 'feint' ? 0.46 : 0.3;
  const swayX = kind === 'feint' ? -sideSign * 0.34 : sideSign * 0.16;

  const path: [Vec3, Vec3, Vec3, Vec3] = [
    { x: FOOT_REST.x * sideSign, y: FOOT_REST.y, z: FOOT_REST.z },
    { x: FOOT_REST.x * sideSign + swayX, y: FOOT_REST.y + lift, z: 1.02 },
    { x: aimX + swayX * 0.5, y: aimY + lift * 0.42, z: 0.44 },
    { x: aimX, y: aimY, z: aimZ }
  ];

  return {
    kind,
    path,
    precision,
    telegraphDuration,
    strikeDuration,
    recoveryDuration,
    favoredSide
  };
}

/** Cubic Bezier sample. Progress outside 0..1 is clamped to the endpoints. */
export function sampleFootPath(plan: AttackPlan, progress: number): Vec3 {
  const t = clamp(progress, 0, 1);
  const inv = 1 - t;
  const a = inv * inv * inv;
  const b = 3 * inv * inv * t;
  const c = 3 * inv * t * t;
  const d = t * t * t;
  const [p0, p1, p2, p3] = plan.path;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z
  };
}

export function attackDuration(plan: AttackPlan): number {
  return plan.telegraphDuration + plan.strikeDuration + plan.recoveryDuration;
}

export const FOOT_REST_POSITION = FOOT_REST;
