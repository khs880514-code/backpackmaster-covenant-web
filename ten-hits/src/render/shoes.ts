import * as THREE from 'three';
import type { ShoeId } from '../game/types';

interface ShoeSpec {
  toeWidth: number;
  toeLength: number;
  soleThickness: number;
  heelHeight: number;
  heelRadius: number;
  color: number;
}

const SPECS: Record<ShoeId, ShoeSpec> = {
  pump: {
    toeWidth: 0.086,
    toeLength: 0.25,
    soleThickness: 0.014,
    heelHeight: 0.072,
    heelRadius: 0.013,
    color: 0x1b1f2b
  },
  stiletto: {
    toeWidth: 0.068,
    toeLength: 0.275,
    soleThickness: 0.009,
    heelHeight: 0.108,
    heelRadius: 0.005,
    color: 0x6d1230
  },
  platform: {
    toeWidth: 0.108,
    toeLength: 0.262,
    soleThickness: 0.038,
    heelHeight: 0.094,
    heelRadius: 0.024,
    color: 0x24303f
  }
};

/**
 * Builds a stylized shoe around the ankle origin. Shape is the whole gameplay
 * signal here: width changes how forgiving a contact is, heel geometry changes
 * how concentrated it feels.
 */
export function createShoe(kind: ShoeId): THREE.Group {
  const spec = SPECS[kind];
  const group = new THREE.Group();
  group.name = `shoe-${kind}`;

  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.38,
    metalness: 0.12
  });

  const sole = new THREE.Mesh(
    new THREE.BoxGeometry(spec.toeWidth, spec.soleThickness, spec.toeLength),
    material
  );
  sole.position.set(0, spec.soleThickness / 2, -0.02);
  group.add(sole);

  const upper = new THREE.Mesh(
    new THREE.SphereGeometry(spec.toeWidth * 0.62, 12, 10),
    material
  );
  upper.scale.set(1, 0.78, spec.toeLength / (spec.toeWidth * 1.1));
  upper.position.set(0, spec.soleThickness + spec.toeWidth * 0.3, -0.03);
  group.add(upper);

  const heel = new THREE.Mesh(
    new THREE.CylinderGeometry(
      spec.heelRadius,
      spec.heelRadius * 0.72,
      spec.heelHeight,
      10
    ),
    material
  );
  heel.position.set(0, -spec.heelHeight / 2 + spec.soleThickness, spec.toeLength * 0.36);
  group.add(heel);

  const ankleStrap = new THREE.Mesh(
    new THREE.TorusGeometry(spec.toeWidth * 0.52, 0.006, 6, 14),
    material
  );
  ankleStrap.rotation.x = Math.PI / 2;
  ankleStrap.position.set(0, spec.soleThickness + spec.toeWidth * 0.75, spec.toeLength * 0.26);
  group.add(ankleStrap);

  return group;
}

export function shoeContactOffset(kind: ShoeId): number {
  return SPECS[kind].toeLength * 0.5;
}
