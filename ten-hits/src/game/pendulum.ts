import { FIXED_STEP, MAX_SUBSTEPS } from './config';
import type { PendulumBody, PendulumPair, Vec2 } from './types';

/**
 * Two bodies hanging on their own cords, and nothing else.
 *
 * This used to be a spring pulling each body back to a fixed offset from the
 * anchor, which is why the motion never read as physical: a spring has no
 * angular momentum, so the pair snapped to a resting spot instead of swinging
 * through it. What is here now is the real thing — gravity, an inextensible
 * cord that limits distance but can go slack, drag, and a separation
 * constraint so the two cannot pass through one another. The anchor drags them
 * through the cords rather than positioning them, so quick hip movement throws
 * them and they keep going after it stops.
 */

/** Metres per second squared. Real gravity; the cord length sets the period. */
const GRAVITY = 9.81;
/** Velocity damping per second: air and tissue, not a shock absorber. */
const DRAG = 1.9;
/** Cord length. With this and gravity the pair swings at roughly 2 Hz. */
const CORD_LENGTH = 0.055;
/**
 * Half the gap between the two attachment points. The cords descend from two
 * points a few millimetres apart, which is what makes the pair hang slightly
 * apart at rest instead of in the same place.
 */
const ANCHOR_SPREAD = 0.016;
/**
 * How close the two centres may get. Short of a full diameter, so they press
 * against each other rather than staying politely separate.
 */
const SEPARATION = 0.054;
/**
 * The furthest a body can get from its attachment. Slightly over the cord
 * length, the slack a real cord has under load.
 */
const TETHER_RADIUS = CORD_LENGTH * 1.06;

/** Where each cord is attached, relative to the anchor. */
export function attachment(side: 'left' | 'right'): Vec2 {
  return { x: side === 'left' ? -ANCHOR_SPREAD : ANCHOR_SPREAD, y: 0 };
}

function createBody(restOffset: Vec2): PendulumBody {
  return {
    // Hanging at full extension, straight down from its own attachment.
    position: { x: restOffset.x, y: restOffset.y - CORD_LENGTH },
    velocity: { x: 0, y: 0 },
    restOffset: { x: restOffset.x, y: restOffset.y }
  };
}

export function createPendulumPair(): PendulumPair {
  return {
    left: createBody(attachment('left')),
    right: createBody(attachment('right'))
  };
}

function stepBody(body: PendulumBody, anchor: Vec2, dt: number): PendulumBody {
  // The cord's root, which the anchor carries around.
  const rootX = anchor.x + body.restOffset.x;
  const rootY = anchor.y + body.restOffset.y;

  // Free flight: gravity and drag, nothing pulling it to a resting spot.
  let vx = body.velocity.x - body.velocity.x * DRAG * dt;
  let vy = body.velocity.y - (GRAVITY + body.velocity.y * DRAG) * dt;
  let px = body.position.x + vx * dt;
  let py = body.position.y + vy * dt;

  // The cord: it stops the body leaving, and does nothing at all when slack.
  // Removing the radial velocity at the limit is what converts a fall into a
  // swing, and it is the whole reason the pair now carries momentum through
  // the bottom of its arc instead of settling there.
  const dx = px - rootX;
  const dy = py - rootY;
  const distance = Math.hypot(dx, dy);
  if (distance > TETHER_RADIUS && distance > 0) {
    const nx = dx / distance;
    const ny = dy / distance;
    px = rootX + nx * TETHER_RADIUS;
    py = rootY + ny * TETHER_RADIUS;
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

/**
 * Pushes two overlapping bodies apart along the line between them, splitting
 * the correction evenly and killing the velocity that drove them together.
 */
function separate(pair: PendulumPair): PendulumPair {
  const dx = pair.right.position.x - pair.left.position.x;
  const dy = pair.right.position.y - pair.left.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= SEPARATION) return pair;

  // Dead-centre overlap has no direction to resolve along, so push sideways.
  const nx = distance > 1e-6 ? dx / distance : 1;
  const ny = distance > 1e-6 ? dy / distance : 0;
  const push = (SEPARATION - distance) / 2;

  const closing =
    (pair.right.velocity.x - pair.left.velocity.x) * nx +
    (pair.right.velocity.y - pair.left.velocity.y) * ny;
  const bounce = closing < 0 ? closing / 2 : 0;

  return {
    left: {
      ...pair.left,
      position: {
        x: pair.left.position.x - nx * push,
        y: pair.left.position.y - ny * push
      },
      velocity: {
        x: pair.left.velocity.x + nx * bounce,
        y: pair.left.velocity.y + ny * bounce
      }
    },
    right: {
      ...pair.right,
      position: {
        x: pair.right.position.x + nx * push,
        y: pair.right.position.y + ny * push
      },
      velocity: {
        x: pair.right.velocity.x - nx * bounce,
        y: pair.right.velocity.y - ny * bounce
      }
    }
  };
}

/** One fixed simulation step. Never call with a variable frame delta. */
export function stepPendulum(pair: PendulumPair, anchor: Vec2, dt: number): PendulumPair {
  return separate({
    left: stepBody(pair.left, anchor, dt),
    right: stepBody(pair.right, anchor, dt)
  });
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

/**
 * Drives one target away from the point that struck it. The contact has
 * already been graded by the time this runs, so a hit can never change its own
 * outcome — it only shoves the pair for whatever comes next.
 */
export function applyImpulse(
  pair: PendulumPair,
  side: 'left' | 'right',
  from: Vec2,
  strength: number
): PendulumPair {
  const body = side === 'left' ? pair.left : pair.right;
  const dx = body.position.x - from.x;
  const dy = body.position.y - from.y;
  const length = Math.hypot(dx, dy);
  // A dead-centre contact has no direction to push along, so it drives down.
  const nx = length > 1e-5 ? dx / length : 0;
  const ny = length > 1e-5 ? dy / length : -1;

  const pushed: PendulumBody = {
    position: body.position,
    velocity: {
      x: body.velocity.x + nx * strength,
      y: body.velocity.y + ny * strength - strength * 0.35
    },
    restOffset: body.restOffset
  };
  return side === 'left' ? { ...pair, left: pushed } : { ...pair, right: pushed };
}

export function bodyDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const PENDULUM_TETHER_RADIUS = TETHER_RADIUS;
export const PENDULUM_CORD_LENGTH = CORD_LENGTH;
export const PENDULUM_ANCHOR_SPREAD = ANCHOR_SPREAD;
export const PENDULUM_SEPARATION = SEPARATION;
