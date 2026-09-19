import * as THREE from 'three';
import { contactBands, TARGET_RADIUS } from '../game/engine';
import { attachment } from '../game/pendulum';
import type { ColorStage, ProxyImprint, ProxySnapshot, ShoeId } from '../game/types';
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
/**
 * Taper toward the top, where the cord takes the weight.
 *
 * A sphere scaled on one axis is still a ball, which is what made these read
 * as toys. An ovoid narrows toward the attachment and carries its volume low,
 * and the two are not the same size — the reference pair never is.
 */
const PROXY_TAPER = 0.34;
/** How much smaller the left one is, and how much lower it sits. */
const PROXY_ASYMMETRY = 0.07;

/** The core sits inside the shell and shows through it as the shell thins. */
const CORE_SCALE = 0.62;
/**
 * How far into the proxy the striking surface presses, per unit of depth.
 *
 * Over 1 because the depths that actually occur are not: a direct compression
 * reports about 0.45, and at the old 0.62 that was a 7mm dimple on a 28mm
 * radius — which read as nothing, and left the colour change doing all the
 * work. Clamped below so the surface can crater deeply without passing through
 * the middle and turning itself inside out.
 */
const IMPRINT_DEPTH = 1.55;
/** The deepest the pit may go, as a fraction of the radius. */
const IMPRINT_LIMIT = 0.92;
/**
 * How far the inner body is driven away from the shoe, as a fraction of the
 * dent. It is not pressed in place: the contact shoves it to the far wall.
 */
const CORE_SHIFT = 0.7;

/**
 * How quickly the collapse follows the dent. Over one, because a side that has
 * gone is past holding its shape before the shoe has finished pressing.
 */
const COLLAPSE_GAIN = 1.8;

const FADE_FROM = new THREE.Color();
const FADE_TO = new THREE.Color();
/**
 * How much deeper the narrowest shoe drives than the broadest: the narrowest
 * gets this multiplier and the broadest its reciprocal-ish counterpart, so the
 * middle of the range is left as authored.
 */
const IMPRINT_SPREAD_GAIN = 1.4;
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

/**
 * Narrows a proxy toward its top so it reads as an ovoid rather than a ball.
 *
 * The taper is applied to the resting shape once, before any imprint, so the
 * dent still presses into the form rather than fighting it.
 */
export function taperProxy(geometry: THREE.BufferGeometry, radiusY: number): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  for (let i = 0; i < array.length; i += 3) {
    // 0 at the bottom, 1 at the top.
    const t = Math.min(1, Math.max(0, (array[i + 1]! / radiusY + 1) / 2));
    const squeeze = 1 - PROXY_TAPER * t * t;
    array[i] = array[i]! * squeeze;
    array[i + 2] = array[i + 2]! * squeeze;
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Presses the shape of the striking surface into a proxy mesh.
 *
 * The dent is a cosine-falloff displacement along the direction the shoe came
 * from. Its sharpness is what carries the footwear: a stiletto's narrow cap
 * concentrates into a deep local pit, a platform sole spreads the same depth
 * across most of the facing hemisphere. Without this the only thing separating
 * one shoe from another on screen was a slightly different shade.
 *
 * What is pressed in has to go somewhere. The far side swells to take it, by
 * as much as the pit displaces — so a narrow cap drives deep and barely
 * disturbs the rest, while a broad sole pushes the whole body out sideways.
 * That is what makes it read as contents being shoved aside rather than
 * material quietly disappearing.
 */
export function pressImprint(
  geometry: THREE.BufferGeometry,
  rest: Float32Array,
  imprint: ProxyImprint | null,
  radius: number
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const array = position.array as Float32Array;

  if (!imprint || imprint.depth <= 1e-4) {
    if (array !== rest) array.set(rest);
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    return;
  }

  const length = Math.hypot(imprint.x, imprint.y, imprint.z) || 1;
  const dx = imprint.x / length;
  const dy = imprint.y / length;
  const dz = imprint.z / length;

  const width = Math.min(1, Math.max(0, imprint.width));
  // A narrow cap concentrates the dent; a broad sole spreads it.
  const sharpness = 1.4 + (1 - width) * 9;
  // And it goes in further for it: the same force through a smaller contact
  // patch penetrates more. Without this the stiletto and the platform left
  // dents of the same depth and only differed in how far the edges fell away,
  // which on a body this small was not a difference anyone could see.
  const concentration = IMPRINT_SPREAD_GAIN - (IMPRINT_SPREAD_GAIN - 1) * 2 * width;
  const reach =
    radius *
    Math.min(
      IMPRINT_LIMIT,
      IMPRINT_DEPTH * concentration * Math.min(1, Math.max(0, imprint.depth))
    );

  // What the pit takes out has to reappear, and it cannot reappear along the
  // same axis — pushing the far side the same way would just slide the whole
  // body across. It swells outward instead, everywhere the shoe is not.
  //
  // The pit's share of the surface integrates to 1/(2(sharpness+1)), so this
  // is the amplitude that puts the same volume back over everything else: a
  // narrow cap barely disturbs the rest, a broad sole pushes it all out.
  const pitShare = 1 / (2 * (sharpness + 1));
  const swell = pitShare / Math.max(1e-6, 1 - pitShare);

  for (let i = 0; i < rest.length; i += 3) {
    const x = rest[i]!;
    const y = rest[i + 1]!;
    const z = rest[i + 2]!;
    const norm = Math.hypot(x, y, z) || 1;
    const nx = x / norm;
    const ny = y / norm;
    const nz = z / norm;
    // How square-on this vertex faces the incoming shoe.
    const facing = -(nx * dx + ny * dy + nz * dz);
    const pressed = facing > 0 ? Math.pow(facing, sharpness) : 0;
    const inward = reach * pressed;
    const outward = reach * swell * (1 - pressed);

    array[i] = x + dx * inward + nx * outward;
    array[i + 1] = y + dy * inward + ny * outward;
    array[i + 2] = z + dz * inward + nz * outward;
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function createTargetOverlay(): TargetOverlay {
  const group = new THREE.Group();
  // The horizontal half-width is the radius the contact test measures, so the
  // axis a dodge moves along stays honest; the proxy is simply taller on the
  // axis nothing is judged against.
  const geometry = new THREE.SphereGeometry(TARGET_RADIUS, 32, 24);
  geometry.scale(1, PROXY_HEIGHT_RATIO, PROXY_DEPTH_RATIO);
  taperProxy(geometry, TARGET_RADIUS * PROXY_HEIGHT_RATIO);
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
  taperProxy(coreGeometry, TARGET_RADIUS * CORE_SCALE * PROXY_HEIGHT_RATIO);
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

  // The undented shape, kept so every frame starts from the authored surface
  // instead of accumulating its own rounding error.
  const restShell = Float32Array.from(
    (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
  );
  const restCore = Float32Array.from(
    (coreGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
  );

  let inspecting = false;
  /**
   * How far the collapse has got, once this side has gone.
   *
   * It used to be instant: the moment the contact resolved, the proxy dropped
   * to its collapsed shape and colour — before the shoe that did it had
   * finished arriving. So the one hit worth watching was over before it could
   * be seen. The collapse now follows the dent the shoe is pressing, and only
   * ever goes one way.
   */
  let collapse = 0;

  return {
    group,
    mesh,
    core,
    setInspect(enabled: boolean): void {
      inspecting = enabled;
      if (enabled) material.opacity = INSPECT_OPACITY;
    },
    apply(proxy: ProxySnapshot): void {
      const gone = proxy.stage === 'ruptured';
      if (gone) {
        collapse = Math.max(
          collapse,
          Math.min(1, Math.max(0, proxy.imprint?.depth ?? 1) * COLLAPSE_GAIN)
        );
      }
      // Coming apart is read off the shoe pressing, so the last stage arrives
      // as the crush does rather than the instant the contact is scored.
      FADE_FROM.setHex(STAGE_COLORS[3] ?? STAGE_COLORS[0]);
      FADE_TO.setHex(STAGE_COLORS[proxy.colorStage] ?? STAGE_COLORS[0]);
      material.color.copy(gone ? FADE_FROM.lerp(FADE_TO, collapse) : FADE_TO);
      FADE_FROM.setHex(STAGE_EMISSIVE[3] ?? STAGE_EMISSIVE[0]);
      FADE_TO.setHex(STAGE_EMISSIVE[proxy.colorStage] ?? STAGE_EMISSIVE[0]);
      material.emissive.copy(gone ? FADE_FROM.lerp(FADE_TO, collapse) : FADE_TO);
      material.opacity = inspecting
        ? INSPECT_OPACITY
        : gone
          ? BASE_OPACITY + (0.92 - BASE_OPACITY) * collapse
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
      if (gone) {
        // Collapsed: it gives up its form and settles, without any tear
        // geometry, spill, or wound. It simply stops holding itself up — and
        // it does so while the shoe is still pressing, not before it lands.
        group.scale.set(
          bulge * (1 + 0.22 * collapse),
          flatten * (1 - 0.66 * collapse),
          bulge * (1 + 0.16 * collapse)
        );
      }
      // Permanent crushing: the core flattens and darkens, and only becomes
      // visible once there is something to see. It never springs back.
      const crushed = Math.min(1, Math.max(0, proxy.core));
      coreMaterial.color.setHex(CORE_COLORS[proxy.colorStage] ?? CORE_COLORS[0]);
      coreMaterial.opacity = inspecting ? Math.min(0.95, crushed * 1.4) : crushed * 0.9;
      const coreFlatten = 1 - crushed * 0.55;
      core.scale.set(1 / Math.sqrt(coreFlatten), coreFlatten, 1 / Math.sqrt(coreFlatten));

      // The shoe's shape, pressed in where it landed. The core keeps the part
      // that never comes back, so a spent proxy carries the mark of what did it.
      pressImprint(geometry, restShell, proxy.imprint, TARGET_RADIUS);
      pressImprint(
        coreGeometry,
        restCore,
        proxy.imprint ? { ...proxy.imprint, depth: crushed } : null,
        TARGET_RADIUS * CORE_SCALE
      );

      // And it is driven off its centre: the contact shoves the inner body
      // toward the far wall instead of compressing it where it sits.
      if (proxy.imprint) {
        const push =
          TARGET_RADIUS * CORE_SHIFT * Math.min(1, Math.max(0, proxy.imprint.depth));
        const length =
          Math.hypot(proxy.imprint.x, proxy.imprint.y, proxy.imprint.z) || 1;
        core.position.set(
          (proxy.imprint.x / length) * push,
          (proxy.imprint.y / length) * push,
          (proxy.imprint.z / length) * push
        );
      } else {
        core.position.set(0, 0, 0);
      }

      // One sits a little smaller and a little lower than the other. The size
      // goes on the meshes rather than the group, because the group's scale is
      // the volume-preserving squash and must keep multiplying out to one.
      const lean = proxy.side === 'left' ? -PROXY_ASYMMETRY : PROXY_ASYMMETRY;
      const sized = 1 - lean * 0.5;
      mesh.scale.setScalar(sized);
      core.scale.multiplyScalar(sized);
      // Driven back by whatever is on it. The shoe shoves it toward the bone
      // before it crushes it against it, so it gives way first and only then
      // starts to dent — which is the difference between a kick arriving and
      // a dent being switched on.
      const shove = proxy.imprint ? Math.max(0, proxy.press) : 0;
      const along =
        proxy.imprint && shove > 0
          ? Math.hypot(proxy.imprint.x, proxy.imprint.y, proxy.imprint.z) || 1
          : 1;
      group.position.set(
        proxy.position.x + (proxy.imprint ? (proxy.imprint.x / along) * shove : 0),
        proxy.position.y +
          lean * TARGET_RADIUS * 0.9 +
          (proxy.imprint ? (proxy.imprint.y / along) * shove : 0),
        proxy.imprint ? (proxy.imprint.z / along) * shove : 0
      );
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


export interface TargetShell {
  group: THREE.Group;
  /**
   * Where the cords root, relative to the pair, in the pair's own frame.
   * Zero is the upright case, where they hang straight down from it.
   */
  setRootOffset(y: number, z: number): void;
  /** Re-fits the shell and tethers around wherever the pair has swung to. */
  apply(left: ProxySnapshot, right: ProxySnapshot): void;
  setInspect(enabled: boolean): void;
  dispose(): void;
}

/**
 * The structure the pair hangs in: one soft outer envelope holding both, and a
 * cord descending to each from its own attachment point.
 *
 * The two cords root a short distance apart rather than at one point, which is
 * the structure the reference describes and the same two attachments the
 * simulation swings each body from — so what is drawn is what is being
 * simulated, not a decoration over it.
 *
 * Without it the proxies float with nothing joining them to the body, which is
 * what makes them read as stuck on rather than suspended — and it is also why
 * they swing at all, so drawing it explains the mechanic.
 *
 * This is the same topology the authoring verification checks for: one outer
 * closed surface around two bodies.
 */
export function createTargetShell(): TargetShell {
  const group = new THREE.Group();
  group.name = 'targetShell';

  const envelopeGeometry = new THREE.SphereGeometry(1, 24, 18);
  roughenSurface(envelopeGeometry, 0.04);
  const envelopeMaterial = new THREE.MeshStandardMaterial({
    color: 0xb6a091,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    depthTest: false
  });
  const envelope = new THREE.Mesh(envelopeGeometry, envelopeMaterial);
  envelope.renderOrder = 8;
  group.add(envelope);

  // Thicker where it roots and tapering into the envelope, the way a cord
  // carrying a load does.
  const tetherGeometry = new THREE.CylinderGeometry(0.0075, 0.005, 1, 8, 1, true);
  // The cylinder is built along +Y and anchored at its top, so scaling its
  // length grows it downward from the attachment rather than about its middle.
  tetherGeometry.translate(0, -0.5, 0);
  const tetherMaterial = new THREE.MeshStandardMaterial({
    color: 0xa8907f,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    depthTest: false
  });
  const tethers = [0, 1].map(() => {
    const mesh = new THREE.Mesh(tetherGeometry, tetherMaterial);
    mesh.renderOrder = 9;
    group.add(mesh);
    return mesh;
  });

  const UP = new THREE.Vector3(0, 1, 0);
  const to = new THREE.Vector3();
  let rootY = 0;
  let rootZ = 0;

  return {
    group,
    setRootOffset(y: number, z: number): void {
      rootY = y;
      rootZ = z;
    },
    apply(left: ProxySnapshot, right: ProxySnapshot): void {
      const pair = [left, right];

      // Envelope: centred between the two, wide enough to contain both.
      const cx = (left.position.x + right.position.x) / 2;
      const cy = (left.position.y + right.position.y) / 2;
      const spread = Math.abs(right.position.x - left.position.x);
      const drop = Math.abs(right.position.y - left.position.y);
      envelope.position.set(cx, cy, 0);
      envelope.scale.set(
        spread / 2 + TARGET_RADIUS * 1.5,
        // Close around the pair rather than reaching up to the anchor, so the
        // cords are seen descending into it instead of being hidden by it.
        TARGET_RADIUS * PROXY_HEIGHT_RATIO * 1.2 + drop / 2,
        TARGET_RADIUS * 1.45
      );

      // Cords: each from its own attachment to the body it carries. When the
      // attachment is not above the pair — face down it is metres in front of
      // it — the cord spans that gap and runs at an angle, which is the whole
      // difference between hanging and being drawn out between the thighs.
      tethers.forEach((tether, i) => {
        const proxy = pair[i]!;
        const root = attachment(i === 0 ? 'left' : 'right');
        to.set(
          proxy.position.x - root.x,
          proxy.position.y - root.y - rootY,
          -rootZ
        );
        const length = Math.max(0.004, to.length());
        tether.position.set(root.x, root.y + rootY, rootZ);
        tether.scale.set(1, length, 1);
        tether.quaternion.setFromUnitVectors(
          UP,
          to.clone().multiplyScalar(-1 / length)
        );
      });
    },
    setInspect(enabled: boolean): void {
      envelopeMaterial.opacity = enabled ? 0.28 : 0.4;
      tetherMaterial.opacity = enabled ? 0.9 : 0.75;
    },
    dispose(): void {
      envelopeGeometry.dispose();
      envelopeMaterial.dispose();
      tetherGeometry.dispose();
      tetherMaterial.dispose();
    }
  };
}
