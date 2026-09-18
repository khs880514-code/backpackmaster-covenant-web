import './styles.css';
import { createFeedback, type FeedbackController } from './audio/feedback';
import { createGameEngine, type GameEngine } from './game/engine';
import { createAnimation, type AnimationController } from './render/animation';
import { createCameraController, type CameraController, type ViewId } from './render/camera';
import { createCharacters, applySnapshot, type CharacterRig } from './render/characters';
import { createScene, type SceneController } from './render/scene';
import { createPointerController, type PointerController } from './input/pointer-controller';
import { createHud, type HudSelection, type ToggleName } from './ui/hud';
import { createQualityMonitor } from './performance/quality';
import { loadPoseModels, type PoseModelLibrary } from './render/model-library';
import { loadAttackClips, type AttackClipLibrary } from './render/attack-clips';
import {
  defaultSave,
  loadSave,
  recordKey,
  writeSave,
  type SaveData
} from './persistence/storage';
import type { GameSnapshot, Vec2 } from './game/types';

export function mountShell(root: HTMLElement): HTMLElement {
  root.innerHTML = `
    <canvas data-game-canvas aria-label="TEN HITS 3D game"></canvas>
    <section data-game-hud aria-live="polite"></section>
  `;
  return root;
}

export interface MountOptions {
  createScene?: (canvas: HTMLCanvasElement) => SceneController;
  storage?: Storage;
  feedback?: FeedbackController;
  seed?: number;
  /** Where authored glTF models and their manifest live. */
  modelBaseUrl?: string;
  /** Set false to skip the model fetch entirely, as tests do. */
  loadModels?: boolean;
}

export interface GameApp {
  snapshot(): GameSnapshot;
  /** How many authored models are in play, zero when running procedurally. */
  authoredModelCount(): number;
  movePelvis(input: Vec2): void;
  frameCount(): number;
  simulationTime(): number;
  sceneController(): SceneController;
  destroy(): void;
}

const MAX_FRAME_DELTA = 0.1;

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function showUnsupported(hud: HTMLElement): void {
  const note = document.createElement('section');
  note.setAttribute('data-webgl-error', '');
  note.className = 'hud__setup';
  note.innerHTML =
    '<h1 class="hud__title">TEN HITS</h1>' +
    '<p class="hud__subtitle">이 브라우저에서 3D(WebGL)를 시작할 수 없습니다. ' +
    '다른 브라우저에서 열거나 하드웨어 가속을 켜고 다시 시도해 주세요.</p>';
  hud.append(note);
}

/**
 * Wires every subsystem into one playable loop: scene, rig, engine, gestures,
 * camera, HUD, feedback, persistence, and the quality watchdog.
 */
export function mountGame(root: HTMLElement, options: MountOptions = {}): GameApp {
  mountShell(root);
  const canvas = root.querySelector<HTMLCanvasElement>('[data-game-canvas]')!;
  const hudRoot = root.querySelector<HTMLElement>('[data-game-hud]')!;

  const storage = options.storage ?? safeStorage();
  let save: SaveData = storage ? loadSave(storage) : defaultSave();
  const persist = (): void => {
    if (storage) writeSave(storage, save);
  };

  const feedback = options.feedback ?? createFeedback();
  feedback.setEnabled('sound', save.settings.sound);
  feedback.setEnabled('vibration', save.settings.vibration);
  feedback.setEnabled('shake', save.settings.shake);

  let scene: SceneController;
  try {
    scene = (options.createScene ?? createScene)(canvas);
  } catch {
    showUnsupported(hudRoot);
    return {
      snapshot: () => {
        throw new Error('renderer unavailable');
      },
      authoredModelCount: () => 0,
      movePelvis: () => {},
      frameCount: () => 0,
      simulationTime: () => 0,
      sceneController: () => {
        throw new Error('renderer unavailable');
      },
      destroy: () => {
        hudRoot.innerHTML = '';
      }
    };
  }

  let selection: HudSelection = { ...save.lastSetup };
  let engine: GameEngine = createGameEngine({
    ...selection,
    seed: options.seed ?? 1
  });
  let rig: CharacterRig = createCharacters(selection.pose, selection.shoe);
  let animation: AnimationController = createAnimation(rig);
  scene.scene.add(rig.root);
  scene.scene.add(animation.trail);

  const camera: CameraController = createCameraController(scene.camera);
  const quality = createQualityMonitor();
  let qualityLevel = quality.level();

  let models: PoseModelLibrary | null = null;
  let clips: AttackClipLibrary | null = null;
  let frames = 0;
  let running = true;
  let paused = false;
  let lastTime = 0;
  let rafId = 0;
  let pelvis: Vec2 = { x: 0, y: 0 };
  let lastPhase: GameSnapshot['phase'] = 'setup';
  let missesThisRun = 0;

  const hud = createHud(hudRoot, {
    onStart: (choice) => {
      selection = choice;
      save.lastSetup = { ...choice };
      persist();
      feedback.unlock();
      feedback.play('select');
      rebuild();
      engine.start();
    },
    onRestart: () => {
      rebuild();
    },
    onToggle: (name: ToggleName, enabled: boolean) => {
      save.settings[name] = enabled;
      feedback.setEnabled(name, enabled);
      animation.setShakeEnabled(save.settings.shake);
      persist();
    },
    onView: (view: ViewId) => {
      camera.setView(view);
      feedback.play('select');
    },
    onInspect: (enabled: boolean) => {
      rig.setInspect(enabled);
      camera.setInspect(enabled);
      feedback.play('select');
    }
  });
  hud.setToggles(save.settings);

  function rebuild(): void {
    scene.scene.remove(rig.root);
    scene.scene.remove(animation.trail);
    animation.dispose();
    rig.dispose();

    rig = createCharacters(selection.pose, selection.shoe);
    animation = createAnimation(rig);
    animation.setShakeEnabled(save.settings.shake);
    // A rebuilt rig starts clean, so drop any review state with it.
    camera.setInspect(false);
    scene.scene.add(rig.root);
    scene.scene.add(animation.trail);

    applyModels();

    engine = createGameEngine({
      ...selection,
      seed: (options.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0
    });
    pelvis = { x: 0, y: 0 };
    missesThisRun = 0;
    lastPhase = 'setup';
    hud.render(engine.snapshot());
  }

  /** Swaps the authored figure for the current pose in, when one exists. */
  function applyModels(): void {
    if (models) rig.applyPoseModel(models.pose(selection.pose));
    if (clips) rig.applyAttackClip(clips.get(selection.pose));
    // The procedural foot trail has nothing to follow once an authored rig
    // takes over the attack, so it would draw to a phantom position.
    animation.setTrailEnabled(!rig.usingAuthoredAttacker());
  }

  function recordResult(snapshot: GameSnapshot): void {
    if (snapshot.result === 'survived') {
      const key = recordKey(snapshot.pose, snapshot.shoe);
      save.records[key] = Math.max(save.records[key] ?? 0, snapshot.power);
      if (missesThisRun === 0) {
        save.bestNoMissRun = Math.max(save.bestNoMissRun, snapshot.power);
      }
      persist();
    }
  }

  function announce(snapshot: GameSnapshot): void {
    if (snapshot.phase === lastPhase) return;
    if (snapshot.phase === 'telegraph') feedback.play('warning');
    if (snapshot.phase === 'impact') {
      if (snapshot.lastGrade === 'miss') missesThisRun += 1;
      const cue =
        snapshot.lastGrade === 'center-compression'
          ? 'critical'
          : snapshot.lastGrade === 'single-compression'
            ? 'compression'
            : snapshot.lastGrade === 'graze'
              ? 'graze'
              : 'warning';
      feedback.play(cue);
    }
    if (snapshot.phase === 'won') feedback.play('win');
    if (snapshot.phase === 'lost') feedback.play('rupture');
    if (snapshot.phase === 'won' || snapshot.phase === 'lost') recordResult(snapshot);
    lastPhase = snapshot.phase;
  }

  function frame(time: number): void {
    if (!running || paused) return;
    frames += 1;

    const deltaMs = Math.max(0, time - lastTime);
    lastTime = time;
    const delta = Math.min(MAX_FRAME_DELTA, deltaMs / 1000);

    const level = quality.sample(deltaMs);
    if (level !== qualityLevel) {
      qualityLevel = level;
      scene.setQuality(level);
    }

    const snapshot = engine.update(delta);
    quality.setStriking(snapshot.phase === 'strike');
    if (rig.inspecting() && snapshot.phase !== 'setup') rig.setInspect(false);

    applySnapshot(rig, snapshot);
    animation.update(snapshot, delta);
    camera.applyPhase(snapshot.phase, snapshot.pose);
    camera.update(delta);

    const shake = animation.shake();
    scene.camera.position.set(
      scene.camera.position.x + shake.x,
      scene.camera.position.y + shake.y,
      scene.camera.position.z
    );

    announce(snapshot);
    hud.render(snapshot);
    scene.render();

    rafId = requestAnimationFrame(frame);
  }

  function onResize(): void {
    scene.resize(window.innerWidth, window.innerHeight);
  }

  function onVisibility(): void {
    paused = document.visibilityState === 'hidden';
    if (!paused && running) {
      // Skip the stalled interval instead of fast-forwarding the simulation.
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  const pointer: PointerController = createPointerController(canvas, {
    pelvisMove: (delta) => {
      pelvis = delta;
      engine.movePelvis(delta);
    },
    pelvisFlick: (direction) => {
      const boosted = { x: pelvis.x + direction.x * 0.34, y: pelvis.y + direction.y * 0.34 };
      pelvis = boosted;
      engine.movePelvis(boosted);
    },
    orbit: (delta) => camera.orbit({ x: delta.x * 0.4, y: delta.y * 0.2 }),
    zoom: (delta) => camera.zoom(delta)
  });

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  onResize();
  hud.render(engine.snapshot());
  rafId = requestAnimationFrame(frame);

  // Art loads in the background: the game is already playable without it.
  if (options.loadModels !== false) {
    const baseUrl = options.modelBaseUrl ?? `${import.meta.env.BASE_URL}models/`;
    void loadPoseModels({ baseUrl }).then((library) => {
      if (!running) return;
      models = library;
      applyModels();
    });
    void loadAttackClips({ baseUrl }).then((library) => {
      if (!running) return;
      clips = library;
      applyModels();
    });
  }

  return {
    snapshot: () => engine.snapshot(),
    authoredModelCount: () => (models?.count() ?? 0) + (clips?.count() ?? 0),
    movePelvis: (input: Vec2) => engine.movePelvis(input),
    frameCount: () => frames,
    simulationTime: () => engine.simulationTime(),
    sceneController: () => scene,
    destroy(): void {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      pointer.destroy();
      hud.destroy();
      animation.dispose();
      rig.dispose();
      scene.dispose();
      feedback.dispose();
      persist();
    }
  };
}

const appRoot = document.querySelector<HTMLElement>('#app');
if (appRoot) mountGame(appRoot);
