import * as THREE from 'three';
import type { CharacterRig } from './characters';
import type { GameSnapshot } from '../game/types';

export interface AnimationController {
  trail: THREE.Object3D;
  update(snapshot: GameSnapshot, delta: number): void;
  /** Extra camera offset produced by impact shake, in world units. */
  shake(): THREE.Vector3;
  setShakeEnabled(enabled: boolean): void;
  dispose(): void;
}

const TRAIL_POINTS = 14;

/**
 * Presentation-only motion: a telegraph trail behind the foot, a short proxy
 * pop after contact, and optional screen shake. None of it feeds back into the
 * simulation, so disabling it never changes the outcome of a run.
 */
export function createAnimation(rig: CharacterRig): AnimationController {
  const positions = new Float32Array(TRAIL_POINTS * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xffc857,
    transparent: true,
    opacity: 0
  });
  const trail = new THREE.Line(geometry, material);
  trail.frustumCulled = false;

  const history: THREE.Vector3[] = Array.from(
    { length: TRAIL_POINTS },
    () => new THREE.Vector3()
  );

  const shakeOffset = new THREE.Vector3();
  let shakeStrength = 0;
  let shakeEnabled = true;
  let popTimer = 0;
  let lastPhase: GameSnapshot['phase'] = 'setup';

  return {
    trail,
    update(snapshot: GameSnapshot, delta: number): void {
      const foot = snapshot.foot;
      for (let i = history.length - 1; i > 0; i -= 1) {
        history[i]!.copy(history[i - 1]!);
      }
      history[0]!.set(foot.x, foot.y, foot.z);
      for (let i = 0; i < history.length; i += 1) {
        const point = history[i]!;
        positions[i * 3] = point.x;
        positions[i * 3 + 1] = point.y;
        positions[i * 3 + 2] = point.z;
      }
      geometry.attributes.position!.needsUpdate = true;

      const telegraphing = snapshot.phase === 'telegraph' || snapshot.phase === 'strike';
      const targetOpacity = telegraphing ? 0.55 : 0;
      material.opacity += (targetOpacity - material.opacity) * Math.min(1, delta * 8);

      if (snapshot.phase === 'impact' && lastPhase !== 'impact') {
        popTimer = 0.5;
        shakeStrength =
          snapshot.lastGrade === 'center-compression'
            ? 0.055
            : snapshot.lastGrade === 'single-compression'
              ? 0.032
              : snapshot.lastGrade === 'graze'
                ? 0.012
                : 0;
      }
      lastPhase = snapshot.phase;

      if (popTimer > 0) {
        popTimer = Math.max(0, popTimer - delta);
        // A brief enlargement makes the contacted proxy readable without text.
        const pop = 1 + Math.sin((popTimer / 0.5) * Math.PI) * 0.18;
        rig.leftTarget.scale.multiplyScalar(pop);
        rig.rightTarget.scale.multiplyScalar(pop);
      }

      shakeStrength = Math.max(0, shakeStrength - delta * 0.18);
      if (shakeEnabled && shakeStrength > 0) {
        shakeOffset.set(
          (Math.random() - 0.5) * shakeStrength,
          (Math.random() - 0.5) * shakeStrength,
          0
        );
      } else {
        shakeOffset.set(0, 0, 0);
      }
    },
    shake(): THREE.Vector3 {
      return shakeOffset;
    },
    setShakeEnabled(enabled: boolean): void {
      shakeEnabled = enabled;
      if (!enabled) shakeOffset.set(0, 0, 0);
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    }
  };
}
