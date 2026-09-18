import * as THREE from 'three';
import { createGltfLoader } from './gltf';
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
/**
 * The studio floor and back wall some clips were staged against. They are
 * seven metres square, so leaving one in fills the screen.
 *
 * The suffix is matched loosely because three.js rewrites node names when it
 * builds the scene: `Plane.001` in the file arrives as `Plane001`, with the
 * separator dropped rather than replaced.
 */
const STUDIO_PROP = /^Plane[._]?\d*$/;
/** The bone the manifest names as the end of the strike chain. */
const STRIKE_BONE = 'foot.R';

/**
 * Compares names the way they survive the loader.
 *
 * three.js rewrites node and bone names when it builds a scene — it drops the
 * separators rather than replacing them — so the manifest's `foot.R` arrives
 * as `footR`, and `Plane.001` as `Plane001`. Comparing the stripped forms
 * matches either spelling without having to know which one a file used.
 */
function sameName(a: string, b: string): boolean {
  const strip = (value: string): string => value.replace(/[._\s-]/g, '').toLowerCase();
  return strip(a) === strip(b);
}

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

/**
 * Aligns a clip that carries no target guide, by where its kick actually lands.
 *
 * Not every authored clip was staged against a stand-in figure — the run-in
 * kick has a studio floor and wall instead — and with no guide to slide onto
 * the origin the scene was left exactly where it was authored, metres from the
 * player. So the contact frame is sampled and the striking foot read off the
 * rig at that instant: that is the point the animator aimed at the target, and
 * putting it on the origin lands the kick where the guide would have.
 */
export function alignToStrikeContact(
  scene: THREE.Group,
  animation: THREE.AnimationClip | null,
  timing: AttackTiming
): boolean {
  let foot: THREE.Object3D | null = null;
  scene.traverse((node) => {
    if (!foot && sameName(node.name, STRIKE_BONE)) foot = node;
  });
  if (!foot || !animation) return false;

  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(animation);
  action.play();
  action.paused = true;
  const contact = timing.contactFrames[0] ?? 0;
  action.time = Math.min(animation.duration, contact / Math.max(1, timing.fps));
  mixer.update(0);

  const world = new THREE.Vector3();
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();

  /** Slides the scene so the contact lands on the origin, at one facing. */
  function place(turn: number): number {
    scene.rotation.y = turn;
    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld(true);
    (foot as THREE.Object3D).getWorldPosition(world);
    scene.position.x -= world.x;
    scene.position.z -= world.z;
    scene.updateMatrixWorld(true);

    box.makeEmpty();
    scene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && node.visible) box.expandByObject(node);
    });
    return box.isEmpty() ? 0 : box.getCenter(centre).z;
  }

  // Which way round the authored scene faces is not something every clip
  // agrees on, so it is decided rather than assumed: the game puts the
  // attacker in front of the player on +Z, and the contact sits on the origin
  // either way, so the turn that leaves her body on +Z is the right one.
  const turned = place(Math.PI);
  if (turned < 0) place(0);

  // Leave the clip parked at its start; the engine owns the clock from here.
  action.time = 0;
  mixer.update(0);
  action.stop();
  mixer.uncacheClip(animation);
  scene.updateMatrixWorld(true);
  return true;
}

/**
 * Hides everything the authoring scene carries that the game draws itself: the
 * stand-in figure it was posed against, and the studio floor and wall some
 * clips were staged on.
 */
export function hidePostureGuides(scene: THREE.Group): number {
  let hidden = 0;
  scene.traverse((node) => {
    if (node.name.startsWith(GUIDE_PREFIX) || STUDIO_PROP.test(node.name)) {
      node.visible = false;
      hidden += 1;
    }
  });
  return hidden;
}

function defaultSource(): GltfSceneSource {
  return {
    async load(url: string) {
      const loader = await createGltfLoader();
      const gltf = await loader.loadAsync(url);
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
    Object.entries(imported.candidates).map(async ([id, list]) => {
      // Best take first. The authoring manifest describes twelve clips and
      // only some have been delivered, so a preferred one that is not there
      // must fall through to the next rather than cost the pose its clip.
      for (const pose of list ?? []) {
        try {
          const { scene, animations } = await source.load(`${baseUrl}${pose.asset}`);
          const animation = animations[0] ?? null;
          // Props first: the contact alignment measures where her body ended
          // up, and a seven-metre studio wall would dominate that.
          hidePostureGuides(scene);
          // A clip staged without a target guide is aligned by its own contact.
          if (!alignToTargetGuide(scene)) {
            alignToStrikeContact(scene, animation, pose.timing);
          }
          clips.set(id as PoseId, {
            poseId: id as PoseId,
            sourceId: pose.sourceId,
            scene,
            animation,
            timing: pose.timing
          });
          return;
        } catch {
          // Try the next take; only an exhausted list leaves a pose procedural.
        }
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
  progress: number,
  followThroughSeconds = 0
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
      // Freezing on the contact frame is what made a heavy kick look like a
      // tap: the authored clip already carries the follow-through, so let it
      // run on past the contact by an amount the power decides.
      return contact + Math.max(0, followThroughSeconds) * t;
    case 'recovery':
      return contact + followThroughSeconds + timing.recoverySeconds * t;
    default:
      return start;
  }
}
