import * as THREE from 'three';
import type { ColorStage, ProxySnapshot } from '../game/types';

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
  const geometry = new THREE.SphereGeometry(0.085, 20, 16);
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
