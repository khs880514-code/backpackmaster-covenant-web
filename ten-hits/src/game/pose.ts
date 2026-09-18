import type { PoseProfile, Vec2 } from './types';

/**
 * Clamps requested pelvis movement into the elliptical region a pose allows.
 * Kneeling trades reach for a lower, harder-to-read silhouette.
 */
export function clampPelvis(input: Vec2, pose: PoseProfile): Vec2 {
  const x = Number.isFinite(input.x) ? input.x : 0;
  const y = Number.isFinite(input.y) ? input.y : 0;
  const nx = x / pose.lateralLimit;
  const ny = y / pose.depthLimit;
  const radius = Math.hypot(nx, ny);
  if (radius <= 1 || radius === 0) return { x, y };
  return {
    x: (nx / radius) * pose.lateralLimit,
    y: (ny / radius) * pose.depthLimit
  };
}

export function poseAnchor(pose: PoseProfile): number {
  return pose.anchorHeight;
}

/** How far a flick can carry the pelvis beyond the sustained drag limit. */
export function flickReach(pose: PoseProfile): number {
  return pose.lateralLimit * 0.34;
}
