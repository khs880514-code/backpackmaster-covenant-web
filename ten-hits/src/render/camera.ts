import type * as THREE from 'three';
import type { CameraPhase, GamePhase, PoseId, Vec2 } from '../game/types';

interface PosePreset {
  targetY: number;
  distance: number;
  pitch: number;
}

const PRESETS: Record<PoseId, PosePreset> = {
  'standing-front': { targetY: 1.02, distance: 2.55, pitch: 0.05 },
  'kneeling-front': { targetY: 0.72, distance: 2.2, pitch: 0.02 }
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

  let userYaw = 0;
  let userPitch = 0.08;
  let desiredDistance = preset.distance;
  let obstruction = Infinity;

  let blendTime = BLEND_SECONDS;
  let fromYaw = 0;
  let fromPitch = 0;
  let fromDistance = preset.distance;

  function effectiveDistance(): number {
    return Math.min(desiredDistance, obstruction);
  }

  function frame(yaw: number, pitch: number, distance: number): void {
    const horizontal = Math.cos(pitch) * distance;
    camera.position.set(
      Math.sin(yaw) * horizontal,
      preset.targetY + Math.sin(pitch) * distance + 0.28,
      Math.cos(yaw) * horizontal
    );
    camera.lookAt(0, preset.targetY, 0);
  }

  function applyNow(): void {
    frame(userYaw, userPitch, effectiveDistance());
  }

  return {
    applyPhase(phase: GamePhase, pose: PoseId): void {
      preset = PRESETS[pose];
      const locking = phase === 'telegraph';
      orbitAllowed = phase === 'setup' || phase === 'recovery' || phase === 'won' || phase === 'lost';

      if (locking) {
        currentMode = 'recentering';
        blendTime = 0;
        fromYaw = userYaw;
        fromPitch = userPitch;
        fromDistance = desiredDistance;
        return;
      }
      if (phase === 'strike' || phase === 'impact') {
        currentMode = 'locked';
        return;
      }
      currentMode = 'free-orbit';
      blendTime = BLEND_SECONDS;
    },

    update(delta: number): void {
      if (currentMode === 'recentering') {
        blendTime = Math.min(BLEND_SECONDS, blendTime + Math.max(0, delta));
        const t = easeInOut(blendTime / BLEND_SECONDS);
        const yaw = fromYaw * (1 - t);
        const pitch = fromPitch + (preset.pitch - fromPitch) * t;
        const distance = fromDistance + (preset.distance - fromDistance) * t;
        frame(yaw, pitch, Math.min(distance, obstruction));
        if (blendTime >= BLEND_SECONDS) currentMode = 'locked';
        return;
      }
      applyNow();
    },

    orbit(delta: Vec2): void {
      if (!orbitAllowed) return;
      userYaw += delta.x * 1.6;
      userPitch = clamp(userPitch + delta.y * 0.9, -0.35, 0.9);
      applyNow();
    },

    zoom(delta: number): void {
      desiredDistance = clamp(desiredDistance + delta, MIN_DISTANCE, MAX_DISTANCE);
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
