import * as THREE from 'three';
import { parseSelectionManifest, type AttackTiming } from './selection-manifest';
import type { GamePhase, PoseId } from '../game/types';

/**
 * Authored attack clips: a rigged attacker plus the kick animation authored for
 * the posture the player is in. The engine keeps owning the pacing — power and
 * anger still decide how long a phase lasts — and the clip is resampled onto
 * whatever schedule the engine produces.
 */
export interface AttackClip {
  poseId: PoseId;
  sourceId: string;
  scene: THREE.Group;
  animation: THREE.AnimationClip | null;
  timing: AttackTiming;
}

export interface AttackClipLibrary {
  get(pose: PoseId): AttackClip | null;
  count(): number;
}

export interface GltfSceneSource {
  load(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>;
}

export interface LoadClipOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  source?: GltfSceneSource;
}

/** Placeholder geometry that stands in for the player; the game draws its own. */
const GUIDE_PREFIX = 'POSTURE_GUIDE';
const PELVIS_GUIDE = 'POSTURE_GUIDE_Pelvis';

const EMPTY: AttackClipLibrary = { get: () => null, count: () => 0 };

/**
 * Places the authored scene into the game's own arena.
 *
 * The authoring files put the attacker on -Z and the figure receiving the kick
 * on +Z; the game is laid out the other way round, with the player at the
 * origin and the attacker in front of the camera on +Z. So the scene is turned
 * halfway round and then slid until the authored target guide lands on the
 * origin. Everything else keeps its authored relationship to that point, which
 * is what makes the kick still land where the animator aimed it.
 */
export function alignToTargetGuide(scene: THREE.Group): boolean {
  const pelvis = scene.getObjectByName(PELVIS_GUIDE);
  if (!pelvis) return false;
  scene.rotation.y = Math.PI;
  scene.updateMatrixWorld(true);
  const world = new THREE.Vector3();
  pelvis.getWorldPosition(world);
  scene.position.x -= world.x;
  scene.position.z -= world.z;
  scene.updateMatrixWorld(true);
  return true;
}

/** Hides the authored stand-in figure; the game animates its own player. */
export function hidePostureGuides(scene: THREE.Group): number {
  let hidden = 0;
  scene.traverse((node) => {
    if (node.name.startsWith(GUIDE_PREFIX)) {
      node.visible = false;
      hidden += 1;
    }
  });
  return hidden;
}

function defaultSource(): GltfSceneSource {
  return {
    async load(url: string) {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(url);
      return { scene: gltf.scene, animations: gltf.animations };
    }
  };
}

export async function loadAttackClips(
  options: LoadClipOptions = {}
): Promise<AttackClipLibrary> {
  const baseUrl = options.baseUrl ?? 'models/';
  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return EMPTY;

  let imported: ReturnType<typeof parseSelectionManifest> = null;
  try {
    const response = await doFetch(`${baseUrl}selection-manifest.json`);
    if (!response.ok) return EMPTY;
    imported = parseSelectionManifest(await response.json());
  } catch {
    return EMPTY;
  }
  if (!imported) return EMPTY;

  const source = options.source ?? defaultSource();
  const clips = new Map<PoseId, AttackClip>();

  await Promise.all(
    Object.entries(imported.poses).map(async ([id, pose]) => {
      if (!pose) return;
      try {
        const { scene, animations } = await source.load(`${baseUrl}${pose.asset}`);
        alignToTargetGuide(scene);
        hidePostureGuides(scene);
        clips.set(id as PoseId, {
          poseId: id as PoseId,
          sourceId: pose.sourceId,
          scene,
          animation: animations[0] ?? null,
          timing: pose.timing
        });
      } catch {
        // A clip that will not load simply leaves that pose procedural.
      }
    })
  );

  return {
    get: (pose: PoseId) => clips.get(pose) ?? null,
    count: () => clips.size
  };
}

/**
 * Maps a game phase and its progress onto a time in the authored clip.
 *
 * The authored wind-up and contact frames are the anchors: whatever the engine
 * decides a telegraph should last, it still ends on the authored wind-up pose,
 * and the strike still lands exactly on the authored contact frame.
 */
export function clipTimeForPhase(
  timing: AttackTiming,
  phase: GamePhase,
  progress: number
): number {
  const t = Math.min(1, Math.max(0, progress));
  const { fps } = timing;
  const prep = (timing.preparationFrames[0] ?? 1) / fps;
  const contact = (timing.contactFrames[0] ?? prep) / fps;
  const start = 0;

  switch (phase) {
    case 'telegraph':
      return start + (prep - start) * t;
    case 'strike':
      return prep + (contact - prep) * t;
    case 'impact':
      return contact;
    case 'recovery':
      return contact + timing.recoverySeconds * t;
    default:
      return start;
  }
}
