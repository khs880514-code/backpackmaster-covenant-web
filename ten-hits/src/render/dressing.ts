import * as THREE from 'three';

/**
 * Puts authored wearables onto the attacker's animated rig.
 *
 * Every authored file — the kick clips, the five footwear sets, the five
 * wardrobe sets — was exported from the same character, so they all carry the
 * identical 27-joint skeleton with the same joint names. That is what makes
 * this possible: a garment's skin can be rebound, joint for joint by name, onto
 * whichever clip is currently playing, and it then deforms with her.
 *
 * Nothing here is a dependency. A wearable that will not bind is skipped and
 * the clip plays exactly as it did before.
 */

/** The shoes the kick clips were exported already wearing. */
export const BUILT_IN_SHOE = /^Elf_Fitted_P01_/;

/**
 * The attacker's own body as her kick clip carries it.
 *
 * It is a single mesh with one material covering skin and dress together, so
 * the dress cannot be taken off it. A wardrobe export is a whole dressed
 * figure — its own upper body, the garments, the skin showing between them —
 * so an outfit replaces this rather than layering over it.
 */
export const BUILT_IN_BODY = /^DarkElf_Visual/;

export interface Dressed {
  /** What was added, so it can be taken off again. */
  added: THREE.Object3D[];
  /** What was hidden to make room, with its previous visibility. */
  hidden: Array<{ node: THREE.Object3D; visible: boolean }>;
}

export const NOTHING: Dressed = { added: [], hidden: [] };

/** Indexes every bone under a rig by name. */
export function boneIndex(root: THREE.Object3D): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((node) => {
    const bone = node as THREE.Bone;
    if (bone.isBone && !bones.has(bone.name)) bones.set(bone.name, bone);
  });
  return bones;
}

/**
 * Rebinds one skinned mesh onto `bones`, keeping its authored bind pose.
 *
 * Returns false when the rig is missing a joint the mesh needs, in which case
 * the mesh is left alone — a partial bind would tear the garment apart.
 */
export function rebind(mesh: THREE.SkinnedMesh, bones: Map<string, THREE.Bone>): boolean {
  const source = mesh.skeleton;
  if (!source) return false;

  const mapped: THREE.Bone[] = [];
  for (const joint of source.bones) {
    const match = bones.get(joint.name);
    if (!match) return false;
    mapped.push(match);
  }

  mesh.bind(new THREE.Skeleton(mapped, source.boneInverses), mesh.bindMatrix.clone());
  return true;
}

/**
 * Binds every skinned mesh of `wearable` onto `rig` and parents them there.
 *
 * `hide` names the meshes already on the rig that this wearable replaces — the
 * clip's built-in shoes when a different pair is chosen, her authored dress
 * when another outfit is. They are hidden rather than removed so the same rig
 * can be redressed for the next run.
 *
 * The wearable itself is never touched: each mesh is cloned before it is bound,
 * because the loaded file is cached and worn again on the next run. Moving the
 * originals emptied that cache, so the first run was dressed and every one
 * after it silently was not.
 */
export function dress(
  rig: THREE.Object3D,
  wearable: THREE.Object3D,
  hide?: RegExp
): Dressed {
  const bones = boneIndex(rig);
  if (bones.size === 0) return NOTHING;

  const meshes: THREE.SkinnedMesh[] = [];
  wearable.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
  });

  const added: THREE.Object3D[] = [];
  for (const mesh of meshes) {
    // Geometry and material are shared with the original by reference; only
    // the skeleton binding is this copy's own.
    const copy = mesh.clone() as THREE.SkinnedMesh;
    if (!rebind(copy, bones)) continue;
    // Parented at the rig root, not under a bone: the skin already carries the
    // deformation, so an extra parent transform would apply it twice.
    rig.add(copy);
    added.push(copy);
  }
  if (added.length === 0) return NOTHING;

  const hidden: Array<{ node: THREE.Object3D; visible: boolean }> = [];
  if (hide) {
    rig.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return;
      if (added.includes(node)) return;
      if (!hide.test(node.name)) return;
      hidden.push({ node, visible: node.visible });
      node.visible = false;
    });
  }

  return { added, hidden };
}

/** Puts the rig back exactly as it was before `dress`. */
export function undress(worn: Dressed): void {
  for (const node of worn.added) node.removeFromParent();
  for (const { node, visible } of worn.hidden) node.visible = visible;
}
