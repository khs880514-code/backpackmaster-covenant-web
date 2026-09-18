import type * as THREE from 'three';
import { POSES } from '../game/config';
import type { CameraPhase, GamePhase, PoseId, Vec2, Vec3 } from '../game/types';

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
  // Low and close: the target is on the floor for this one.
  'spread-standing': { targetY: 0.34, targetZ: 0.58, distance: 3.0, pitch: 0.2, yaw: -2.15 },
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
/** How tight the camera gets at the moment of contact. */
const IMPACT_DISTANCE_SCALE = 0.32;
/**
 * How close the camera gets once it knows the exact spot that was struck.
 *
 * Tighter than the generic punch-in: the point of the review is to show which
 * proxy the shoe caught and how far it pushed in, and 0.32 of the arena
 * distance still reads as a body, not a contact.
 */
const CONTACT_DISTANCE_SCALE = 0.19;
const PUNCH_IN_RATE = 9;
const PUNCH_OUT_RATE = 2.6;
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
  /** 0 while framing the arena, 1 while pushed in on the contact. */
  punch(): number;
  /**
   * The world point the review framing pushes in on. Passing null returns the
   * punch-in to the body anchor, which is all a miss deserves.
   */
  focusContact(point: Vec3 | null): void;
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
  // Contact happens on a target a few centimetres across, so the camera goes
  // and looks at it. Without this the deformation is simply too small to read.
  let punchAmount = 0;
  let punchTarget = 0;
  let contact: Vec3 | null = null;
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
    const t = punchAmount;
    // Blend the arena framing toward a close look at the spot that was struck,
    // falling back to the anchor when nothing has landed yet.
    const anchorY = POSES[poseId].anchorHeight;
    const focusX = contact ? contact.x : 0;
    const focusY = contact ? contact.y : anchorY;
    const focusZ = contact ? contact.z : 0;
    const targetX = focusX * t;
    const targetY = lookAtY() * (1 - t) + focusY * t;
    const targetZ = lookAtZ() * (1 - t) + focusZ * t;
    const scale = contact ? CONTACT_DISTANCE_SCALE : IMPACT_DISTANCE_SCALE;
    const framedDistance = distance * (1 - t) + distance * scale * t;
    const framedPitch = pitch * (1 - t) + 0.02 * t;

    const horizontal = Math.cos(framedPitch) * framedDistance;
    camera.position.set(
      targetX + Math.sin(yaw) * horizontal,
      targetY + Math.sin(framedPitch) * framedDistance + 0.28 * (1 - t) + 0.02 * t,
      targetZ + Math.cos(yaw) * horizontal
    );
    camera.lookAt(targetX, targetY, targetZ);
  }

  function stepPunch(delta: number): void {
    const rate = punchTarget > punchAmount ? PUNCH_IN_RATE : PUNCH_OUT_RATE;
    const step = Math.min(1, Math.max(0, delta) * rate);
    punchAmount += (punchTarget - punchAmount) * step;
    if (Math.abs(punchTarget - punchAmount) < 0.001) punchAmount = punchTarget;
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
        punchTarget = 0;
        currentMode = 'recentering';
        blendTime = 0;
        fromYaw = activeYaw;
        fromPitch = activePitch;
        fromDistance = activeDistance;
        return;
      }
      if (phase === 'strike' || phase === 'impact') {
        currentMode = 'locked';
        punchTarget = phase === 'impact' ? 1 : 0;
        if (phase === 'strike') contact = null;
        return;
      }
      punchTarget = 0;
      contact = null;
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
      stepPunch(delta);

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

    focusContact(point: Vec3 | null): void {
      contact = point ? { x: point.x, y: point.y, z: point.z } : null;
    },

    punch(): number {
      return punchAmount;
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
