import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pressImprint, taperProxy } from '../../src/render/targets';
import { createGameEngine } from '../../src/game/engine';
import type { ProxyImprint } from '../../src/game/types';

const RADIUS = 0.028;

function sphere(): { geometry: THREE.BufferGeometry; rest: Float32Array } {
  const geometry = new THREE.SphereGeometry(RADIUS, 32, 24);
  const rest = Float32Array.from(
    (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
  );
  return { geometry, rest };
}

function positions(geometry: THREE.BufferGeometry): Float32Array {
  return (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
}

/** Signed volume the closed surface encloses, by the divergence theorem. */
function enclosedVolume(geometry: THREE.BufferGeometry): number {
  const p = (geometry.getAttribute('position') as THREE.BufferAttribute)
    .array as Float32Array;
  const index = geometry.getIndex()!;
  let volume = 0;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i) * 3;
    const b = index.getX(i + 1) * 3;
    const c = index.getX(i + 2) * 3;
    volume +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return Math.abs(volume) / 6;
}

/** Total distance every vertex moved from rest. */
function displaced(geometry: THREE.BufferGeometry, rest: Float32Array): number {
  const now = positions(geometry);
  let sum = 0;
  for (let i = 0; i < rest.length; i += 3) {
    sum += Math.hypot(now[i]! - rest[i]!, now[i + 1]! - rest[i + 1]!, now[i + 2]! - rest[i + 2]!);
  }
  return sum;
}

/** How far the single most-displaced vertex moved. */
function deepest(geometry: THREE.BufferGeometry, rest: Float32Array): number {
  const now = positions(geometry);
  let max = 0;
  for (let i = 0; i < rest.length; i += 3) {
    max = Math.max(
      max,
      Math.hypot(now[i]! - rest[i]!, now[i + 1]! - rest[i + 1]!, now[i + 2]! - rest[i + 2]!)
    );
  }
  return max;
}

const from = (width: number, depth: number): ProxyImprint => ({
  x: 0,
  y: 0,
  z: -1,
  width,
  depth
});

describe('pressImprint', () => {
  it('leaves the surface untouched when nothing has landed', () => {
    const { geometry, rest } = sphere();
    pressImprint(geometry, rest, null, RADIUS);
    expect(displaced(geometry, rest)).toBe(0);
  });

  it('leaves the surface untouched at zero depth', () => {
    const { geometry, rest } = sphere();
    pressImprint(geometry, rest, from(0.5, 0), RADIUS);
    expect(displaced(geometry, rest)).toBe(0);
  });

  it('dents deeper the harder it was pressed', () => {
    const { geometry, rest } = sphere();
    const depths: number[] = [];
    for (const depth of [0.25, 0.5, 1]) {
      pressImprint(geometry, rest, from(0.5, depth), RADIUS);
      depths.push(deepest(geometry, rest));
    }
    expect(depths[0]!).toBeLessThan(depths[1]!);
    expect(depths[1]!).toBeLessThan(depths[2]!);
  });

  it('gives a narrow shoe a tighter, deeper pit than a broad one', () => {
    const { geometry, rest } = sphere();

    // Half depth, so neither is at the limit and both can still be told apart.
    pressImprint(geometry, rest, from(0, 0.5), RADIUS);
    const narrowSpread = displaced(geometry, rest);
    const narrowPit = deepest(geometry, rest);

    pressImprint(geometry, rest, from(1, 0.5), RADIUS);
    const broadSpread = displaced(geometry, rest);
    const broadPit = deepest(geometry, rest);

    // The narrow cap drives in further through a smaller patch; the broad sole
    // spreads the same contact across much more of the facing surface.
    expect(narrowPit).toBeGreaterThan(broadPit * 1.25);
    expect(broadSpread).toBeGreaterThan(narrowSpread * 1.5);
  });

  it('presses the struck side in and swells the far side out', () => {
    const { geometry, rest } = sphere();
    // The shoe presses along -z, so it arrives on the +z face. That side goes
    // in; the opposite side takes what was displaced and goes out.
    pressImprint(geometry, rest, from(0.5, 1), RADIUS);
    const now = positions(geometry);

    let pressedIn = 0;
    let swelledOut = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const wasOut = Math.hypot(rest[i]!, rest[i + 1]!, rest[i + 2]!);
      const isOut = Math.hypot(now[i]!, now[i + 1]!, now[i + 2]!);
      if (rest[i + 2]! > RADIUS * 0.7 && isOut < wasOut - 1e-6) pressedIn += 1;
      if (rest[i + 2]! < -RADIUS * 0.7 && isOut > wasOut + 1e-9) swelledOut += 1;
    }
    expect(pressedIn).toBeGreaterThan(0);
    expect(swelledOut).toBeGreaterThan(0);
  });

  it('gives back roughly what it takes', () => {
    const { geometry, rest } = sphere();
    const before = enclosedVolume(geometry);
    for (const width of [0, 0.5, 1]) {
      pressImprint(geometry, rest, from(width, 0.5), RADIUS);
      const after = enclosedVolume(geometry);
      // Not exact — the surface is not a fluid — but close enough that the
      // body reads as shoved aside rather than quietly shrinking away.
      expect(after / before).toBeGreaterThan(0.85);
      expect(after / before).toBeLessThan(1.25);
    }
  });

  it('centres the pit on the face the shoe met', () => {
    const { geometry, rest } = sphere();
    pressImprint(geometry, rest, from(0.2, 1), RADIUS);
    const now = positions(geometry);
    let deepestIndex = 0;
    let deepestMove = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const move = Math.hypot(
        now[i]! - rest[i]!,
        now[i + 1]! - rest[i + 1]!,
        now[i + 2]! - rest[i + 2]!
      );
      if (move > deepestMove) {
        deepestMove = move;
        deepestIndex = i;
      }
    }
    // The deepest point sits at the pole facing the shoe, not off to a side.
    expect(rest[deepestIndex + 2]!).toBeGreaterThan(RADIUS * 0.95);
  });

  it('never pushes the pit itself outward', () => {
    const { geometry, rest } = sphere();
    pressImprint(geometry, rest, from(0.5, 1), RADIUS);
    const now = positions(geometry);
    for (let i = 0; i < rest.length; i += 3) {
      // Directly under the shoe only. The rim and the far side are meant to
      // swell, which is where the displaced volume goes.
      if (rest[i + 2]! < RADIUS * 0.9) continue;
      expect(Math.hypot(now[i]!, now[i + 1]!, now[i + 2]!)).toBeLessThan(
        Math.hypot(rest[i]!, rest[i + 1]!, rest[i + 2]!)
      );
    }
  });

  it('returns to the authored shape when the dent is released', () => {
    const { geometry, rest } = sphere();
    pressImprint(geometry, rest, from(0.5, 1), RADIUS);
    expect(displaced(geometry, rest)).toBeGreaterThan(0);
    pressImprint(geometry, rest, null, RADIUS);
    expect(displaced(geometry, rest)).toBe(0);
  });
});

describe('the proxy resting shape', () => {
  it('narrows toward the top instead of staying a ball', () => {
    const radius = 0.028;
    const radiusY = radius * 1.42;
    const geometry = new THREE.SphereGeometry(radius, 32, 24);
    geometry.scale(1, 1.42, 0.97);
    const before = (geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    const widthAt = (source: Float32Array, high: boolean): number => {
      let widest = 0;
      for (let i = 0; i < source.length; i += 3) {
        const y = source[i + 1]!;
        const near = high ? y > radiusY * 0.6 : y < -radiusY * 0.6;
        if (near) widest = Math.max(widest, Math.abs(source[i]!));
      }
      return widest;
    };
    const topBefore = widthAt(Float32Array.from(before), true);
    const bottomBefore = widthAt(Float32Array.from(before), false);
    expect(topBefore).toBeCloseTo(bottomBefore, 5);

    taperProxy(geometry, radiusY);
    const after = (geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    const topAfter = widthAt(after, true);
    const bottomAfter = widthAt(after, false);

    // Narrower where the cord takes the weight, and the volume stays low.
    expect(topAfter).toBeLessThan(topBefore * 0.85);
    expect(bottomAfter).toBeGreaterThan(bottomBefore * 0.95);
  });
});

describe('which way the dent faces when the pose is lying down', () => {
  /** The dent direction from the first graded contact of a run. */
  function firstDirection(pose: 'standing-front' | 'spread-standing') {
    const engine = createGameEngine({ pose, shoe: 'pump', power: 8, seed: 4 });
    engine.start();
    for (let i = 0; i < 60 * 200; i += 1) {
      const snapshot = engine.update(1 / 60);
      if (snapshot.phase !== 'impact') continue;
      for (const proxy of snapshot.proxies) {
        if (proxy.imprint) return proxy.imprint;
      }
    }
    throw new Error('no contact was reviewed');
  }

  it('presses into the face the shoe arrived at, whichever way the pair lies', () => {
    // The direction is measured in world axes but pressed into the pair's own
    // geometry. Standing, those are the same frame. Face down the pair is laid
    // over with the figure, so a direction left in world axes dents the wrong
    // face of it — the shoe comes in along the body and the mark appears
    // underneath.
    const upright = firstDirection('standing-front');
    const prone = firstDirection('spread-standing');

    // The kick drives up and in, so standing it presses mostly along depth.
    expect(Math.abs(upright.z)).toBeGreaterThan(Math.abs(upright.y));
    // Laid down a quarter turn, that same arrival is along the pair's length.
    expect(Math.abs(prone.y)).toBeGreaterThan(Math.abs(prone.z));

    // Either way it is a unit direction, which is what the renderer presses.
    for (const mark of [upright, prone]) {
      expect(Math.hypot(mark.x, mark.y, mark.z)).toBeCloseTo(1, 6);
    }
  });
});

describe('not re-pressing a dent that has not moved', () => {
  it('leaves the shape alone when nothing about the dent changed', () => {
    // Pressing one is the most expensive thing the renderer does per frame,
    // and the dent only moves while a shoe is on it. Measured, skipping the
    // unchanged frames took applySnapshot from 1.5ms to 0.13ms.
    const { geometry, rest } = sphere();
    const mark: ProxyImprint = { x: 0, y: 0, z: -1, width: 0.3, depth: 0.6 };
    pressImprint(geometry, rest, mark, RADIUS);
    const pressed = Float32Array.from(
      (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
    );

    // Scribble over it, then press the identical dent again: nothing is
    // recomputed, which is the whole point.
    const live = (geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    live[0] = 99;
    pressImprint(geometry, rest, { ...mark }, RADIUS);
    expect(live[0]).toBe(99);

    // Anything that actually changed presses it again.
    pressImprint(geometry, rest, { ...mark, depth: 0.61 }, RADIUS);
    expect(live[0]).not.toBe(99);

    // And the same dent still produces the same shape.
    pressImprint(geometry, rest, { ...mark }, RADIUS);
    for (let i = 0; i < pressed.length; i += 1) {
      expect(live[i]!).toBeCloseTo(pressed[i]!, 6);
    }
  });

  it('still lets a dent come back out', () => {
    const { geometry, rest } = sphere();
    pressImprint(geometry, rest, { x: 0, y: 0, z: -1, width: 0.3, depth: 0.6 }, RADIUS);
    pressImprint(geometry, rest, null, RADIUS);
    const live = (geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    for (let i = 0; i < rest.length; i += 1) expect(live[i]!).toBeCloseTo(rest[i]!, 6);
  });
});
