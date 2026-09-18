import * as THREE from 'three';
import { POSES } from '../game/config';
import { createShoe } from './shoes';
import { createTargetOverlay, type TargetOverlay } from './targets';
import type { GameSnapshot, PoseId, ShoeId } from '../game/types';

const PLAYER_HEIGHT = 1.8;
const ATTACKER_HEIGHT = 1.73;
const DEPTH_TO_Z = 0.3;

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
  rightLeg: THREE.Mesh;
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

  for (const side of [-1, 1]) {
    const upperArm = capsule(0.047 * s, 0.22 * s, top);
    upperArm.rotation.z = side * 0.14;
    place(upperArm, side * 0.212 * s, 1.36 * s, 0);
    root.add(upperArm);

    const forearm = capsule(0.041 * s, 0.2 * s, palette.skin);
    upperArm.rotation.z = side * 0.14;
    place(forearm, side * 0.246 * s, 1.11 * s, 0.01 * s);
    root.add(forearm);
  }

  const legs: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const thigh = capsule(0.072 * s, 0.32 * s, bottom);
    place(thigh, side * 0.082 * s, 0.76 * s, 0);
    root.add(thigh);
    legs.push(thigh);

    const shin = capsule(0.055 * s, 0.34 * s, palette.skin);
    place(shin, side * 0.082 * s, 0.34 * s, 0);
    root.add(shin);
  }

  return { root, hips, rightLeg: legs[1] ?? legs[0]! };
}

export interface CharacterRig {
  root: THREE.Group;
  player: THREE.Group;
  attacker: THREE.Group;
  attackingFoot: THREE.Group;
  targetAnchor: THREE.Group;
  leftTarget: THREE.Group;
  rightTarget: THREE.Group;
  overlays: { left: TargetOverlay; right: TargetOverlay };
  attackerLeg: THREE.Mesh;
  poseId: PoseId;
  dispose(): void;
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

  if (poseId === 'kneeling-front') {
    // Kneeling drops the whole silhouette and shortens the usable reach.
    playerParts.root.position.y = -0.34;
    playerParts.root.scale.set(1, 0.9, 1);
    playerParts.root.rotation.x = 0.1;
  }
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

  const attackerLeg = capsule(0.056, 0.4, palette.skin);
  attackerLeg.name = 'attackerLeg';
  root.add(attackerLeg);

  const attackingFoot = new THREE.Group();
  attackingFoot.name = 'attackingFoot';
  attackingFoot.add(createShoe(shoeId));
  root.add(attackingFoot);

  // --- abstract gameplay overlay -----------------------------------------
  const targetAnchor = new THREE.Group();
  targetAnchor.name = 'targetAnchor';
  targetAnchor.position.set(0, pose.anchorHeight, 0);
  root.add(targetAnchor);

  const leftOverlay = createTargetOverlay();
  leftOverlay.group.name = 'leftTarget';
  const rightOverlay = createTargetOverlay();
  rightOverlay.group.name = 'rightTarget';
  targetAnchor.add(leftOverlay.group, rightOverlay.group);

  return {
    root,
    player,
    attacker,
    attackingFoot,
    targetAnchor,
    leftTarget: leftOverlay.group,
    rightTarget: rightOverlay.group,
    overlays: { left: leftOverlay, right: rightOverlay },
    attackerLeg,
    poseId,
    dispose(): void {
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
const MID = new THREE.Vector3();

/** Copies one immutable snapshot onto the rig. Pure presentation, no logic. */
export function applySnapshot(rig: CharacterRig, snapshot: GameSnapshot): void {
  const depth = snapshot.anchor.y * DEPTH_TO_Z;
  rig.player.position.set(snapshot.anchor.x, 0, depth);
  rig.targetAnchor.position.set(0, POSES[rig.poseId].anchorHeight, depth);

  rig.overlays.left.apply(snapshot.proxies[0]);
  rig.overlays.right.apply(snapshot.proxies[1]);

  rig.attackingFoot.position.set(snapshot.foot.x, snapshot.foot.y, snapshot.foot.z);
  rig.attackingFoot.lookAt(0, snapshot.foot.y, snapshot.foot.z - 1);

  // Bridge the attacker's hip to wherever the foot currently is.
  HIP.set(0.1, 0.86, 1.45);
  FOOT.set(snapshot.foot.x, snapshot.foot.y, snapshot.foot.z);
  MID.copy(HIP).add(FOOT).multiplyScalar(0.5);
  rig.attackerLeg.position.copy(MID);
  rig.attackerLeg.lookAt(FOOT);
  rig.attackerLeg.rotateX(Math.PI / 2);
  const length = HIP.distanceTo(FOOT);
  rig.attackerLeg.scale.set(1, Math.max(0.2, length / 0.512), 1);
}
