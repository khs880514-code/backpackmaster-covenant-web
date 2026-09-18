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

/**
 * Procedural stand-ins, sized from the same measurements that drive the
 * contact profiles in `config.ts`, so the shape the player sees matches the
 * shape the strike is judged against even before the authored shoe loads.
 */
const SPECS: Record<ShoeId, ShoeSpec> = {
  pump: {
    toeWidth: 0.065,
    toeLength: 0.246,
    soleThickness: 0.014,
    heelHeight: 0.126,
    heelRadius: 0.011,
    color: 0x8f1526
  },
  stiletto: {
    toeWidth: 0.06,
    toeLength: 0.228,
    soleThickness: 0.009,
    heelHeight: 0.118,
    heelRadius: 0.005,
    color: 0x6d1230
  },
  plateau: {
    toeWidth: 0.066,
    toeLength: 0.245,
    soleThickness: 0.049,
    heelHeight: 0.131,
    heelRadius: 0.012,
    color: 0xd8d4cc
  },
  strap: {
    toeWidth: 0.082,
    toeLength: 0.244,
    soleThickness: 0.016,
    heelHeight: 0.131,
    heelRadius: 0.009,
    color: 0x2b2028
  },
  platform: {
    toeWidth: 0.078,
    toeLength: 0.314,
    soleThickness: 0.052,
    heelHeight: 0.126,
    heelRadius: 0.026,
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
