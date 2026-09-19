import * as THREE from 'three';
import { createGltfLoader } from './gltf';
import { parseSelectionManifest, type AttackTiming } from './selection-manifest';
import { POSES } from '../game/config';
import { targetRestPoint } from '../game/engine';
import type { GamePhase, PoseId, Vec3 } from '../game/types';

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
  /**
   * Where the kick was aimed when the scene was aligned, and where the scene
   * had to sit for it to land there. Moving the scene by the difference
   * between a new aim and this one carries the contact with it.
   */
  alignment: StrikeAlignment | null;
}

export interface StrikeAlignment {
  /** The point the kick was stood over, in world metres. */
  aimedAt: Vec3;
  /** The scene position that stands her there. */
  base: THREE.Vector3;
  /** Which way the shoe is travelling as it arrives, as a unit vector. */
  travel: Vec3;
  /**
   * How far above the strike bone the shoe actually strikes, in metres. The
   * authored clips are consistent about this: 3.5cm, and 3.4cm below for the
   * one that stamps downward instead.
   */
  standoff: number;
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
export const STRIKE_BONE = 'foot.R';
/**
 * The rest of that chain, hip first. Turning these two is what aims the kick:
 * the hip points the leg at the target and the knee makes up the distance.
 */
export const STRIKE_CHAIN = ['thigh.R', 'shin.R'] as const;

/**
 * Compares names the way they survive the loader.
 *
 * three.js rewrites node and bone names when it builds a scene — it drops the
 * separators rather than replacing them — so the manifest's `foot.R` arrives
 * as `footR`, and `Plane.001` as `Plane001`. Comparing the stripped forms
 * matches either spelling without having to know which one a file used.
 */
export function sameName(a: string, b: string): boolean {
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

/** How many frames back the travel direction is measured over. */
const TRAVEL_FRAMES = 4;

/**
 * How much slack to leave once she has had to step in at all, in metres.
 *
 * Enough for the player to pull the pair away and still be followed: the aim
 * goes wherever the pair has swung to, so a stance with no slack in it can
 * reach the resting place and nothing else. Measured, stepping in a pose that
 * already reaches costs accuracy rather than buying it, so this only ever
 * applies to one that does not.
 */
const REACH_HEADROOM = 0.06;

/**
 * Stands the attacker at the right distance and records what her kick hits.
 *
 * The scene used to be slid until the strike bone sat on the world origin —
 * the floor under the player's midline. But the pair does not hang at the
 * origin, so every kick arrived short: measured across the delivered clips,
 * between 26cm away in the best pose and 66cm in the worst. That is why it did
 * not look like it was connecting. It was not.
 *
 * Only the ground plan is corrected here. Lifting her to meet a target at a
 * different height would take her feet off the floor — by 31cm in the worst
 * clip — so the height is left to the leg, which aims at the target frame by
 * frame and can also follow the player as they dodge.
 *
 * `contactHeight` is the authoring manifest's `target_height_m`: the height
 * the animator aimed this kick at. Against it the strike bone lands a
 * consistent 3.5cm low on every delivered clip, which is the offset from the
 * ankle to the part of the shoe that actually arrives.
 */
export function alignContactToTarget(
  scene: THREE.Group,
  animation: THREE.AnimationClip | null,
  timing: AttackTiming,
  target: Vec3,
  contactHeight: number | null
): StrikeAlignment | null {
  let foot: THREE.Object3D | null = null;
  let hipBone: THREE.Object3D | null = null;
  let kneeBone: THREE.Object3D | null = null;
  scene.traverse((node) => {
    if (!foot && sameName(node.name, STRIKE_BONE)) foot = node;
    if (!hipBone && sameName(node.name, STRIKE_CHAIN[0])) hipBone = node;
    if (!kneeBone && sameName(node.name, STRIKE_CHAIN[1])) kneeBone = node;
  });
  if (!foot || !animation) return null;
  const ankleBone = foot as THREE.Object3D;
  const clip = animation;

  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  action.paused = true;

  const fps = Math.max(1, timing.fps);
  const contact = Math.min(clip.duration, (timing.contactFrames[0] ?? 0) / fps);
  const ankle = new THREE.Vector3();
  const before = new THREE.Vector3();
  const travel = new THREE.Vector3();
  const hip = new THREE.Vector3();
  const knee = new THREE.Vector3();
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();

  /** Poses the rig on a frame and leaves every world matrix current. */
  function poseAt(seconds: number): void {
    action.time = Math.max(0, Math.min(clip.duration, seconds));
    mixer.update(0);
    scene.updateMatrixWorld(true);
  }

  /** Slides the scene so the contact lands over the target, at one facing. */
  function place(turn: number): number {
    scene.rotation.y = turn;
    scene.position.set(0, 0, 0);

    poseAt(contact - TRAVEL_FRAMES / fps);
    ankleBone.getWorldPosition(before);
    poseAt(contact);
    ankleBone.getWorldPosition(ankle);

    travel.subVectors(ankle, before);
    if (travel.lengthSq() < 1e-12) travel.set(0, 0, -1);
    travel.normalize();

    // Ground plan only: her feet stay on the floor they were authored on.
    scene.position.set(target.x - ankle.x, 0, target.z - ankle.z);
    scene.updateMatrixWorld(true);
    standIn();

    box.makeEmpty();
    scene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && node.visible) box.expandByObject(node);
    });
    return box.isEmpty() ? 0 : box.getCenter(centre).z;
  }

  /**
   * Brings her in until the target is inside the kicking leg's reach.
   *
   * Standing her so the strike bone passes over the target is right in plan
   * but says nothing about distance, and a clip authored against a target at
   * another height has to reach further to get down or up to this one.
   * Measured, the worst pose ended up 4.3cm beyond what the leg spans — so the
   * kick could not arrive however it was aimed, and stopped short every time.
   * A step closer costs nothing and keeps her feet on the floor.
   */
  function standIn(): void {
    if (!hipBone || !kneeBone) return;
    hipBone.getWorldPosition(hip);
    kneeBone.getWorldPosition(knee);
    ankleBone.getWorldPosition(ankle);
    const span = hip.distanceTo(knee) + knee.distanceTo(ankle);

    const rise = hip.y - target.y;
    const outX = hip.x - target.x;
    const outZ = hip.z - target.z;
    const ground = Math.hypot(outX, outZ);
    if (ground < 1e-6) return;
    // A stance that already reaches is left exactly as authored.
    if (Math.hypot(ground, rise) <= span) return;

    const reach = span - REACH_HEADROOM;
    const allowed = Math.sqrt(Math.max(0, reach * reach - rise * rise));
    const step = ground - allowed;
    if (step <= 0) return;

    scene.position.x -= (outX / ground) * step;
    scene.position.z -= (outZ / ground) * step;
    scene.updateMatrixWorld(true);
  }

  // Which way round the authored scene faces is not something every clip
  // agrees on, so it is decided rather than assumed: the game puts the
  // attacker in front of the player on +Z, and the contact sits over the
  // target either way, so the turn that leaves her body on +Z is the right one.
  const turned = place(Math.PI);
  if (turned < 0) place(0);

  const base = scene.position.clone();
  const heading: Vec3 = { x: travel.x, y: travel.y, z: travel.z };
  // Where the kick lands relative to the bone that carries it. Measured
  // against what the animator aimed at, so a clip that declares nothing
  // simply strikes with the bone itself.
  const standoff = contactHeight === null ? 0 : contactHeight - ankle.y;

  // Leave the clip parked at its start; the engine owns the clock from here.
  poseAt(0);
  action.stop();
  mixer.uncacheClip(clip);
  scene.updateMatrixWorld(true);

  return { aimedAt: { ...target }, base, travel: heading, standoff };
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
          // Where this pose's pair hangs is where the kick has to arrive.
          // Aligning by the authored target guide only lines her body up with
          // the stand-in figure; it says nothing about where the shoe ends up,
          // which is the thing the player is watching.
          const alignment = alignContactToTarget(
            scene,
            animation,
            pose.timing,
            targetRestPoint(POSES[id as PoseId]),
            pose.targetHeightM
          );
          // A clip with no animation has no contact to measure, so the
          // authored guide is the only thing left to line it up by.
          if (!alignment) alignToTargetGuide(scene);
          clips.set(id as PoseId, {
            poseId: id as PoseId,
            sourceId: pose.sourceId,
            scene,
            animation,
            timing: pose.timing,
            alignment
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
