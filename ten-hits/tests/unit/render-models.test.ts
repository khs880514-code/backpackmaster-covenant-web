import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCharacters, applySnapshot } from '../../src/render/characters';
import { createShoe } from '../../src/render/shoes';
import { createTargetOverlay } from '../../src/render/targets';
import { createGameEngine } from '../../src/game/engine';
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
