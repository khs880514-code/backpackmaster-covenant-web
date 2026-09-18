import type { PoseId, PoseProfile, PowerProfile, ShoeId, ShoeProfile } from './types';

export const REQUIRED_VALID_HITS = 10;
export const MAX_ANGER = 5;
export const FIXED_STEP = 1 / 120;
export const MAX_SUBSTEPS = 8;

export const POSES: Record<PoseId, PoseProfile> = {
  'standing-front': {
    id: 'standing-front',
    lateralLimit: 1,
    depthLimit: 1,
    rotationLimit: 1,
    telegraphMultiplier: 1,
    // Low enough that the thighs have parted; at 0.92 they are still closed
    // on the authored body and nothing can hang between them.
    anchorHeight: 0.86
  },
  'kneeling-front': {
    id: 'kneeling-front',
    lateralLimit: 0.65,
    depthLimit: 0.4,
    rotationLimit: 0.65,
    telegraphMultiplier: 0.82,
    anchorHeight: 0.58
  },
  // A three-sided seat pins the hips: almost no depth, a little side-to-side.
  'seated-chair': {
    id: 'seated-chair',
    lateralLimit: 0.48,
    depthLimit: 0.22,
    rotationLimit: 0.5,
    telegraphMultiplier: 0.9,
    anchorHeight: 0.62
  },
  // The spread stance trades nearly all mobility for a longer read on the
  // attack, so it stays winnable through timing rather than through dodging.
  'spread-standing': {
    id: 'spread-standing',
    lateralLimit: 0.3,
    depthLimit: 0.35,
    rotationLimit: 0.28,
    telegraphMultiplier: 1.18,
    // A braced stance parts the thighs, so the pair hangs lower and freer.
    anchorHeight: 0.83
  },
  // Lowest target and the shortest warning: fast hands, no time to think.
  'crouch-front': {
    id: 'crouch-front',
    lateralLimit: 0.8,
    depthLimit: 0.55,
    rotationLimit: 0.75,
    telegraphMultiplier: 0.7,
    anchorHeight: 0.44
  },
  // Leaning back buys depth instead of width.
  'braced-back': {
    id: 'braced-back',
    lateralLimit: 0.7,
    depthLimit: 1.15,
    rotationLimit: 0.8,
    telegraphMultiplier: 0.96,
    anchorHeight: 0.74
  }
};

export const SHOES: Record<ShoeId, ShoeProfile> = {
  pump: {
    id: 'pump',
    contactWidth: 1,
    localPressure: 0.55,
    mass: 0.9,
    recovery: 1
  },
  stiletto: {
    id: 'stiletto',
    contactWidth: 0.55,
    localPressure: 1,
    mass: 0.75,
    recovery: 1.18
  },
  platform: {
    id: 'platform',
    contactWidth: 1.35,
    localPressure: 0.72,
    mass: 1.35,
    recovery: 0.82
  }
};

export const POSE_IDS: PoseId[] = [
  'standing-front',
  'kneeling-front',
  'seated-chair',
  'spread-standing',
  'crouch-front',
  'braced-back'
];
export const SHOE_IDS: ShoeId[] = ['pump', 'stiletto', 'platform'];

export const MIN_POWER = 1;
export const MAX_POWER = 10;

/** Clamps any incoming number to a valid power level and derives its curve. */
export function powerProfile(level: number): PowerProfile {
  const safe = Number.isFinite(level) ? Math.round(level) : MIN_POWER;
  const clamped = Math.min(MAX_POWER, Math.max(MIN_POWER, safe));
  const t = (clamped - MIN_POWER) / (MAX_POWER - MIN_POWER);
  return {
    level: clamped,
    speed: 0.85 + t * 1.15,
    impulse: 0.6 + t * 1.6
  };
}

export function isPoseId(value: unknown): value is PoseId {
  return typeof value === 'string' && POSE_IDS.includes(value as PoseId);
}

export function isShoeId(value: unknown): value is ShoeId {
  return typeof value === 'string' && SHOE_IDS.includes(value as ShoeId);
}
