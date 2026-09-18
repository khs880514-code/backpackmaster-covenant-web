import * as THREE from 'three';
import { POSE_IDS } from '../game/config';
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
  /** World-unit height every player model is normalized to. */
  playerHeight?: number;
  /** World-unit height the attacker model is normalized to. */
  attackerHeight?: number;
  poses?: Partial<Record<PoseId, string>>;
  attacker?: string;
}

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

function readEntries(manifest: PoseModelManifest): Array<[PoseId, string]> {
  const poses = manifest.poses ?? {};
  const entries: Array<[PoseId, string]> = [];
  for (const id of POSE_IDS) {
    const file = poses[id];
    // Reject anything that is not a plain relative file name.
    if (typeof file !== 'string' || file.length === 0 || file.includes('..')) continue;
    entries.push([id, file]);
  }
  return entries;
}

function defaultSource(): GltfSource {
  return {
    async load(url: string): Promise<THREE.Object3D> {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
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
  const playerHeight = manifest.playerHeight ?? DEFAULT_PLAYER_HEIGHT;
  const attackerHeight = manifest.attackerHeight ?? DEFAULT_ATTACKER_HEIGHT;

  const poses = new Map<PoseId, THREE.Group>();
  await Promise.all(
    readEntries(manifest).map(async ([id, file]) => {
      try {
        poses.set(id, fitModel(await source.load(`${baseUrl}${file}`), playerHeight));
      } catch {
        // One bad file must not cost the whole set.
      }
    })
  );

  let attacker: THREE.Group | null = null;
  if (typeof manifest.attacker === 'string' && !manifest.attacker.includes('..')) {
    try {
      attacker = fitModel(
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
