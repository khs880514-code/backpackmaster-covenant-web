import * as THREE from 'three';
import { contactBands, TARGET_RADIUS } from '../game/engine';
import type { ColorStage, ProxySnapshot, ShoeId } from '../game/types';
import { SHOES } from '../game/config';

/**
 * The proxy is an abstract stand-in, but it should read as a dense, soft-firm
 * body rather than a boiled sweet. That means a desaturated palette, a matte
 * surface, almost no emission, and a form that is not a perfect maths sphere.
 *
 * Damage shows as the material dulling and bruising down through muted tones,
 * never as an injury: no reds that read as blood, no broken surface, no fluid.
 */
const STAGE_COLORS: Record<ColorStage, number> = {
  0: 0xc9b3a6,
  1: 0xbfa08c,
  2: 0xa87f72,
  3: 0x7d5a5c,
  4: 0x4e3f44
};

/**
 * Just enough self-lighting to stay readable against a dark arena. Far below
 * the old values, which made the proxy glow like a lamp.
 */
const STAGE_EMISSIVE: Record<ColorStage, number> = {
  0: 0x140f0d,
  1: 0x171009,
  2: 0x180d09,
  3: 0x15090b,
  4: 0x0a0708
};

/** Measured from the authoring model: a lobe is far taller than it is wide. */
const PROXY_HEIGHT_RATIO = 1.42;
const PROXY_DEPTH_RATIO = 0.97;

/** The core sits inside the shell and shows through it as the shell thins. */
const CORE_SCALE = 0.62;
const CORE_COLORS: Record<ColorStage, number> = {
  0: 0x8f7d74,
  1: 0x7c675f,
  2: 0x63504c,
  3: 0x46363a,
  4: 0x2a2226
};

/**
 * A smooth, seeded ripple so the surface is not mathematically perfect. Real
 * soft tissue and real rubber both carry low-frequency irregularity, and its
 * absence is most of what makes a sphere look moulded.
 */
function roughenSurface(geometry: THREE.BufferGeometry, amount: number): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const ripple =
      Math.sin(vertex.x * 47 + vertex.y * 31) * 0.6 +
      Math.sin(vertex.y * 59 - vertex.z * 43) * 0.4;
    const scale = 1 + ripple * amount;
    position.setXYZ(i, vertex.x * scale, vertex.y * scale, vertex.z * scale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

export interface TargetOverlay {
  group: THREE.Group;
  mesh: THREE.Mesh;
  /** The permanently crushed inner body, visible through the shell. */
  core: THREE.Mesh;
  apply(proxy: ProxySnapshot): void;
  /** Review mode makes the proxy read louder instead of fading with the body. */
  setInspect(enabled: boolean): void;
  dispose(): void;
}

const INSPECT_OPACITY = 0.97;
const BASE_OPACITY = 0.88;

export function createTargetOverlay(): TargetOverlay {
  const group = new THREE.Group();
  // The horizontal half-width is the radius the contact test measures, so the
  // axis a dodge moves along stays honest; the proxy is simply taller on the
  // axis nothing is judged against.
  const geometry = new THREE.SphereGeometry(TARGET_RADIUS, 32, 24);
  geometry.scale(1, PROXY_HEIGHT_RATIO, PROXY_DEPTH_RATIO);
  roughenSurface(geometry, 0.035);

  const material = new THREE.MeshStandardMaterial({
    color: STAGE_COLORS[0],
    emissive: STAGE_EMISSIVE[0],
    // Matte and dense, not moulded plastic.
    roughness: 0.78,
    metalness: 0,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    // The overlay is a gameplay readout, not part of the body, so it stays
    // legible through the figure instead of being occluded by it.
    depthTest: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 10;
  group.add(mesh);

  // The core carries only permanent damage: it crushes down over a run and
  // never recovers, so what is left at the end is what the run actually cost.
  const coreGeometry = new THREE.SphereGeometry(TARGET_RADIUS * CORE_SCALE, 20, 16);
  coreGeometry.scale(1, PROXY_HEIGHT_RATIO, PROXY_DEPTH_RATIO);
  roughenSurface(coreGeometry, 0.05);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: CORE_COLORS[0],
    roughness: 0.92,
    metalness: 0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.renderOrder = 11;
  group.add(core);

  let inspecting = false;

  return {
    group,
    mesh,
    core,
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
          ? 0.92
          : BASE_OPACITY - proxy.cracking * 0.06;
      // Abuse dulls the surface further, so a spent proxy stops catching light.
      material.roughness = 0.78 + Math.min(0.18, proxy.cracking * 0.18);
      // Rubber-ball deformation: flatten vertically, bulge sideways. The bulge
      // is derived from the flattening rather than picked separately, so the
      // proxy keeps its volume the way a closed surface under load would.
      const squash = Math.min(1, Math.max(0, proxy.squash));
      const flatten = 1 - squash * 0.35;
      const bulge = 1 / Math.sqrt(flatten);
      group.scale.set(bulge, flatten, bulge);
      if (proxy.stage === 'ruptured') {
        // Collapsed: it gives up its form and settles, without any tear
        // geometry, spill, or wound. It simply stops holding itself up.
        group.scale.set(bulge * 1.22, flatten * 0.34, bulge * 1.16);
      }
      // Permanent crushing: the core flattens and darkens, and only becomes
      // visible once there is something to see. It never springs back.
      const crushed = Math.min(1, Math.max(0, proxy.core));
      coreMaterial.color.setHex(CORE_COLORS[proxy.colorStage] ?? CORE_COLORS[0]);
      coreMaterial.opacity = inspecting ? Math.min(0.95, crushed * 1.4) : crushed * 0.9;
      const coreFlatten = 1 - crushed * 0.55;
      core.scale.set(1 / Math.sqrt(coreFlatten), coreFlatten, 1 / Math.sqrt(coreFlatten));

      group.position.set(proxy.position.x, proxy.position.y, 0);
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
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
