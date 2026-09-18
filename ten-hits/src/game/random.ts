/**
 * Deterministic 32-bit PRNG. Every run seeds from a single integer so replays
 * and unit tests never depend on frame rate or wall-clock time.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes two integers into one seed so sub-systems stay independent. */
export function mixSeed(seed: number, salt: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
}

export function randomRange(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}
