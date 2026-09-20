import * as THREE from 'three';
import { PELVIS_RANGE as ENGINE_PELVIS_RANGE } from '../game/engine';
import {
  BUILT_IN_BODY,
  BUILT_IN_SHOE,
  dress,
  undress,
  NOTHING,
  type Dressed
} from './dressing';
import { POSES } from '../game/config';
import { proxyForwardFor, proxyTiltFor, tetherForwardFor } from '../game/engine';
import {
  STAND_BONE,
  STAND_CHAIN,
  STRIKE_BONE,
  STRIKE_CHAIN,
  clipTimeForPhase,
  sameName,
  type AttackClip
} from './attack-clips';
import { createShoe } from './shoes';
import {
  createContactBands,
  createTargetOverlay,
  createTargetShell,
  type ContactBandRings,
  type TargetOverlay,
  type TargetShell
} from './targets';
import type { GameSnapshot, PoseId, ShoeId, Vec3 } from '../game/types';

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
  'braced-back': { drop: -0.13, squash: 0.98, lean: -0.2, spread: 1.05, seat: false },
  // Only a fallback shape; both of these have an authored body of their own.
  'all-fours': { drop: -0.52, squash: 0.74, lean: 0.62, spread: 1.18, seat: false },
  'kneel-folded': { drop: -0.56, squash: 0.8, lean: 0.5, spread: 1.05, seat: false }
};

const INSPECT_BODY_OPACITY = 0.22;

const THIGH_LENGTH = 0.46;
const SHIN_LENGTH = 0.46;
const PLAYER_HEIGHT = 1.8;
const ATTACKER_HEIGHT = 1.73;
const DEPTH_TO_Z = 0.12;
/** Must match the engine's own pelvis range so art and physics agree. */
// The engine owns this: the figure has to stand where the contact test says
// it does, or the dodge you see is not the dodge being judged.
const PELVIS_RANGE = ENGINE_PELVIS_RANGE;

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
  shell: TargetShell;
  attackerThigh: THREE.Mesh;
  attackerShin: THREE.Mesh;
  poseId: PoseId;
  /** Swaps in an authored glTF figure, or `null` to go back to the built-in one. */
  applyPoseModel(model: THREE.Group | null): void;
  usingAuthoredModel(): boolean;
  /** Swaps the procedural attacker for an authored rig and its kick clip. */
  applyAttackClip(clip: AttackClip | null): void;
  /**
   * Puts an authored pair of shoes on the attacker, replacing the ones her
   * clip was exported wearing. Passing null puts those back.
   */
  applyFootwear(footwear: THREE.Object3D | null): void;
  /**
   * Swaps the attacker's whole dressed figure. Her clip bakes body and dress
   * into one mesh, so an outfit replaces it rather than layering over it.
   */
  applyOutfit(outfit: THREE.Object3D | null): void;
  usingAuthoredAttacker(): boolean;
  /**
   * Swings the kicking leg so this attack's contact lands on `aim`.
   * `reach` eases the correction in and out, 0 to 1. Call it after scrubbing:
   * it reads the pose the clip was just put into.
   */
  aimAttackClip(aim: Vec3, reach: number): void;
  /** Positions the authored clip at the point in the attack the engine is at. */
  scrubAttackClip(
    phase: GameSnapshot['phase'],
    progress: number,
    followThroughSeconds?: number
  ): void;
  /** Review mode: hide the attacker and see the abstract proxy through the body. */
  setInspect(enabled: boolean): void;
  inspecting(): boolean;
  dispose(): void;
}

interface MaterialBaseline {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  alphaTest: number;
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

  const shell = createTargetShell();
  targetAnchor.add(shell.group);

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
  let wornShoes: Dressed = NOTHING;
  let wornOutfit: Dressed = NOTHING;
  let mixer: THREE.AnimationMixer | null = null;
  let action: THREE.AnimationAction | null = null;
  /** The kicking leg, and the one she is standing on while it works. */
  let kickLeg: Leg | null = null;
  let standLeg: Leg | null = null;

  /** Where a leg's end lands: its ankle, lifted by however far off the bone
   * the part that touches sits. */
  function endOf(ankle: THREE.Object3D, standoff: number): void {
    ankle.getWorldPosition(FOOT_WORLD);
    CONTACT.copy(FOOT_WORLD).setY(FOOT_WORLD.y + standoff);
  }

  /**
   * One round of the aim: the knee sets how far the leg spans, then the hip
   * points it. In that order, because each does a job the other cannot.
   *
   * Turning both toward the target instead — the obvious thing, and what this
   * did at first — cannot close a gap that lies along the leg: every rotation
   * that would shorten the reach is the one the solver reads as already
   * correct. Measured, it sat 9.3cm short of the prone pose's target and
   * stayed there however many rounds it was given.
   *
   * A round is repeated because the shoe strikes a little off the bone that
   * carries it, and that offset is a height rather than something fixed to the
   * bone, so it moves as the leg turns. A second round takes up what the first
   * left; a third is worth under a millimetre.
   */
  function solve(
    leg: Leg,
    standoff: number,
    travel: Vec3,
    blend: number
  ): void {
    const { hip: hipBone, knee: kneeBone, ankle } = leg;
    hipBone.getWorldPosition(HIP_WORLD);
    kneeBone.getWorldPosition(KNEE_WORLD);
    endOf(ankle, standoff);

    const upper = HIP_WORLD.distanceTo(KNEE_WORLD);
    const lower = KNEE_WORLD.distanceTo(CONTACT);
    if (upper < 1e-4 || lower < 1e-4) return;

    // How far the leg has to span, kept inside what it can fold and reach.
    const span = Math.min(
      upper + lower - JOINT_GUARD,
      Math.max(Math.abs(upper - lower) + JOINT_GUARD, HIP_WORLD.distanceTo(TARGET))
    );
    const folded = kneeAngle(upper, lower, span);
    const nowFolded = kneeAngle(upper, lower, HIP_WORLD.distanceTo(CONTACT));

    FROM.subVectors(HIP_WORLD, KNEE_WORLD);
    TO.subVectors(CONTACT, KNEE_WORLD);
    BEND_AXIS.crossVectors(FROM, TO);
    if (BEND_AXIS.lengthSq() < 1e-10) {
      // A leg at full stretch has no bend plane of its own, so the one the
      // kick is travelling in stands in for it.
      BEND_AXIS.crossVectors(TO, ARRIVAL.set(travel.x, travel.y, travel.z));
      if (BEND_AXIS.lengthSq() < 1e-10) return;
    }
    SWING.setFromAxisAngle(BEND_AXIS.normalize(), (folded - nowFolded) * blend);
    turnBone(kneeBone, SWING);

    // Now the leg is the right length, point it.
    hipBone.getWorldPosition(HIP_WORLD);
    endOf(ankle, standoff);
    FROM.subVectors(CONTACT, HIP_WORLD);
    TO.subVectors(TARGET, HIP_WORLD);
    if (FROM.lengthSq() < 1e-8 || TO.lengthSq() < 1e-8) return;
    SWING.setFromUnitVectors(FROM.normalize(), TO.normalize());
    if (blend < 1) SWING.slerp(IDENTITY, 1 - blend);
    turnBone(hipBone, SWING);
  }


  function fadeBody(enabled: boolean): void {
    for (const material of collectMaterials(player)) {
      if (!baselines.has(material)) {
        baselines.set(material, {
          opacity: material.opacity,
          transparent: material.transparent,
          depthWrite: material.depthWrite,
          alphaTest: material.alphaTest
        });
      }
      const base = baselines.get(material)!;
      material.transparent = enabled ? true : base.transparent;
      material.opacity = enabled
        ? Math.min(base.opacity, INSPECT_BODY_OPACITY)
        : base.opacity;
      material.depthWrite = enabled ? false : base.depthWrite;
      // An authored body uses alpha masking; fading it below the mask's
      // threshold would discard every fragment and the figure would vanish
      // outright instead of turning see-through.
      material.alphaTest = enabled ? 0 : base.alphaTest;
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

  function applyFootwear(footwear: THREE.Object3D | null): void {
    undress(wornShoes);
    wornShoes = NOTHING;
    if (!footwear || !attackClip) return;
    // The clip ships wearing FOOTWEAR_01; the chosen pair takes its place on
    // the same skeleton, so it deforms with the kick like the original did.
    wornShoes = dress(attackClip.scene, footwear, BUILT_IN_SHOE);
  }

  function applyOutfit(outfit: THREE.Object3D | null): void {
    undress(wornOutfit);
    wornOutfit = NOTHING;
    if (!outfit || !attackClip) return;
    wornOutfit = dress(attackClip.scene, outfit, BUILT_IN_BODY);
  }

  function applyAttackClip(clip: AttackClip | null): void {
    undress(wornShoes);
    undress(wornOutfit);
    wornShoes = NOTHING;
    wornOutfit = NOTHING;
    if (attackClip) {
      root.remove(attackClip.scene);
      mixer?.stopAllAction();
      mixer = null;
      action = null;
    }
    attackClip = clip;
    kickLeg = null;
    standLeg = null;
    if (clip) {
      const found = new Map<string, THREE.Object3D>();
      const wanted = [...STRIKE_CHAIN, STRIKE_BONE, ...STAND_CHAIN, STAND_BONE];
      clip.scene.traverse((node) => {
        for (const name of wanted) {
          if (!found.has(name) && sameName(node.name, name)) found.set(name, node);
        }
      });
      const legOf = (chain: readonly string[], end: string): Leg | null => {
        const hip = found.get(chain[0]!);
        const knee = found.get(chain[1]!);
        const ankle = found.get(end);
        return hip && knee && ankle ? { hip, knee, ankle } : null;
      };
      kickLeg = legOf(STRIKE_CHAIN, STRIKE_BONE);
      standLeg = legOf(STAND_CHAIN, STAND_BONE);
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
    shell.setInspect(enabled);
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
    shell,
    attackerThigh,
    attackerShin,
    poseId,
    applyPoseModel,
    usingAuthoredModel: () => authoredModel !== null,
    applyAttackClip,
    applyFootwear,
    applyOutfit,
    usingAuthoredAttacker: () => attackClip !== null,
    scrubAttackClip(phase, progress, followThroughSeconds = 0): void {
      if (!attackClip || !mixer || !action) return;
      // The engine owns the clock, so the action is positioned directly and
      // then evaluated with a zero delta. `mixer.setTime` would rewind the
      // action to zero first, which on a paused action leaves it stuck there.
      action.time = clipTimeForPhase(
        attackClip.timing,
        phase,
        progress,
        followThroughSeconds
      );
      mixer.update(0);
    },
    aimAttackClip(aim, reach): void {
      const clip = attackClip;
      if (!clip?.alignment || !kickLeg) return;
      const blend = Math.min(1, Math.max(0, reach));
      clip.scene.position.y = clip.alignment.base.y - clip.alignment.sink * blend;
      if (blend <= 0) return;

      // She comes down onto a target the clip was aimed above, rather than
      // reaching down to it with the kicking leg.
      //
      // A clip authored against a target 8cm higher than this pose's had the
      // kicking knee held 33 degrees off what the animator drew, for the whole
      // strike — a visibly different kick. Dropping her hips that 8cm and
      // letting the standing knee take it is what a person does to kick lower,
      // and it leaves the kick itself alone.
      if (standLeg && clip.alignment.sink > 0) {
        clip.scene.updateMatrixWorld(true);
        standLeg.ankle.getWorldPosition(PLANTED);
        PLANTED.y += clip.alignment.sink * blend;
        TARGET.copy(PLANTED);
        for (let pass = 0; pass < AIM_PASSES; pass += 1) {
          solve(standLeg, 0, clip.alignment.travel, 1);
        }
      }

      // The leg is moved by how far this attack differs from where the clip
      // already lands, not onto the target outright.
      //
      // The clip is stood so its contact falls on the pair's resting place, so
      // the only thing left to correct is the player having moved it — a few
      // centimetres, a few degrees of leg. Solving for the absolute point
      // instead dragged the foot onto the contact from the first frame of the
      // strike, while the authored leg was still cocked behind her: measured,
      // 61 degrees at the hip, 57 at the knee, and 29-degree jumps between
      // frames. That is the awkward leg.
      OFFSET.set(
        aim.x - clip.alignment.landsAt.x,
        aim.y - clip.alignment.landsAt.y,
        aim.z - clip.alignment.landsAt.z
      );

      // Bend the kicking leg until the part of the shoe that arrives is on
      // what this attack is aimed at.
      //
      // The alternative was to slide her whole body onto the target, which is
      // what the alignment used to do, and it takes her feet off the floor by
      // up to 31cm whenever the clip was authored against a target at another
      // height. A leg that bends a few degrees costs nothing, keeps her
      // standing on the ground, and follows the player as they dodge — which
      // a body placed at wind-up cannot.
      //
      clip.scene.updateMatrixWorld(true);
      endOf(kickLeg.ankle, clip.alignment.standoff);
      TARGET.copy(CONTACT).addScaledVector(OFFSET, blend);
      for (let pass = 0; pass < AIM_PASSES; pass += 1) {
        solve(kickLeg, clip.alignment.standoff, clip.alignment.travel, 1);
      }
    },

    setInspect,
    inspecting: () => inspect,
    dispose(): void {
      shell.dispose();
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
const HIP_WORLD = new THREE.Vector3();
const FOOT_WORLD = new THREE.Vector3();
const CONTACT = new THREE.Vector3();
const FROM = new THREE.Vector3();
const TO = new THREE.Vector3();
const SWING = new THREE.Quaternion();
const BONE_WORLD = new THREE.Quaternion();
const PARENT = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();
const SPARE = new THREE.Quaternion();
const TARGET = new THREE.Vector3();
const KNEE_WORLD = new THREE.Vector3();
const BEND_AXIS = new THREE.Vector3();
const ARRIVAL = new THREE.Vector3();
const OFFSET = new THREE.Vector3();
const PLANTED = new THREE.Vector3();

/**
 * How far short of locked straight, and of folded shut, the knee is held.
 * Either end is a place where the leg has no bend plane to solve in.
 */
const JOINT_GUARD = 0.004;

/** One leg's chain: the two joints that aim it and the end that lands. */
interface Leg {
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  ankle: THREE.Object3D;
}

/** How many rounds the aim takes. See the note on `solve`. */
const AIM_PASSES = 2;

/** The angle at the knee that makes the leg span `reach`, hip to contact. */
function kneeAngle(upper: number, lower: number, reach: number): number {
  const cosine = (upper * upper + lower * lower - reach * reach) / (2 * upper * lower);
  return Math.acos(Math.min(1, Math.max(-1, cosine)));
}

/**
 * Applies a world-space turn to one bone. A bone carries its parent's motion,
 * so the turn has to come back into the parent's frame before it can be
 * written, or every joint above this one gets counted twice.
 */
function turnBone(bone: THREE.Object3D, turn: THREE.Quaternion): void {
  bone.getWorldQuaternion(BONE_WORLD);
  PARENT.copy(BONE_WORLD).multiply(SPARE.copy(bone.quaternion).invert()).invert();
  bone.quaternion.copy(PARENT).multiply(turn).multiply(BONE_WORLD);
  bone.updateMatrixWorld(true);
}
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

/**
 * How much of the dodge the leg is following.
 *
 * Taken up over the wind-up, held through the strike and the impact so the
 * shoe stays on what it is hitting, and given back as she recovers.
 */
function aimReach(snapshot: GameSnapshot): number {
  switch (snapshot.phase) {
    // Eased in across the strike rather than held at full strength through
    // it. The same offset needs a bigger turn of the leg the straighter the
    // leg is, so carrying all of it from the first frame makes the wind-up
    // wrench rather than the contact adjust. All of it by the contact, which
    // is the only frame that has to be exact.
    case 'strike':
      return snapshot.phaseProgress * snapshot.phaseProgress;
    case 'impact':
      return 1;
    case 'recovery':
      return 1 - snapshot.phaseProgress;
    default:
      return 0;
  }
}



/** Copies one immutable snapshot onto the rig. Pure presentation, no logic. */
export function applySnapshot(rig: CharacterRig, snapshot: GameSnapshot): void {
  const depth = snapshot.anchor.y * DEPTH_TO_Z;
  rig.player.position.set(snapshot.anchor.x * PELVIS_RANGE, 0, depth);
  // The same offset the contact test uses. These were two separate constants,
  // so moving the pair for a pose moved what the shoe was judged against
  // without moving what the player could see, or the other way round.
  rig.targetAnchor.position.set(
    0,
    POSES[rig.poseId].anchorHeight,
    depth + proxyForwardFor(POSES[rig.poseId])
  );

  rig.overlays.left.apply(snapshot.proxies[0]);
  rig.overlays.right.apply(snapshot.proxies[1]);
  // Laid over with the figure, so the contact test and the picture agree.
  const tilt = proxyTiltFor(POSES[rig.poseId]);
  rig.targetAnchor.rotation.x = tilt;
  // The root sits in world space, so it has to come back into the pair's own
  // frame once that frame is tilted — otherwise the cords leave along the
  // wrong axis the moment the pair lies down.
  const gap = tetherForwardFor(POSES[rig.poseId]) - proxyForwardFor(POSES[rig.poseId]);
  rig.shell.setRootOffset(gap * Math.sin(tilt), gap * Math.cos(tilt));
  rig.shell.apply(snapshot.proxies[0], snapshot.proxies[1]);

  // The bands only matter while a strike is inbound, so they fade in with it.
  const incoming =
    snapshot.phase === 'telegraph' || snapshot.phase === 'strike' || snapshot.phase === 'impact';
  rig.bands.setStrength(incoming ? 1 : rig.inspecting() ? 0.8 : 0);

  if (rig.usingAuthoredAttacker()) {
    // Seconds of authored motion past the contact frame, scaled by power the
    // same way the procedural strike's depth is.
    rig.scrubAttackClip(
      snapshot.phase,
      snapshot.phaseProgress,
      0.05 + snapshot.power * 0.019
    );
    // Then aim what that pose produced at what this attack is going for, so
    // the shoe the player watches and the shoe the contact test measures are
    // the same shoe. The leg takes the correction up over the wind-up and
    // gives it back as she recovers.
    if (snapshot.aim) rig.aimAttackClip(snapshot.aim, aimReach(snapshot));
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
