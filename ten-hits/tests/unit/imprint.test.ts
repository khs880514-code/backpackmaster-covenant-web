import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pressImprint } from '../../src/render/targets';
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

  it('only moves the side the shoe came from', () => {
    const { geometry, rest } = sphere();
    // The shoe presses along -z, so it arrives on the +z face and the far
    // hemisphere must not move at all.
    pressImprint(geometry, rest, from(0.5, 1), RADIUS);
    const now = positions(geometry);
    let moved = 0;
    for (let i = 0; i < rest.length; i += 3) {
      if (rest[i + 2]! < 0) {
        expect(now[i]!).toBe(rest[i]!);
        expect(now[i + 1]!).toBe(rest[i + 1]!);
        expect(now[i + 2]!).toBe(rest[i + 2]!);
      } else if (now[i + 2]! !== rest[i + 2]!) {
        moved += 1;
      }
    }
    expect(moved).toBeGreaterThan(0);
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

  it('presses inward, never outward', () => {
    const { geometry, rest } = sphere();
    pressImprint(geometry, rest, from(0.5, 1), RADIUS);
    const now = positions(geometry);
    for (let i = 0; i < rest.length; i += 3) {
      expect(Math.hypot(now[i]!, now[i + 1]!, now[i + 2]!)).toBeLessThanOrEqual(
        Math.hypot(rest[i]!, rest[i + 1]!, rest[i + 2]!) + 1e-6
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
