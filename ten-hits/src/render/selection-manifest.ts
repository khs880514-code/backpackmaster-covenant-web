import type { PoseModelManifest } from './model-library';
import type { PoseId } from '../game/types';

/**
 * Reads the authoring pipeline's `impact-shift.godot-playable-selection.v1`
 * manifest so the game can consume authored clips directly, instead of anyone
 * hand-maintaining a second mapping that drifts out of date.
 *
 * The authored file describes attack clips: each one names the posture of the
 * figure receiving it, and that posture is what maps onto a game pose.
 */
export const SELECTION_SCHEMA = 'impact-shift.godot-playable-selection.v1';

/** Authored target postures that already correspond to a game pose. */
const POSTURE_TO_POSE: Readonly<Record<string, PoseId>> = {
  STANDING_BRACED: 'standing-front',
  UPRIGHT_KNEELING: 'kneeling-front',
  SEATED_APERTURE: 'seated-chair',
  KNEELING_LOW: 'crouch-front'
};

export interface AttackTiming {
  fps: number;
  /** Clip start to the wind-up frame. */
  telegraphSeconds: number;
  /** Wind-up to the first contact frame. */
  strikeSeconds: number;
  /** First contact to the end of the playable range. */
  recoverySeconds: number;
  contactFrames: number[];
  preparationFrames: number[];
  startMode: string;
}

export interface SelectionPose {
  /** The authored id, e.g. `POSE_12`. */
  sourceId: string;
  asset: string;
  sha256: string;
  labelKo: string | null;
  targetPosture: string | null;
  targetHeightM: number | null;
  timing: AttackTiming;
}

export interface SelectionFootwear {
  id: string;
  asset: string;
  sha256: string;
}

export interface SelectionImport {
  revision: string;
  character: {
    id: string;
    skeleton: string;
    bones: number;
    strikeChain: string[];
  };
  /** Attack clips keyed by the game pose their target posture matches. */
  poses: Partial<Record<PoseId, SelectionPose>>;
  /** Clips whose target posture has no game pose yet. */
  unmapped: SelectionPose[];
  footwear: SelectionFootwear[];
  /** Anything the authoring pipeline flagged that a player would notice. */
  warnings: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function frames(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
}

/**
 * Splits an authored clip into the game's telegraph / strike / recovery phases
 * using its wind-up and contact frames.
 */
function readTiming(pose: Record<string, unknown>): AttackTiming {
  const fps = Math.max(1, num(pose['fps'], 25));
  const range = frames(pose['frame_range']);
  const start = range[0] ?? 1;
  const contactFrames = frames(pose['contact_frames']);
  const preparationFrames = frames(pose['preparation_frames']);
  const firstContact = contactFrames[0] ?? start;
  const firstPrep = preparationFrames[0] ?? firstContact;
  const end = num(pose['playable_frame_end'], range[1] ?? firstContact);

  return {
    fps,
    telegraphSeconds: Math.max(0, (firstPrep - start) / fps),
    strikeSeconds: Math.max(0, (firstContact - firstPrep) / fps),
    recoverySeconds: Math.max(0, (end - firstContact) / fps),
    contactFrames,
    preparationFrames,
    startMode: str(pose['start_mode'], 'STATIONARY')
  };
}

function readPose(sourceId: string, raw: unknown): SelectionPose | null {
  const pose = asRecord(raw);
  if (!pose) return null;
  const asset = str(pose['asset']);
  // Reject anything that is not a plain relative path inside the asset folder.
  if (!asset || asset.includes('..') || asset.startsWith('/')) return null;

  const height = pose['target_height_m'];
  return {
    sourceId,
    asset,
    sha256: str(pose['sha256']),
    labelKo: typeof pose['label_ko'] === 'string' ? pose['label_ko'] : null,
    targetPosture:
      typeof pose['target_posture'] === 'string' ? pose['target_posture'] : null,
    targetHeightM: typeof height === 'number' && Number.isFinite(height) ? height : null,
    timing: readTiming(pose)
  };
}

function readFootwear(raw: unknown): SelectionFootwear[] {
  if (!Array.isArray(raw)) return [];
  const out: SelectionFootwear[] = [];
  for (const entry of raw) {
    const item = asRecord(entry);
    if (!item) continue;
    const asset = str(item['asset']);
    if (!asset || asset.includes('..') || asset.startsWith('/')) continue;
    out.push({ id: str(item['id']), asset, sha256: str(item['sha256']) });
  }
  return out;
}

/** Returns null when the payload is not a manifest this version understands. */
export function parseSelectionManifest(raw: unknown): SelectionImport | null {
  const root = asRecord(raw);
  if (!root || root['schema'] !== SELECTION_SCHEMA) return null;

  const character = asRecord(root['character']) ?? {};
  const posesRaw = asRecord(root['poses']) ?? {};

  const poses: Partial<Record<PoseId, SelectionPose>> = {};
  const unmapped: SelectionPose[] = [];
  const warnings: string[] = [];

  for (const [sourceId, value] of Object.entries(posesRaw)) {
    const pose = readPose(sourceId, value);
    if (!pose) continue;

    const entry = asRecord(value);
    if (entry?.['source_changed_after_export'] === true) {
      warnings.push(`${sourceId}: source changed after the glTF was exported`);
    }

    const target = pose.targetPosture ? POSTURE_TO_POSE[pose.targetPosture] : undefined;
    if (target && !poses[target]) {
      poses[target] = pose;
    } else if (pose.targetPosture) {
      unmapped.push(pose);
    }
  }

  return {
    revision: str(root['revision']),
    character: {
      id: str(character['id']),
      skeleton: str(character['skeleton']),
      bones: num(character['bones'], 0),
      strikeChain: Array.isArray(character['strike_chain'])
        ? character['strike_chain'].filter((b): b is string => typeof b === 'string')
        : []
    },
    poses,
    unmapped,
    footwear: readFootwear(root['footwear_presets']),
    warnings
  };
}

/**
 * Projects an authored import onto the loader's own manifest shape, so the
 * rest of the renderer needs to know only one format.
 */
export function toPoseModelManifest(imported: SelectionImport): PoseModelManifest {
  const poses: Partial<Record<PoseId, string>> = {};
  for (const [id, pose] of Object.entries(imported.poses)) {
    if (pose) poses[id as PoseId] = pose.asset;
  }
  return { version: 1, poses };
}

export { POSTURE_TO_POSE };
