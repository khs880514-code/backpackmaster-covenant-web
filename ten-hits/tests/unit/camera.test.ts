import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCameraController } from '../../src/render/camera';

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
