import { FIXED_STEP, MAX_SUBSTEPS } from './config';
import type { PendulumBody, PendulumPair, Vec2 } from './types';

const STIFFNESS = 34;
const DAMPING = 7.5;
const GRAVITY_BIAS = 0.32;
const TETHER_RADIUS = 0.55;
const REST_SPREAD = 0.13;
const REST_DROP = -0.04;

function createBody(restOffset: Vec2): PendulumBody {
  return {
    position: { x: restOffset.x, y: restOffset.y },
    velocity: { x: 0, y: 0 },
    restOffset: { x: restOffset.x, y: restOffset.y }
  };
}

export function createPendulumPair(): PendulumPair {
  return {
    left: createBody({ x: -REST_SPREAD, y: REST_DROP }),
    right: createBody({ x: REST_SPREAD, y: REST_DROP })
  };
}

function stepBody(body: PendulumBody, anchor: Vec2, dt: number): PendulumBody {
  const targetX = anchor.x + body.restOffset.x;
  const targetY = anchor.y + body.restOffset.y;

  const accelX = (targetX - body.position.x) * STIFFNESS - body.velocity.x * DAMPING;
  const accelY =
    (targetY - body.position.y) * STIFFNESS - body.velocity.y * DAMPING - GRAVITY_BIAS;

  let vx = body.velocity.x + accelX * dt;
  let vy = body.velocity.y + accelY * dt;
  let px = body.position.x + vx * dt;
  let py = body.position.y + vy * dt;

  // Numerical drift under violent anchor changes can push a target past its
  // tether. Project it back onto the sphere and keep only tangential velocity
  // so the pair never snaps or explodes.
  const dx = px - anchor.x;
  const dy = py - anchor.y;
  const distance = Math.hypot(dx, dy);
  if (distance > TETHER_RADIUS && distance > 0) {
    const nx = dx / distance;
    const ny = dy / distance;
    px = anchor.x + nx * TETHER_RADIUS;
    py = anchor.y + ny * TETHER_RADIUS;
    const radial = vx * nx + vy * ny;
    if (radial > 0) {
      vx -= radial * nx;
      vy -= radial * ny;
    }
  }

  return {
    position: { x: px, y: py },
    velocity: { x: vx, y: vy },
    restOffset: body.restOffset
  };
}

/** One fixed simulation step. Never call with a variable frame delta. */
export function stepPendulum(pair: PendulumPair, anchor: Vec2, dt: number): PendulumPair {
  return {
    left: stepBody(pair.left, anchor, dt),
    right: stepBody(pair.right, anchor, dt)
  };
}

export interface PendulumAdvance {
  pair: PendulumPair;
  /** Unconsumed time, carry it into the next frame. */
  remainder: number;
  steps: number;
}

/**
 * Consumes a real frame delta as whole fixed steps so a 30 fps device and a
 * 120 fps device see the same physics.
 */
export function advancePendulum(
  pair: PendulumPair,
  anchor: Vec2,
  delta: number,
  carry = 0
): PendulumAdvance {
  let accumulator = carry + Math.max(0, delta);
  let next = pair;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
    next = stepPendulum(next, anchor, FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (steps >= MAX_SUBSTEPS) accumulator = 0;
  return { pair: next, remainder: accumulator, steps };
}

export function bodyDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const PENDULUM_TETHER_RADIUS = TETHER_RADIUS;
