import * as THREE from 'three';
import { POSES } from '../game/config';
import { clipTimeForPhase, type AttackClip } from './attack-clips';
import { createShoe } from './shoes';
import {
  createContactBands,
  createTargetOverlay,
  type ContactBandRings,
  type TargetOverlay
} from './targets';
import type { GameSnapshot, PoseId, ShoeId } from '../game/types';

interface PoseShape {
  /** Vertical drop applied to the whole figure. */
  drop: number;
  /** Vertical squash, so a crouch reads as compressed rather than shrunk. */
  squash: number;
  /** Forward or backward lean in radians. */
  lean: number;
  /** How far the legs and arms open out to the sides. */
  spread: number;
  seat: boolean;
}

const POSE_SHAPES: Record<PoseId, PoseShape> = {
  'standing-front': { drop: 0, squash: 1, lean: 0, spread: 1, seat: false },
  'kneeling-front': { drop: -0.34, squash: 0.9, lean: 0.1, spread: 0.92, seat: false },
  'seated-chair': { drop: -0.27, squash: 0.94, lean: 0.05, spread: 1.15, seat: true },
  'spread-standing': { drop: -0.07, squash: 0.97, lean: -0.04, spread: 1.8, seat: false },
  'crouch-front': { drop: -0.47, squash: 0.82, lean: 0.22, spread: 1.25, seat: false },
  'braced-back': { drop: -0.13, squash: 0.98, lean: -0.2, spread: 1.05, seat: false }
};

const INSPECT_BODY_OPACITY = 0.22;

const THIGH_LENGTH = 0.46;
const SHIN_LENGTH = 0.46;
const PLAYER_HEIGHT = 1.8;
const ATTACKER_HEIGHT = 1.73;
const DEPTH_TO_Z = 0.12;
/** Must match the engine's own pelvis range so art and physics agree. */
const PELVIS_RANGE = 0.45;

/** Shared materials keep the whole arena under a dozen draw-call groups. */
interface Palette {
  skin: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  playerTop: THREE.MeshStandardMaterial;
  playerBottom: THREE.MeshStandardMaterial;
  attackerTop: THREE.MeshStandardMaterial;
  attackerBottom: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
}

function createPalette(): Palette {
  const std = (color: number, roughness: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
  return {
    skin: std(0xdcb79a, 0.72),
    hair: std(0x241c22, 0.58),
    playerTop: std(0x3f5b8c, 0.78),
    playerBottom: std(0x2a3250, 0.8),
    attackerTop: std(0xb44a6a, 0.7),
    attackerBottom: std(0x2c2635, 0.74),
    ground: std(0x141a27, 0.95)
  };
}

function capsule(
  radius: number,
  length: number,
  material: THREE.Material
): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), material);
}

function place(mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh {
  mesh.position.set(x, y, z);
  return mesh;
}

interface FigureParts {
  root: THREE.Group;
  hips: THREE.Group;
  /** Thigh and shin of the right leg, hidden on the attacker while kicking. */
  rightLeg: THREE.Mesh[];
  /** Every limb that opens outward, paired with the side it belongs to. */
  limbs: Array<{ mesh: THREE.Mesh; side: number; baseX: number }>;
}

/**
 * Builds a stylized, clearly adult, fully clothed figure out of primitives.
 * No anatomical detail is modelled anywhere; gameplay reads from the abstract
 * overlay spheres instead.
 */
function buildFigure(
  height: number,
  palette: Palette,
  top: THREE.MeshStandardMaterial,
  bottom: THREE.MeshStandardMaterial
): FigureParts {
  const root = new THREE.Group();
  const s = height / 1.8;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105 * s, 16, 14), palette.skin);
  place(head, 0, 1.685 * s, 0);
  root.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118 * s, 16, 14), palette.hair);
  hair.scale.set(1, 0.95, 1.05);
  place(hair, 0, 1.712 * s, -0.012 * s);
  root.add(hair);

  const neck = capsule(0.036 * s, 0.05 * s, palette.skin);
  place(neck, 0, 1.585 * s, 0);
  root.add(neck);

  const chest = capsule(0.145 * s, 0.24 * s, top);
  chest.scale.set(1.08, 1, 0.72);
  place(chest, 0, 1.36 * s, 0);
  root.add(chest);

  const waist = capsule(0.12 * s, 0.14 * s, top);
  waist.scale.set(1.05, 1, 0.7);
  place(waist, 0, 1.13 * s, 0);
  root.add(waist);

  const hips = new THREE.Group();
  hips.position.set(0, 0.99 * s, 0);
  const hipMesh = capsule(0.135 * s, 0.1 * s, bottom);
  hipMesh.scale.set(1.06, 1, 0.78);
  hips.add(hipMesh);
  root.add(hips);

  const limbs: Array<{ mesh: THREE.Mesh; side: number; baseX: number }> = [];

  for (const side of [-1, 1]) {
    const upperArm = capsule(0.047 * s, 0.22 * s, top);
    upperArm.rotation.z = side * 0.14;
    place(upperArm, side * 0.212 * s, 1.36 * s, 0);
    root.add(upperArm);
    limbs.push({ mesh: upperArm, side, baseX: side * 0.212 * s });

    const forearm = capsule(0.041 * s, 0.2 * s, palette.skin);
    place(forearm, side * 0.246 * s, 1.11 * s, 0.01 * s);
    root.add(forearm);
    limbs.push({ mesh: forearm, side, baseX: side * 0.246 * s });
  }

  const rightLeg: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const thigh = capsule(0.072 * s, 0.32 * s, bottom);
    place(thigh, side * 0.082 * s, 0.76 * s, 0);
    root.add(thigh);
    limbs.push({ mesh: thigh, side, baseX: side * 0.082 * s });

    const shin = capsule(0.055 * s, 0.34 * s, palette.skin);
    place(shin, side * 0.082 * s, 0.34 * s, 0);
    root.add(shin);
    limbs.push({ mesh: shin, side, baseX: side * 0.082 * s });

    // A flat foot closes the gap between the shin capsule and the ground.
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.092 * s, 0.062 * s, 0.2 * s),
      bottom
    );
    place(foot, side * 0.082 * s, 0.031 * s, 0.03 * s);
    root.add(foot);
    limbs.push({ mesh: foot, side, baseX: side * 0.082 * s });

    if (side === 1) rightLeg.push(thigh, shin, foot);
  }

  return { root, hips, rightLeg, limbs };
}

/** A three-sided seat: two uprights and a back panel, no soft furnishing. */
function buildSeat(material: THREE.Material): THREE.Group {
  const seat = new THREE.Group();
  seat.name = 'seat';

  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.4), material);
  pad.position.set(0, 0.42, -0.02);
  seat.add(pad);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.06), material);
  back.position.set(0, 0.68, -0.2);
  seat.add(back);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.4), material);
    arm.position.set(side * 0.2, 0.25, -0.02);
    seat.add(arm);
  }

  return seat;
}

export interface CharacterRig {
  root: THREE.Group;
  player: THREE.Group;
  /** The built-in capsule figure, hidden while an authored model is in use. */
  proceduralPlayer: THREE.Group;
  attacker: THREE.Group;
  attackingFoot: THREE.Group;
  targetAnchor: THREE.Group;
  leftTarget: THREE.Group;
  rightTarget: THREE.Group;
  overlays: { left: TargetOverlay; right: TargetOverlay };
  bands: ContactBandRings;
  attackerThigh: THREE.Mesh;
  attackerShin: THREE.Mesh;
  poseId: PoseId;
  /** Swaps in an authored glTF figure, or `null` to go back to the built-in one. */
  applyPoseModel(model: THREE.Group | null): void;
  usingAuthoredModel(): boolean;
  /** Swaps the procedural attacker for an authored rig and its kick clip. */
  applyAttackClip(clip: AttackClip | null): void;
  usingAuthoredAttacker(): boolean;
  /** Positions the authored clip at the point in the attack the engine is at. */
  scrubAttackClip(phase: GameSnapshot['phase'], progress: number): void;
  /** Review mode: hide the attacker and see the abstract proxy through the body. */
  setInspect(enabled: boolean): void;
  inspecting(): boolean;
  dispose(): void;
}

interface MaterialBaseline {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

/** Collects every distinct standard material under a subtree. */
function collectMaterials(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const found = new Set<THREE.MeshStandardMaterial>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material) found.add(material as THREE.MeshStandardMaterial);
    }
  });
  return [...found];
}

export function createCharacters(poseId: PoseId, shoeId: ShoeId): CharacterRig {
  const pose = POSES[poseId];
  const palette = createPalette();
  const root = new THREE.Group();

  const ground = new THREE.Mesh(new THREE.CircleGeometry(3.2, 36), palette.ground);
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  // --- player -------------------------------------------------------------
  const playerParts = buildFigure(
    PLAYER_HEIGHT,
    palette,
    palette.playerTop,
    palette.playerBottom
  );
  const player = new THREE.Group();
  player.name = 'player';
  player.add(playerParts.root);

  const shape = POSE_SHAPES[poseId];
  playerParts.root.position.y = shape.drop;
  playerParts.root.scale.set(1, shape.squash, 1);
  playerParts.root.rotation.x = shape.lean;
  for (const limb of playerParts.limbs) {
    limb.mesh.position.x = limb.baseX * shape.spread;
    limb.mesh.rotation.z = limb.side * (shape.spread - 1) * 0.22;
  }
  if (shape.seat) player.add(buildSeat(palette.attackerBottom));
  root.add(player);

  // --- attacker -----------------------------------------------------------
  const attackerParts = buildFigure(
    ATTACKER_HEIGHT,
    palette,
    palette.attackerTop,
    palette.attackerBottom
  );
  const attacker = new THREE.Group();
  attacker.name = 'attacker';
  attacker.add(attackerParts.root);
  attacker.position.set(0, 0, 1.55);
  attacker.rotation.y = Math.PI;
  root.add(attacker);

  // The kicking leg is driven by inverse kinematics, so the attacker's own
  // right leg meshes step aside to avoid a duplicate limb.
  for (const part of attackerParts.rightLeg) part.visible = false;

  const attackerThigh = capsule(0.066, THIGH_LENGTH - 0.132, palette.attackerBottom);
  attackerThigh.name = 'attackerThigh';
  const attackerShin = capsule(0.05, SHIN_LENGTH - 0.1, palette.skin);
  attackerShin.name = 'attackerShin';
  root.add(attackerThigh, attackerShin);

  const attackingFoot = new THREE.Group();
  attackingFoot.name = 'attackingFoot';
  attackingFoot.add(createShoe(shoeId));
  root.add(attackingFoot);

  // --- abstract gameplay overlay -----------------------------------------
  const targetAnchor = new THREE.Group();
  targetAnchor.name = 'targetAnchor';
  targetAnchor.position.set(0, pose.anchorHeight, 0);
  root.add(targetAnchor);

  const bands = createContactBands(shoeId);
  targetAnchor.add(bands.group);

  const leftOverlay = createTargetOverlay();
  leftOverlay.group.name = 'leftTarget';
  const rightOverlay = createTargetOverlay();
  rightOverlay.group.name = 'rightTarget';
  targetAnchor.add(leftOverlay.group, rightOverlay.group);

  // Remember how each material looked before review mode touched it, so an
  // authored file's own transparency is restored rather than overwritten.
  const baselines = new Map<THREE.MeshStandardMaterial, MaterialBaseline>();
  let inspect = false;
  let authoredModel: THREE.Group | null = null;
  let attackClip: AttackClip | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let action: THREE.AnimationAction | null = null;

  function fadeBody(enabled: boolean): void {
    for (const material of collectMaterials(player)) {
      if (!baselines.has(material)) {
        baselines.set(material, {
          opacity: material.opacity,
          transparent: material.transparent,
          depthWrite: material.depthWrite
        });
      }
      const base = baselines.get(material)!;
      material.transparent = enabled ? true : base.transparent;
      material.opacity = enabled
        ? Math.min(base.opacity, INSPECT_BODY_OPACITY)
        : base.opacity;
      material.depthWrite = enabled ? false : base.depthWrite;
      material.needsUpdate = true;
    }
  }

  /** The procedural attacker stands down whenever an authored rig is present. */
  function syncAttackerVisibility(): void {
    const procedural = attackClip === null && !inspect;
    attacker.visible = procedural;
    attackingFoot.visible = procedural;
    attackerThigh.visible = procedural;
    attackerShin.visible = procedural;
    if (attackClip) attackClip.scene.visible = !inspect;
  }

  function applyAttackClip(clip: AttackClip | null): void {
    if (attackClip) {
      root.remove(attackClip.scene);
      mixer?.stopAllAction();
      mixer = null;
      action = null;
    }
    attackClip = clip;
    if (clip) {
      root.add(clip.scene);
      if (clip.animation) {
        mixer = new THREE.AnimationMixer(clip.scene);
        action = mixer.clipAction(clip.animation);
        action.play();
        // The engine drives the clock, so the action is only ever scrubbed.
        action.paused = true;
      }
    }
    syncAttackerVisibility();
  }

  function setInspect(enabled: boolean): void {
    inspect = enabled;
    syncAttackerVisibility();
    fadeBody(enabled);
    leftOverlay.setInspect(enabled);
    rightOverlay.setInspect(enabled);
  }

  function applyPoseModel(model: THREE.Group | null): void {
    if (authoredModel) {
      player.remove(authoredModel);
      authoredModel = null;
    }
    if (model) {
      model.name = 'authored-model';
      player.add(model);
      authoredModel = model;
    }
    playerParts.root.visible = model === null;
    // A newly attached subtree has to pick up the current review state.
    if (inspect) fadeBody(true);
  }

  return {
    root,
    player,
    proceduralPlayer: playerParts.root,
    attacker,
    attackingFoot,
    targetAnchor,
    leftTarget: leftOverlay.group,
    rightTarget: rightOverlay.group,
    overlays: { left: leftOverlay, right: rightOverlay },
    bands,
    attackerThigh,
    attackerShin,
    poseId,
    applyPoseModel,
    usingAuthoredModel: () => authoredModel !== null,
    applyAttackClip,
    usingAuthoredAttacker: () => attackClip !== null,
    scrubAttackClip(phase, progress): void {
      if (!attackClip || !mixer || !action) return;
      // The engine owns the clock, so the action is positioned directly and
      // then evaluated with a zero delta. `mixer.setTime` would rewind the
      // action to zero first, which on a paused action leaves it stuck there.
      action.time = clipTimeForPhase(attackClip.timing, phase, progress);
      mixer.update(0);
    },
    setInspect,
    inspecting: () => inspect,
    dispose(): void {
      bands.dispose();
      leftOverlay.dispose();
      rightOverlay.dispose();
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
    }
  };
}

const HIP = new THREE.Vector3();
const FOOT = new THREE.Vector3();
const KNEE = new THREE.Vector3();
const AXIS = new THREE.Vector3();
const BEND = new THREE.Vector3();
const MID = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const FALLBACK_BEND = new THREE.Vector3(0, 0, -1);

/** Places one capsule between two points, scaling it along its own axis. */
function orientSegment(
  mesh: THREE.Mesh,
  from: THREE.Vector3,
  to: THREE.Vector3,
  baseLength: number
): void {
  MID.copy(from).add(to).multiplyScalar(0.5);
  mesh.position.copy(MID);
  mesh.lookAt(to);
  mesh.rotateX(Math.PI / 2);
  mesh.scale.set(1, Math.max(0.15, from.distanceTo(to) / baseLength), 1);
}

/**
 * Two-bone inverse kinematics for the kicking leg. The knee always bends away
 * from the straight hip-to-foot line so an extended kick never looks like a
 * single stretched pole.
 */
function solveKnee(hip: THREE.Vector3, foot: THREE.Vector3): THREE.Vector3 {
  AXIS.copy(foot).sub(hip);
  const reach = Math.min(
    THIGH_LENGTH + SHIN_LENGTH - 0.02,
    Math.max(0.08, AXIS.length())
  );
  AXIS.normalize();

  BEND.copy(DOWN).addScaledVector(AXIS, -DOWN.dot(AXIS));
  if (BEND.lengthSq() < 1e-6) BEND.copy(FALLBACK_BEND);
  BEND.normalize();

  const along =
    (reach * reach + THIGH_LENGTH * THIGH_LENGTH - SHIN_LENGTH * SHIN_LENGTH) /
    (2 * reach);
  const offset = Math.sqrt(Math.max(0, THIGH_LENGTH * THIGH_LENGTH - along * along));

  return KNEE.copy(hip).addScaledVector(AXIS, along).addScaledVector(BEND, offset);
}

/** Copies one immutable snapshot onto the rig. Pure presentation, no logic. */
export function applySnapshot(rig: CharacterRig, snapshot: GameSnapshot): void {
  const depth = snapshot.anchor.y * DEPTH_TO_Z;
  rig.player.position.set(snapshot.anchor.x * PELVIS_RANGE, 0, depth);
  rig.targetAnchor.position.set(0, POSES[rig.poseId].anchorHeight, depth);

  rig.overlays.left.apply(snapshot.proxies[0]);
  rig.overlays.right.apply(snapshot.proxies[1]);

  // The bands only matter while a strike is inbound, so they fade in with it.
  const incoming =
    snapshot.phase === 'telegraph' || snapshot.phase === 'strike' || snapshot.phase === 'impact';
  rig.bands.setStrength(incoming ? 1 : rig.inspecting() ? 0.8 : 0);

  if (rig.usingAuthoredAttacker()) {
    rig.scrubAttackClip(snapshot.phase, snapshot.phaseProgress);
    return;
  }

  rig.attackingFoot.position.set(snapshot.foot.x, snapshot.foot.y, snapshot.foot.z);
  rig.attackingFoot.lookAt(0, snapshot.foot.y, snapshot.foot.z - 1);

  HIP.set(0.09, 0.88, 1.5);
  FOOT.set(snapshot.foot.x, snapshot.foot.y, snapshot.foot.z);
  const knee = solveKnee(HIP, FOOT).clone();
  orientSegment(rig.attackerThigh, HIP, knee, THIGH_LENGTH);
  orientSegment(rig.attackerShin, knee, FOOT, SHIN_LENGTH);
}
