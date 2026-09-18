import * as THREE from 'three';

export type QualityLevel = 'high' | 'medium' | 'low';

export interface SceneController {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  resize(width: number, height: number): void;
  setQuality(level: QualityLevel): void;
  render(): void;
  dispose(): void;
}

const PIXEL_RATIO_CAP: Record<QualityLevel, number> = {
  high: 2,
  medium: 1.5,
  low: 1
};

/**
 * Upper bound on drawing-buffer pixels per quality level. Tall, high-density
 * screens (Fold-class portrait at DPR 2 is over eight million pixels) would
 * otherwise render at a few frames per second on integrated and software GPUs.
 */
const PIXEL_BUDGET: Record<QualityLevel, number> = {
  high: 2_600_000,
  medium: 1_700_000,
  low: 1_000_000
};

const MIN_PIXEL_RATIO = 0.6;

/**
 * Creates the renderer and a fixed three-point light rig. Throws when WebGL is
 * unavailable so the caller can show a support message instead of a blank page.
 */
export function createScene(canvas: HTMLCanvasElement): SceneController {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setClearColor(0x0b0d14, 1);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0d14, 3.2, 8.5);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 40);
  camera.position.set(0, 1.35, 2.6);
  camera.lookAt(0, 0.95, 0);

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(1.8, 3.1, 2.4);
  const rim = new THREE.DirectionalLight(0x86a8ff, 1.15);
  rim.position.set(-2.2, 1.9, -2.1);
  const ambient = new THREE.HemisphereLight(0x8ea6d8, 0x14161f, 0.85);
  scene.add(key, rim, ambient);

  let quality: QualityLevel = 'high';

  function resize(width: number, height: number): void {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const budgetRatio = Math.sqrt(
      PIXEL_BUDGET[quality] / Math.max(1, safeWidth * safeHeight)
    );
    const ratio = Math.max(
      MIN_PIXEL_RATIO,
      Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP[quality], budgetRatio)
    );
    renderer.setPixelRatio(ratio);
    renderer.setSize(safeWidth, safeHeight, false);
    camera.aspect = safeWidth / safeHeight;
    // Widen the field of view on tall portrait screens so the arena still fits.
    camera.fov = camera.aspect < 0.75 ? 58 : 46;
    camera.updateProjectionMatrix();
  }

  return {
    scene,
    camera,
    renderer,
    resize,
    setQuality(level: QualityLevel): void {
      quality = level;
      const size = renderer.getSize(new THREE.Vector2());
      resize(size.x, size.y);
    },
    render(): void {
      renderer.render(scene, camera);
    },
    dispose(): void {
      renderer.dispose();
    }
  };
}
