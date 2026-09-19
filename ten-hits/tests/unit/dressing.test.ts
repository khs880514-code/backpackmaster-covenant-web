import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHOE_IDS } from '../../src/game/config';
import { SHOE_FILE } from '../../src/render/wearables';
import { BUILT_IN_SHOE, boneIndex, dress, rebind, undress } from '../../src/render/dressing';

const JOINTS = ['spine', 'thigh.R', 'shin.R', 'foot.R'];

/** A rig with the authored joint names, as every authored file carries them. */
function rig(names: string[] = JOINTS): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'attacker';
  let parent: THREE.Object3D = root;
  for (const name of names) {
    const bone = new THREE.Bone();
    bone.name = name;
    parent.add(bone);
    parent = bone;
  }
  return root;
}

function skinned(name: string, joints: string[] = JOINTS): THREE.SkinnedMesh {
  const bones = joints.map((n) => {
    const bone = new THREE.Bone();
    bone.name = n;
    return bone;
  });
  const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(
    Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4
  ));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = name;
  mesh.add(bones[0]!);
  mesh.bind(new THREE.Skeleton(bones));
  return mesh;
}

function wearable(name: string, joints?: string[]): THREE.Object3D {
  const group = new THREE.Group();
  group.add(skinned(name, joints));
  return group;
}

describe('dressing the attacker', () => {
  it('finds every bone on the rig by name', () => {
    const bones = boneIndex(rig());
    expect([...bones.keys()].sort()).toEqual([...JOINTS].sort());
  });

  it('rebinds a wearable onto the rig it is given', () => {
    const target = rig();
    const mesh = skinned('Wearable_P05_R_Plane.001');
    expect(rebind(mesh, boneIndex(target))).toBe(true);
    // Every bone the mesh now deforms with belongs to the rig, not its own file.
    for (const bone of mesh.skeleton.bones) {
      expect(boneIndex(target).get(bone.name)).toBe(bone);
    }
  });

  it('refuses a partial bind rather than tearing the garment', () => {
    const target = rig(['spine', 'thigh.R']);
    const mesh = skinned('Wearable_P05_R_Plane.001');
    const before = mesh.skeleton;
    expect(rebind(mesh, boneIndex(target))).toBe(false);
    expect(mesh.skeleton).toBe(before);
  });

  it('hides the shoes the clip was exported wearing', () => {
    const target = rig();
    const original = skinned('Elf_Fitted_P01_R_Heel.001');
    target.add(original);
    const worn = dress(target, wearable('Wearable_P05_R_Plane.001'), BUILT_IN_SHOE);

    expect(worn.added).toHaveLength(1);
    expect(original.visible).toBe(false);
    expect(worn.added[0]!.parent).toBe(target);
  });

  it('leaves everything else on the rig alone', () => {
    const target = rig();
    const body = skinned('DarkElf_Visual');
    target.add(body);
    dress(target, wearable('Wearable_P05_R_Plane.001'), BUILT_IN_SHOE);
    expect(body.visible).toBe(true);
  });

  it('takes the old shoe ankle pieces off with the shoe', () => {
    // They belong to the pair the clip was exported in and are bright red, so
    // leaving them put the old straps on top of whichever shoe was chosen.
    const target = rig();
    const ankle = skinned('Elf_P01_Ankle_R');
    target.add(ankle);
    dress(target, wearable('Wearable_P05_R_Plane.001'), BUILT_IN_SHOE);
    expect(ankle.visible).toBe(false);
  });

  it('puts the rig back exactly as it was', () => {
    const target = rig();
    const original = skinned('Elf_Fitted_P01_R_Heel.001');
    target.add(original);
    const children = target.children.length;

    const worn = dress(target, wearable('Wearable_P05_R_Plane.001'), BUILT_IN_SHOE);
    undress(worn);

    expect(original.visible).toBe(true);
    expect(target.children.length).toBe(children);
  });

  it('dresses a second rig from the same loaded wearable', () => {
    // The loader caches each file and wears it again on the next run. Moving
    // the original meshes emptied that cache, so the first run was dressed and
    // every one after it silently was not.
    const cached = wearable('Wearable_P05_R_Plane.001');

    const first = dress(rig(), cached, BUILT_IN_SHOE);
    expect(first.added).toHaveLength(1);

    const second = dress(rig(), cached, BUILT_IN_SHOE);
    expect(second.added).toHaveLength(1);
    expect(second.added[0]).not.toBe(first.added[0]);
  });

  it('leaves the loaded wearable untouched', () => {
    const cached = wearable('Wearable_P05_R_Plane.001');
    const original = cached.children[0]!;
    dress(rig(), cached, BUILT_IN_SHOE);
    expect(cached.children).toContain(original);
    expect(original.parent).toBe(cached);
  });

  it('shares geometry with the original rather than copying it', () => {
    const cached = wearable('Wearable_P05_R_Plane.001');
    const original = cached.children[0] as THREE.SkinnedMesh;
    const worn = dress(rig(), cached, BUILT_IN_SHOE);
    expect((worn.added[0] as THREE.SkinnedMesh).geometry).toBe(original.geometry);
  });

  it('adds nothing when the rig has no bones', () => {
    const bare = new THREE.Group();
    const worn = dress(bare, wearable('Wearable_P05_R_Plane.001'), BUILT_IN_SHOE);
    expect(worn.added).toHaveLength(0);
    expect(bare.children).toHaveLength(0);
  });

  it('adds nothing when no mesh can bind, and hides nothing either', () => {
    const target = rig();
    const original = skinned('Elf_Fitted_P01_R_Heel.001');
    target.add(original);
    const worn = dress(target, wearable('Wearable_X', ['missing.bone']), BUILT_IN_SHOE);
    expect(worn.added).toHaveLength(0);
    expect(original.visible).toBe(true);
  });
});

describe('the shipped footwear set', () => {
  it('names a file for every shoe the game lets you pick', () => {
    for (const id of SHOE_IDS) {
      expect(SHOE_FILE[id]).toBeTruthy();
      expect(existsSync(`public/models/assets/footwear/${SHOE_FILE[id]}`)).toBe(true);
    }
  });

  it('gives each shoe its own file', () => {
    const files = SHOE_IDS.map((id) => SHOE_FILE[id]);
    expect(new Set(files).size).toBe(files.length);
  });
});
