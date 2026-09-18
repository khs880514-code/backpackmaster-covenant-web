import type * as THREE from 'three';
import type { CameraPhase, GamePhase, PoseId, Vec2 } from '../game/types';

interface PosePreset {
  /** Look-at point sits between the two figures so both stay in frame. */
  targetZ: number;
  targetY: number;
  distance: number;
  pitch: number;
  /**
   * Three-quarter framing from the player's front-left. Looking straight down
   * the z axis would put the camera behind the attacker, so the attack reads
   * as depth rather than as sideways travel.
   */
  yaw: number;
}

const PRESETS: Record<PoseId, PosePreset> = {
  'standing-front': { targetY: 0.96, targetZ: 0.66, distance: 3.9, pitch: 0.11, yaw: -2.15 },
  'kneeling-front': { targetY: 0.66, targetZ: 0.6, distance: 3.5, pitch: 0.09, yaw: -2.15 }
};

const BLEND_SECONDS = 0.22;
const MIN_DISTANCE = 0.9;
const MAX_DISTANCE = 6.5;

export interface CameraController {
  applyPhase(phase: GamePhase, pose: PoseId): void;
  update(delta: number): void;
  orbit(delta: Vec2): void;
  zoom(delta: number): void;
  setObstruction(maxDistance: number): void;
  mode(): CameraPhase;
  orbitEnabled(): boolean;
  blendProgress(): number;
  yaw(): number;
  distance(): number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Free orbit while preparing, a 220 ms recenter as the attack telegraphs, then
 * a locked frame through the strike. The player's last yaw is preserved so the
 * camera returns where they left it.
 */
export function createCameraController(camera: THREE.PerspectiveCamera): CameraController {
  let preset = PRESETS['standing-front'];
  let currentMode: CameraPhase = 'free-orbit';
  let orbitAllowed = true;

  let userYaw = preset.yaw;
  let userPitch = preset.pitch;
  let desiredDistance = preset.distance;
  let obstruction = Infinity;

  // The frame the camera is actually using. It follows the player while
  // orbiting and holds the blended pose preset once the attack locks on.
  let activeYaw = userYaw;
  let activePitch = userPitch;

  let blendTime = BLEND_SECONDS;
  let fromYaw = userYaw;
  let fromPitch = userPitch;
  let fromDistance = preset.distance;
  let activeDistance = preset.distance;

  function effectiveDistance(): number {
    return Math.min(desiredDistance, obstruction);
  }

  function frame(yaw: number, pitch: number, distance: number): void {
    const horizontal = Math.cos(pitch) * distance;
    camera.position.set(
      Math.sin(yaw) * horizontal,
      preset.targetY + Math.sin(pitch) * distance + 0.28,
      preset.targetZ + Math.cos(yaw) * horizontal
    );
    camera.lookAt(0, preset.targetY, preset.targetZ);
  }

  function applyNow(): void {
    frame(activeYaw, activePitch, Math.min(activeDistance, obstruction));
  }

  return {
    applyPhase(phase: GamePhase, pose: PoseId): void {
      preset = PRESETS[pose];
      const locking = phase === 'telegraph';
      orbitAllowed = phase === 'setup' || phase === 'recovery' || phase === 'won' || phase === 'lost';

      if (locking) {
        currentMode = 'recentering';
        blendTime = 0;
        fromYaw = activeYaw;
        fromPitch = activePitch;
        fromDistance = activeDistance;
        return;
      }
      if (phase === 'strike' || phase === 'impact') {
        currentMode = 'locked';
        return;
      }
      // Hand the locked framing back to the player so the view does not jump.
      currentMode = 'free-orbit';
      blendTime = BLEND_SECONDS;
      userYaw = activeYaw;
      userPitch = activePitch;
      desiredDistance = activeDistance;
    },

    update(delta: number): void {
      if (currentMode === 'recentering') {
        blendTime = Math.min(BLEND_SECONDS, blendTime + Math.max(0, delta));
        const t = easeInOut(blendTime / BLEND_SECONDS);
        activeYaw = fromYaw + (preset.yaw - fromYaw) * t;
        activePitch = fromPitch + (preset.pitch - fromPitch) * t;
        activeDistance = fromDistance + (preset.distance - fromDistance) * t;
        applyNow();
        if (blendTime >= BLEND_SECONDS) currentMode = 'locked';
        return;
      }
      applyNow();
    },

    orbit(delta: Vec2): void {
      if (!orbitAllowed) return;
      userYaw += delta.x * 1.6;
      userPitch = clamp(userPitch + delta.y * 0.9, -0.35, 0.9);
      activeYaw = userYaw;
      activePitch = userPitch;
      activeDistance = desiredDistance;
      applyNow();
    },

    zoom(delta: number): void {
      desiredDistance = clamp(desiredDistance + delta, MIN_DISTANCE, MAX_DISTANCE);
      if (currentMode === 'free-orbit') activeDistance = desiredDistance;
    },

    setObstruction(maxDistance: number): void {
      obstruction = Math.max(MIN_DISTANCE * 0.5, maxDistance);
    },

    mode(): CameraPhase {
      return currentMode;
    },

    orbitEnabled(): boolean {
      return orbitAllowed;
    },

    blendProgress(): number {
      if (currentMode !== 'recentering') return 1;
      return blendTime / BLEND_SECONDS;
    },

    yaw(): number {
      return userYaw;
    },

    distance(): number {
      return effectiveDistance();
    }
  };
}
