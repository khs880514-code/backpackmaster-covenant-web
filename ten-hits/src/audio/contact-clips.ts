import type { ImpactGrade, PoseId } from '../game/types';

/**
 * Authored contact recordings. Four kick poses were recorded, two takes each,
 * already trimmed to the impact frame (`contact_marker_seconds: 0.0` in the
 * selection manifest), so a clip starts the instant it is dispatched.
 */
export const CONTACT_TAKES = 2;

/** Target height each authored recording was captured at, in metres. */
export const CLIP_TARGET_HEIGHT: Record<string, number> = {
  pose_12: 0.9, // STANDING_BRACED
  pose_16: 0.62, // SEATED_APERTURE — files are named pose_04, its source take
  pose_11: 0.54, // UPRIGHT_KNEELING
  pose_13: 0.42 // KNEELING_LOW
};

/** File stem of the recording used for each id above. */
export const CLIP_FILE: Record<string, string> = {
  pose_12: 'pose_12',
  pose_16: 'pose_04',
  pose_11: 'pose_11',
  pose_13: 'pose_13'
};

/**
 * Only four poses were recorded, so the other two borrow the take whose
 * authored target height sits closest to their own anchor. `contact-clips`
 * tests pin every row to that rule.
 */
export const CLIP_BY_POSE: Record<PoseId, string> = {
  'standing-front': 'pose_12',
  // Prone, aimed at 0.20m: the low kneeling take is the nearest recorded.
  'spread-standing': 'pose_13',
  'braced-back': 'pose_16',
  'seated-chair': 'pose_16',
  'kneeling-front': 'pose_11',
  'crouch-front': 'pose_13'
};

/** Loudness relative to the recorded take. A miss never reaches the pair. */
export const CONTACT_GAIN: Record<ImpactGrade, number> = {
  miss: 0,
  graze: 0.34,
  'single-compression': 0.72,
  'center-compression': 1
};

export function contactClipKey(pose: PoseId, take: number): string {
  const clip = CLIP_BY_POSE[pose];
  const index = Math.min(CONTACT_TAKES, Math.max(1, Math.round(take)));
  return `${CLIP_FILE[clip] ?? clip}-contact-0${index}`;
}

/** Every distinct file the game needs, without duplicates for shared takes. */
export function contactClipKeys(): string[] {
  const keys = new Set<string>();
  for (const clip of Object.values(CLIP_BY_POSE)) {
    for (let take = 1; take <= CONTACT_TAKES; take += 1) {
      keys.add(`${CLIP_FILE[clip] ?? clip}-contact-0${take}`);
    }
  }
  return [...keys].sort();
}

export function contactClipUrl(key: string, base = 'audio/'): string {
  return `${base}${key}.wav`;
}
