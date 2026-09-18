import type * as THREE from 'three';
import { POSES } from '../game/config';
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
  'kneeling-front': { targetY: 0.66, targetZ: 0.6, distance: 3.5, pitch: 0.09, yaw: -2.15 },
  'seated-chair': { targetY: 0.72, targetZ: 0.6, distance: 3.6, pitch: 0.1, yaw: -2.15 },
  'spread-standing': { targetY: 0.92, targetZ: 0.66, distance: 4.1, pitch: 0.12, yaw: -2.15 },
  'crouch-front': { targetY: 0.54, targetZ: 0.56, distance: 3.3, pitch: 0.08, yaw: -2.15 },
  'braced-back': { targetY: 0.84, targetZ: 0.62, distance: 3.8, pitch: 0.1, yaw: -2.15 }
};

export type ViewId = 'side' | 'front' | 'back' | 'top' | 'diagonal' | 'zoom';

export const VIEW_IDS: ViewId[] = ['side', 'front', 'back', 'top', 'diagonal', 'zoom'];

interface ViewPreset {
  yaw: number;
  pitch: number;
  /** Multiplier on the pose's own framing distance. */
  distanceScale: number;
  /** Aim at the target anchor instead of the whole-arena look-at point. */
  focusAnchor: boolean;
}

/**
 * Fixed review angles. They only apply while the camera is free, so a preset
 * can never fight the attack lock-on for control of the frame.
 */
const VIEWS: Record<ViewId, ViewPreset> = {
  side: { yaw: -Math.PI / 2, pitch: 0.05, distanceScale: 0.94, focusAnchor: false },
  front: { yaw: 0, pitch: 0.06, distanceScale: 1, focusAnchor: false },
  back: { yaw: Math.PI, pitch: 0.06, distanceScale: 0.98, focusAnchor: false },
  top: { yaw: -Math.PI / 2, pitch: 1.15, distanceScale: 0.9, focusAnchor: false },
  diagonal: { yaw: -2.15, pitch: 0.11, distanceScale: 1, focusAnchor: false },
  zoom: { yaw: -2, pitch: 0.02, distanceScale: 0.42, focusAnchor: true }
};

const VIEW_BLEND_SECONDS = 0.3;

const BLEND_SECONDS = 0.22;
const MIN_DISTANCE = 0.9;
const MAX_DISTANCE = 6.5;

export interface CameraController {
  applyPhase(phase: GamePhase, pose: PoseId): void;
  update(delta: number): void;
  orbit(delta: Vec2): void;
  zoom(delta: number): void;
  setObstruction(maxDistance: number): void;
  /** Jump to a fixed review angle. Ignored unless the camera is free. */
  setView(view: ViewId): void;
  view(): ViewId | null;
  setInspect(enabled: boolean): void;
  inspecting(): boolean;
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
  let poseId: PoseId = 'standing-front';
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

  let currentView: ViewId | null = null;
  let inspect = false;
  let viewBlend = VIEW_BLEND_SECONDS;
  let viewFrom = { yaw: userYaw, pitch: userPitch, distance: preset.distance };
  let viewTo = { yaw: userYaw, pitch: userPitch, distance: preset.distance };

  function effectiveDistance(): number {
    return Math.min(desiredDistance, obstruction);
  }

  function focusAnchor(): boolean {
    return inspect || (currentView !== null && VIEWS[currentView].focusAnchor);
  }

  function lookAtY(): number {
    return focusAnchor() ? POSES[poseId].anchorHeight : preset.targetY;
  }

  function lookAtZ(): number {
    return focusAnchor() ? 0 : preset.targetZ;
  }

  function frame(yaw: number, pitch: number, distance: number): void {
    const horizontal = Math.cos(pitch) * distance;
    const targetY = lookAtY();
    const targetZ = lookAtZ();
    camera.position.set(
      Math.sin(yaw) * horizontal,
      targetY + Math.sin(pitch) * distance + 0.28,
      targetZ + Math.cos(yaw) * horizontal
    );
    camera.lookAt(0, targetY, targetZ);
  }

  function beginViewBlend(view: ViewPreset): void {
    viewFrom = { yaw: activeYaw, pitch: activePitch, distance: activeDistance };
    viewTo = {
      yaw: view.yaw,
      pitch: view.pitch,
      distance: clamp(preset.distance * view.distanceScale, MIN_DISTANCE, MAX_DISTANCE)
    };
    viewBlend = 0;
  }

  function cancelViewBlend(): void {
    currentView = null;
    viewBlend = VIEW_BLEND_SECONDS;
  }

  function applyNow(): void {
    frame(activeYaw, activePitch, Math.min(activeDistance, obstruction));
  }

  return {
    applyPhase(phase: GamePhase, pose: PoseId): void {
      poseId = pose;
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
      if (phase !== 'setup') {
        // Review framing belongs to the menus, never to an attack in flight.
        inspect = false;
        cancelViewBlend();
      }
      // Hand the locked framing back to the player so the view does not jump.
      currentMode = 'free-orbit';
      blendTime = BLEND_SECONDS;
      userYaw = activeYaw;
      userPitch = activePitch;
      desiredDistance = activeDistance;
    },

    update(delta: number): void {
      if (currentMode === 'free-orbit' && viewBlend < VIEW_BLEND_SECONDS) {
        viewBlend = Math.min(VIEW_BLEND_SECONDS, viewBlend + Math.max(0, delta));
        const t = easeInOut(viewBlend / VIEW_BLEND_SECONDS);
        activeYaw = viewFrom.yaw + (viewTo.yaw - viewFrom.yaw) * t;
        activePitch = viewFrom.pitch + (viewTo.pitch - viewFrom.pitch) * t;
        activeDistance = viewFrom.distance + (viewTo.distance - viewFrom.distance) * t;
        // Hand the blended frame to the player so a drag continues from here.
        userYaw = activeYaw;
        userPitch = activePitch;
        desiredDistance = activeDistance;
        applyNow();
        return;
      }
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
      cancelViewBlend();
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

    setView(view: ViewId): void {
      if (!orbitAllowed) return;
      currentView = view;
      beginViewBlend(VIEWS[view]);
    },

    view(): ViewId | null {
      return currentView;
    },

    setInspect(enabled: boolean): void {
      if (enabled && !orbitAllowed) return;
      inspect = enabled;
      if (enabled) {
        currentView = 'zoom';
        beginViewBlend(VIEWS.zoom);
      } else {
        currentView = 'diagonal';
        beginViewBlend(VIEWS.diagonal);
      }
    },

    inspecting(): boolean {
      return inspect;
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
