import * as THREE from 'three';
import { contactBands } from '../game/engine';
import type { ColorStage, ProxySnapshot, ShoeId } from '../game/types';
import { SHOES } from '../game/config';

/**
 * Five accessible presets. The proxy is a rubber-ball stand-in, so damage reads
 * as discoloration, squashing, and surface cracking rather than injury.
 */
const STAGE_COLORS: Record<ColorStage, number> = {
  0: 0x9ad7ff,
  1: 0xffd98a,
  2: 0xff9f6b,
  3: 0xd4575f,
  4: 0x6a5060
};

const STAGE_EMISSIVE: Record<ColorStage, number> = {
  0: 0x11304a,
  1: 0x3a2a08,
  2: 0x3d1d0a,
  3: 0x3a0f14,
  4: 0x120a0d
};

export interface TargetOverlay {
  group: THREE.Group;
  mesh: THREE.Mesh;
  apply(proxy: ProxySnapshot): void;
  /** Review mode makes the proxy read louder instead of fading with the body. */
  setInspect(enabled: boolean): void;
  dispose(): void;
}

const INSPECT_OPACITY = 0.95;

export function createTargetOverlay(): TargetOverlay {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(0.028, 20, 16);
  const material = new THREE.MeshStandardMaterial({
    color: STAGE_COLORS[0],
    emissive: STAGE_EMISSIVE[0],
    roughness: 0.34,
    metalness: 0.04,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    // The overlay is a gameplay readout, not part of the body, so it stays
    // legible through the figure instead of being occluded by it.
    depthTest: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 10;
  group.add(mesh);

  let inspecting = false;

  return {
    group,
    mesh,
    setInspect(enabled: boolean): void {
      inspecting = enabled;
      if (enabled) material.opacity = INSPECT_OPACITY;
    },
    apply(proxy: ProxySnapshot): void {
      material.color.setHex(STAGE_COLORS[proxy.colorStage] ?? STAGE_COLORS[0]);
      material.emissive.setHex(STAGE_EMISSIVE[proxy.colorStage] ?? STAGE_EMISSIVE[0]);
      material.opacity = inspecting
        ? INSPECT_OPACITY
        : proxy.stage === 'ruptured'
          ? 0.42
          : 0.62 - proxy.cracking * 0.12;
      // Rubber-ball deformation: flatten vertically, bulge sideways.
      const squash = Math.min(1, Math.max(0, proxy.squash));
      group.scale.set(
        1 + squash * 0.22,
        1 - squash * 0.35,
        1 + squash * 0.18
      );
      if (proxy.stage === 'ruptured') group.scale.multiplyScalar(0.86);
      group.position.set(proxy.position.x, proxy.position.y, 0);
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    }
  };
}

export { STAGE_COLORS };


export interface ContactBandRings {
  group: THREE.Group;
  /** 0 hides the rings; 1 shows them at full strength. */
  setStrength(strength: number): void;
  dispose(): void;
}

/**
 * Two flat rings centred on the target pair: the inner one is where a contact
 * becomes a direct compression, the outer one is the edge of a graze. They
 * make the judgement readable without inflating what the shoe actually hits.
 */
export function createContactBands(shoeId: ShoeId): ContactBandRings {
  const bands = contactBands(SHOES[shoeId]);
  const group = new THREE.Group();
  group.name = 'contactBands';

  const make = (inner: number, outer: number, color: number, opacity: number) => {
    const geometry = new THREE.RingGeometry(inner, outer, 48);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 9;
    group.add(mesh);
    return { geometry, material, base: opacity };
  };

  const parts = [
    make(bands.compression * 0.74, bands.compression, 0xff6b6b, 0.95),
    make(bands.graze * 0.9, bands.graze, 0x9ad7ff, 0.7)
  ];

  return {
    group,
    setStrength(strength: number): void {
      const clamped = Math.min(1, Math.max(0, strength));
      for (const part of parts) part.material.opacity = part.base * clamped;
      group.visible = clamped > 0.01;
    },
    dispose(): void {
      for (const part of parts) {
        part.geometry.dispose();
        part.material.dispose();
      }
    }
  };
}
