import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCharacters, applySnapshot } from '../../src/render/characters';
import { createShoe } from '../../src/render/shoes';
import { createTargetOverlay } from '../../src/render/targets';
import { createGameEngine } from '../../src/game/engine';
import { POSES, POSE_IDS } from '../../src/game/config';
import type { ShoeId } from '../../src/game/types';

function countGeometry(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

describe('createCharacters', () => {
  it('exposes the named rig nodes the engine drives', () => {
    const rig = createCharacters('standing-front', 'pump');
    expect(rig.player).toBeInstanceOf(THREE.Object3D);
    expect(rig.attacker).toBeInstanceOf(THREE.Object3D);
    expect(rig.attackingFoot).toBeInstanceOf(THREE.Object3D);
    expect(rig.leftTarget).toBeInstanceOf(THREE.Object3D);
    expect(rig.rightTarget).toBeInstanceOf(THREE.Object3D);
  });

  it('builds two figures with clothing meshes', () => {
    const rig = createCharacters('standing-front', 'pump');
    expect(countGeometry(rig.player)).toBeGreaterThan(5);
    expect(countGeometry(rig.attacker)).toBeGreaterThan(5);
  });

  it('lowers the player silhouette when kneeling', () => {
    const standing = createCharacters('standing-front', 'pump');
    const kneeling = createCharacters('kneeling-front', 'pump');
    const boxOf = (o: THREE.Object3D): number =>
      new THREE.Box3().setFromObject(o).max.y;
    expect(boxOf(kneeling.player)).toBeLessThan(boxOf(standing.player));
  });

  it('keeps the target overlay translucent and separate from the body', () => {
    const rig = createCharacters('standing-front', 'pump');
    const mesh = rig.leftTarget.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(1);
  });
});

describe('createShoe', () => {
  const kinds: ShoeId[] = ['pump', 'stiletto', 'platform'];

  it('produces a non-empty group for every shoe', () => {
    for (const kind of kinds) {
      const group = createShoe(kind);
      expect(countGeometry(group)).toBeGreaterThan(0);
    }
  });

  it('gives every shoe a distinct silhouette', () => {
    const sizes = kinds.map((kind) => {
      const box = new THREE.Box3().setFromObject(createShoe(kind));
      const size = new THREE.Vector3();
      box.getSize(size);
      return `${size.x.toFixed(3)}|${size.y.toFixed(3)}|${size.z.toFixed(3)}`;
    });
    expect(new Set(sizes).size).toBe(kinds.length);
  });

  it('makes the platform sole thicker than the pump sole', () => {
    const height = (kind: ShoeId): number => {
      const box = new THREE.Box3().setFromObject(createShoe(kind));
      return box.max.y - box.min.y;
    };
    expect(height('platform')).toBeGreaterThan(height('pump'));
  });
});

describe('applySnapshot', () => {
  it('moves the overlay targets and the foot to snapshot positions', () => {
    const rig = createCharacters('standing-front', 'pump');
    const engine = createGameEngine({
      pose: 'standing-front',
      shoe: 'pump',
      power: 5,
      seed: 5
    });
    engine.start();
    const snapshot = engine.update(0.5);
    applySnapshot(rig, snapshot);
    expect(rig.leftTarget.position.x).toBeCloseTo(snapshot.proxies[0].position.x, 5);
    expect(rig.attackingFoot.position.z).toBeCloseTo(snapshot.foot.z, 5);
  });

  it('squashes and recolors a damaged proxy without numeric labels', () => {
    const rig = createCharacters('standing-front', 'pump');
    const overlay = createTargetOverlay();
    overlay.apply({
      side: 'left',
      stage: 'critical',
      colorStage: 3,
      squash: 0.8,
      cracking: 0.6,
      position: { x: 0, y: 0 }
    });
    expect(overlay.group.scale.y).toBeLessThan(1);
    expect(overlay.group.scale.x).toBeGreaterThan(1);
    expect(rig.leftTarget.name).toBe('leftTarget');
  });
});

describe('pose variety and inspection', () => {
  it('gives every pose a distinct player silhouette height', () => {
    const heights = POSE_IDS.map((id) => {
      const rig = createCharacters(id, 'pump');
      return new THREE.Box3().setFromObject(rig.player).max.y.toFixed(3);
    });
    expect(new Set(heights).size).toBe(POSE_IDS.length);
  });

  it('places each pose overlay at that pose profile height', () => {
    for (const id of POSE_IDS) {
      const rig = createCharacters(id, 'pump');
      expect(rig.targetAnchor.position.y).toBeCloseTo(POSES[id].anchorHeight, 5);
    }
  });

  it('builds a seat prop only for the seated pose', () => {
    expect(createCharacters('seated-chair', 'pump').root.getObjectByName('seat')).toBeTruthy();
    expect(createCharacters('standing-front', 'pump').root.getObjectByName('seat')).toBeFalsy();
  });

  it('spreads the stance wider than the standing pose', () => {
    const width = (id: (typeof POSE_IDS)[number]): number => {
      const box = new THREE.Box3().setFromObject(createCharacters(id, 'pump').player);
      return box.max.x - box.min.x;
    };
    expect(width('spread-standing')).toBeGreaterThan(width('standing-front'));
  });

  it('hides the attacker and fades the body while inspecting', () => {
    const rig = createCharacters('standing-front', 'pump');
    const bodyMaterials = (): THREE.MeshStandardMaterial[] => {
      const found: THREE.MeshStandardMaterial[] = [];
      rig.player.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) found.push(mesh.material as THREE.MeshStandardMaterial);
      });
      return found;
    };

    expect(rig.attacker.visible).toBe(true);
    expect(bodyMaterials().every((m) => m.opacity === 1)).toBe(true);

    rig.setInspect(true);
    expect(rig.attacker.visible).toBe(false);
    expect(rig.attackingFoot.visible).toBe(false);
    expect(rig.attackerThigh.visible).toBe(false);
    expect(bodyMaterials().every((m) => m.transparent && m.opacity < 1)).toBe(true);
    // The abstract proxy must read louder, not quieter, while being reviewed.
    expect((rig.overlays.left.mesh.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(
      0.62
    );

    rig.setInspect(false);
    expect(rig.attacker.visible).toBe(true);
    expect(bodyMaterials().every((m) => m.opacity === 1)).toBe(true);
  });

  it('reports the inspection state', () => {
    const rig = createCharacters('standing-front', 'pump');
    expect(rig.inspecting()).toBe(false);
    rig.setInspect(true);
    expect(rig.inspecting()).toBe(true);
  });
});

describe('authored model swapping', () => {
  const authored = (): THREE.Group => {
    const group = new THREE.Group();
    group.name = 'authored-model';
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.8, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x884422 })
    );
    mesh.position.y = 0.9;
    group.add(mesh);
    return group;
  };

  it('hides the built-in figure once an authored model arrives', () => {
    const rig = createCharacters('standing-front', 'pump');
    expect(rig.usingAuthoredModel()).toBe(false);

    rig.applyPoseModel(authored());
    expect(rig.usingAuthoredModel()).toBe(true);
    expect(rig.proceduralPlayer.visible).toBe(false);
    expect(rig.player.getObjectByName('authored-model')).toBeTruthy();
  });

  it('restores the built-in figure when the model is cleared', () => {
    const rig = createCharacters('standing-front', 'pump');
    rig.applyPoseModel(authored());
    rig.applyPoseModel(null);
    expect(rig.usingAuthoredModel()).toBe(false);
    expect(rig.proceduralPlayer.visible).toBe(true);
    expect(rig.player.getObjectByName('authored-model')).toBeFalsy();
  });

  it('replaces a previous model instead of stacking them', () => {
    const rig = createCharacters('standing-front', 'pump');
    rig.applyPoseModel(authored());
    rig.applyPoseModel(authored());
    let count = 0;
    rig.player.traverse((node) => {
      if (node.name === 'authored-model') count += 1;
    });
    expect(count).toBe(1);
  });

  it('keeps the gameplay overlay above an authored model', () => {
    const rig = createCharacters('standing-front', 'pump');
    rig.applyPoseModel(authored());
    // The overlay lives on its own anchor, never inside the swapped figure.
    expect(rig.leftTarget.parent).toBe(rig.targetAnchor);
    expect(rig.player.getObjectByName('leftTarget')).toBeFalsy();
  });

  it('fades an authored model in review mode like the built-in figure', () => {
    const rig = createCharacters('standing-front', 'pump');
    const model = authored();
    rig.applyPoseModel(model);
    const material = (model.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(material.opacity).toBe(1);

    rig.setInspect(true);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(1);

    rig.setInspect(false);
    expect(material.opacity).toBe(1);
  });

  it('fades a model that arrives while review mode is already on', () => {
    const rig = createCharacters('standing-front', 'pump');
    rig.setInspect(true);
    const model = authored();
    rig.applyPoseModel(model);
    const material = (model.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(material.opacity).toBeLessThan(1);
  });
});
