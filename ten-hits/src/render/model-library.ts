import * as THREE from 'three';
import { POSE_IDS } from '../game/config';
import { createGltfLoader } from './gltf';
import type { PoseId } from '../game/types';

/**
 * Maps the game's pose ids onto authored glTF files.
 *
 * Everything here is optional: a missing manifest, an unreadable entry, or a
 * failed download leaves the library empty and the game keeps running on its
 * procedural figures. Art is an upgrade, never a dependency.
 */
export interface PoseModelManifest {
  version: number;
  /**
   * False when the files are already authored at true scale with their feet on
   * the ground, in which case re-fitting them would only introduce error.
   */
  normalize?: boolean;
  /** World-unit height every player model is normalized to. */
  playerHeight?: number;
  /** World-unit height the attacker model is normalized to. */
  attackerHeight?: number;
  poses?: Partial<Record<PoseId, PoseModelEntry>>;
  attacker?: string;
}

/**
 * A file name, or a file name plus the correction it needs. `turn` is degrees
 * about Y: an authored figure that was posed facing away from the attacker is
 * turned here rather than re-exported.
 */
export type PoseModelEntry = string | { file: string; turn?: number };

export interface PoseModelLibrary {
  pose(id: PoseId): THREE.Group | null;
  attacker(): THREE.Group | null;
  /** How many files actually loaded, for reporting and tests. */
  count(): number;
}

export interface GltfSource {
  load(url: string): Promise<THREE.Object3D>;
}

export interface LoadOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  source?: GltfSource;
}

export const MANIFEST_FILE = 'manifest.json';
export const DEFAULT_PLAYER_HEIGHT = 1.8;
export const DEFAULT_ATTACKER_HEIGHT = 1.73;

const EMPTY: PoseModelLibrary = {
  pose: () => null,
  attacker: () => null,
  count: () => 0
};

/**
 * Normalizes an authored model: uniform-scaled to a known height, centered on
 * the x/z origin, and resting on the ground plane. Authored files disagree
 * about units and pivots, so the game fixes that once instead of everywhere.
 */
export function fitModel(object: THREE.Object3D, targetHeight: number): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = 'authored-model';

  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);

  if (size.y > 1e-6 && Number.isFinite(size.y)) {
    const scale = targetHeight / size.y;
    object.scale.multiplyScalar(scale);
    box.setFromObject(object);
  }

  const center = new THREE.Vector3();
  box.getCenter(center);
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;

  wrapper.add(object);
  return wrapper;
}

function isManifest(value: unknown): value is PoseModelManifest {
  return typeof value === 'object' && value !== null && 'version' in value;
}

export interface ResolvedEntry {
  id: PoseId;
  file: string;
  /** Radians about Y, already converted from the manifest's degrees. */
  turn: number;
}

export function readEntries(manifest: PoseModelManifest): ResolvedEntry[] {
  const poses = manifest.poses ?? {};
  const entries: ResolvedEntry[] = [];
  for (const id of POSE_IDS) {
    const entry = poses[id];
    const file = typeof entry === 'string' ? entry : entry?.file;
    // Reject anything that is not a plain relative file name.
    if (typeof file !== 'string' || file.length === 0 || file.includes('..')) continue;
    const degrees =
      typeof entry === 'object' && typeof entry.turn === 'number' && Number.isFinite(entry.turn)
        ? entry.turn
        : 0;
    entries.push({ id, file, turn: (degrees * Math.PI) / 180 });
  }
  return entries;
}

function defaultSource(): GltfSource {
  return {
    async load(url: string): Promise<THREE.Object3D> {
      const loader = await createGltfLoader();
      const gltf = await loader.loadAsync(url);
      return gltf.scene;
    }
  };
}

/**
 * Reads `<baseUrl>/manifest.json` and loads every glTF it names. Resolves to an
 * empty library rather than rejecting, so a caller never has to guard it.
 */
export async function loadPoseModels(options: LoadOptions = {}): Promise<PoseModelLibrary> {
  const baseUrl = options.baseUrl ?? 'models/';
  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return EMPTY;

  // Only this loader's own format. The authoring pipeline's selection manifest
  // describes attacker clips, not player figures, and belongs to
  // `loadAttackClips` — loading it here once put a second attacker on the field.
  let manifest: PoseModelManifest;
  try {
    const response = await doFetch(`${baseUrl}${MANIFEST_FILE}`);
    if (!response.ok) return EMPTY;
    const parsed: unknown = await response.json();
    if (!isManifest(parsed)) return EMPTY;
    manifest = parsed;
  } catch {
    return EMPTY;
  }

  const source = options.source ?? defaultSource();
  const normalize = manifest.normalize !== false;
  const playerHeight = manifest.playerHeight ?? DEFAULT_PLAYER_HEIGHT;
  const attackerHeight = manifest.attackerHeight ?? DEFAULT_ATTACKER_HEIGHT;

  /** Wraps a loaded model, fitting it only when the manifest asks for it. */
  function present(object: THREE.Object3D, targetHeight: number, turn = 0): THREE.Group {
    const wrapper = normalize ? fitModel(object, targetHeight) : new THREE.Group();
    if (!normalize) {
      wrapper.name = 'authored-model';
      wrapper.add(object);
    }
    wrapper.rotation.y = turn;
    return wrapper;
  }

  const poses = new Map<PoseId, THREE.Group>();
  await Promise.all(
    readEntries(manifest).map(async ({ id, file, turn }) => {
      try {
        poses.set(id, present(await source.load(`${baseUrl}${file}`), playerHeight, turn));
      } catch {
        // One bad file must not cost the whole set.
      }
    })
  );

  let attacker: THREE.Group | null = null;
  if (typeof manifest.attacker === 'string' && !manifest.attacker.includes('..')) {
    try {
      attacker = present(
        await source.load(`${baseUrl}${manifest.attacker}`),
        attackerHeight
      );
    } catch {
      attacker = null;
    }
  }

  return {
    pose: (id: PoseId) => poses.get(id) ?? null,
    attacker: () => attacker,
    count: () => poses.size + (attacker ? 1 : 0)
  };
}

export const EMPTY_LIBRARY = EMPTY;
