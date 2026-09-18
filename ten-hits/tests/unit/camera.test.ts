import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VIEW_IDS, createCameraController } from '../../src/render/camera';
import { POSE_IDS } from '../../src/game/config';

function controller() {
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 40);
  return { camera, ctrl: createCameraController(camera) };
}

describe('camera controller', () => {
  it('allows orbit during setup', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('setup', 'standing-front');
    expect(ctrl.orbitEnabled()).toBe(true);
  });

  it('begins a smooth recenter on telegraph', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('setup', 'standing-front');
    ctrl.orbit({ x: 0.6, y: 0.1 });
    ctrl.applyPhase('telegraph', 'standing-front');
    expect(ctrl.mode()).toBe('recentering');
    expect(ctrl.blendProgress()).toBeLessThan(1);
  });

  it('disables orbit during the strike', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('strike', 'standing-front');
    expect(ctrl.orbitEnabled()).toBe(false);
  });

  it('restores orbit during recovery', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('strike', 'standing-front');
    ctrl.applyPhase('recovery', 'standing-front');
    expect(ctrl.orbitEnabled()).toBe(true);
  });

  it('remembers the last user yaw for the next setup phase', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('setup', 'standing-front');
    ctrl.orbit({ x: 0.5, y: 0 });
    const yaw = ctrl.yaw();
    ctrl.applyPhase('strike', 'standing-front');
    ctrl.applyPhase('setup', 'standing-front');
    expect(ctrl.yaw()).toBeCloseTo(yaw, 5);
  });

  it('completes the blend in about 220 ms', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('telegraph', 'standing-front');
    ctrl.update(0.1);
    expect(ctrl.blendProgress()).toBeGreaterThan(0);
    ctrl.update(0.2);
    expect(ctrl.blendProgress()).toBe(1);
    expect(ctrl.mode()).toBe('locked');
  });

  it('frames the kneeling pose lower than the standing pose', () => {
    const a = controller();
    a.ctrl.applyPhase('telegraph', 'standing-front');
    a.ctrl.update(1);
    const b = controller();
    b.ctrl.applyPhase('telegraph', 'kneeling-front');
    b.ctrl.update(1);
    expect(b.camera.position.y).toBeLessThan(a.camera.position.y);
  });

  it('pulls an obstructed camera to the closest valid distance', () => {
    const { ctrl } = controller();
    ctrl.setObstruction(0.9);
    ctrl.applyPhase('telegraph', 'standing-front');
    ctrl.update(1);
    expect(ctrl.distance()).toBeLessThanOrEqual(0.9 + 1e-6);
  });

  it('clamps zoom to a usable range', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('setup', 'standing-front');
    ctrl.zoom(-100);
    expect(ctrl.distance()).toBeGreaterThan(0.5);
    ctrl.zoom(100);
    expect(ctrl.distance()).toBeLessThan(8);
  });
});

describe('camera view presets', () => {
  it('exposes six review views', () => {
    expect(VIEW_IDS).toEqual(['side', 'front', 'back', 'top', 'diagonal', 'zoom']);
  });

  it('moves to a named view and reports it', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('setup', 'standing-front');
    ctrl.setView('side');
    ctrl.update(1);
    expect(ctrl.view()).toBe('side');
    expect(ctrl.yaw()).toBeCloseTo(-Math.PI / 2, 3);
  });

  it('gives every view a distinct camera position', () => {
    const seen = new Set<string>();
    for (const id of VIEW_IDS) {
      const { camera, ctrl } = controller();
      ctrl.applyPhase('setup', 'standing-front');
      ctrl.setView(id);
      ctrl.update(1);
      seen.add(
        [camera.position.x, camera.position.y, camera.position.z]
          .map((n) => n.toFixed(3))
          .join('|')
      );
    }
    expect(seen.size).toBe(VIEW_IDS.length);
  });

  it('pulls the zoom view closer than the diagonal view', () => {
    const wide = controller();
    wide.ctrl.applyPhase('setup', 'standing-front');
    wide.ctrl.setView('diagonal');
    wide.ctrl.update(1);

    const close = controller();
    close.ctrl.applyPhase('setup', 'standing-front');
    close.ctrl.setView('zoom');
    close.ctrl.update(1);

    expect(close.ctrl.distance()).toBeLessThan(wide.ctrl.distance());
  });

  it('refuses a view change while the camera is locked', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('strike', 'standing-front');
    ctrl.setView('top');
    expect(ctrl.view()).toBeNull();
  });

  it('drops the named view as soon as the player orbits', () => {
    const { ctrl } = controller();
    ctrl.applyPhase('setup', 'standing-front');
    ctrl.setView('top');
    ctrl.orbit({ x: 0.1, y: 0 });
    expect(ctrl.view()).toBeNull();
  });

  it('pulls in close on the target anchor while inspecting', () => {
    const wide = controller();
    wide.ctrl.applyPhase('setup', 'standing-front');
    wide.ctrl.update(1);

    const close = controller();
    close.ctrl.applyPhase('setup', 'standing-front');
    close.ctrl.setInspect(true);
    close.ctrl.update(1);

    expect(close.ctrl.distance()).toBeLessThan(wide.ctrl.distance());
    expect(close.camera.position.y).toBeLessThan(wide.camera.position.y);
  });

  it('frames every pose without leaving the target behind', () => {
    for (const id of POSE_IDS) {
      const { camera, ctrl } = controller();
      ctrl.applyPhase('telegraph', id);
      ctrl.update(1);
      expect(Number.isFinite(camera.position.x)).toBe(true);
      expect(camera.position.y).toBeGreaterThan(0);
    }
  });
});
