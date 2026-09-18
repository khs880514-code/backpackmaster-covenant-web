import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountGame } from '../../src/main';
import { SAVE_KEY } from '../../src/persistence/storage';

function fakeScene() {
  return {
    scene: { add: vi.fn(), remove: vi.fn() },
    camera: {
      position: { set: vi.fn(), x: 0, y: 0, z: 0 },
      aspect: 1,
      fov: 46,
      lookAt: vi.fn(),
      updateProjectionMatrix: vi.fn()
    },
    renderer: {},
    resize: vi.fn(),
    setQuality: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn()
  };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value)
  };
}

interface Harness {
  frames: Array<FrameRequestCallback>;
  advance(ms: number): void;
}

function frameHarness(): Harness {
  const frames: Array<FrameRequestCallback> = [];
  let time = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return {
    frames,
    advance(ms: number): void {
      time += ms;
      const pending = frames.splice(0, frames.length);
      for (const cb of pending) cb(time);
    }
  };
}

describe('mountGame', () => {
  let root: HTMLElement;
  let harness: Harness;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector<HTMLElement>('#app')!;
    harness = frameHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount(overrides: Record<string, unknown> = {}) {
    return mountGame(root, {
      createScene: fakeScene as never,
      storage: memoryStorage(),
      loadModels: false,
      feedback: {
        unlock: vi.fn(),
        play: vi.fn(),
        setEnabled: vi.fn(),
        enabled: () => true,
        dispose: vi.fn()
      } as never,
      ...overrides
    });
  }

  it('mounts the canvas, the HUD, and the setup menu', () => {
    const app = mount();
    expect(root.querySelector('[data-game-canvas]')).toBeTruthy();
    expect(root.querySelector('[data-game-hud]')).toBeTruthy();
    expect(root.querySelector('[data-setup-panel]')).toBeTruthy();
    app.destroy();
  });

  it('builds an engine that matches the start-menu selection', () => {
    const app = mount();
    root.querySelectorAll<HTMLButtonElement>('[data-pose-option]')[1]!.click();
    root.querySelectorAll<HTMLButtonElement>('[data-shoe-option]')[1]!.click();
    const power = root.querySelector<HTMLInputElement>('[data-power-input]')!;
    power.value = '7';
    root.querySelector<HTMLButtonElement>('[data-start]')!.click();
    harness.advance(16);
    const snapshot = app.snapshot();
    expect(snapshot.pose).toBe('kneeling-front');
    expect(snapshot.shoe).toBe('stiletto');
    expect(snapshot.power).toBe(7);
    app.destroy();
  });

  it('routes pointer movement into the engine', () => {
    const app = mount();
    root.querySelector<HTMLButtonElement>('[data-start]')!.click();
    app.movePelvis({ x: 0.6, y: 0 });
    harness.advance(32);
    expect(app.snapshot().anchor.x).toBeGreaterThan(0);
    app.destroy();
  });

  it('applies exactly one snapshot per animation frame', () => {
    const app = mount();
    root.querySelector<HTMLButtonElement>('[data-start]')!.click();
    const before = app.frameCount();
    harness.advance(16);
    harness.advance(16);
    expect(app.frameCount()).toBe(before + 2);
    app.destroy();
  });

  it('pauses while the document is hidden', () => {
    const app = mount();
    root.querySelector<HTMLButtonElement>('[data-start]')!.click();
    harness.advance(16);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden'
    });
    document.dispatchEvent(new Event('visibilitychange'));
    const before = app.simulationTime();
    harness.advance(500);
    expect(app.simulationTime()).toBe(before);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible'
    });
    document.dispatchEvent(new Event('visibilitychange'));
    app.destroy();
  });

  it('resizes the renderer and camera on window resize', () => {
    const app = mount();
    const resize = app.sceneController().resize as ReturnType<typeof vi.fn>;
    resize.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(resize).toHaveBeenCalled();
    app.destroy();
  });

  it('persists toggle changes and restores them on the next mount', () => {
    const storage = memoryStorage();
    const first = mount({ storage });
    root.querySelector<HTMLButtonElement>('[data-toggle="sound"]')!.click();
    first.destroy();
    expect(storage.getItem(SAVE_KEY)).toContain('"sound":false');

    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector<HTMLElement>('#app')!;
    const second = mount({ storage });
    expect(
      root.querySelector('[data-toggle="sound"]')!.getAttribute('aria-pressed')
    ).toBe('false');
    second.destroy();
  });

  it('shows a support message when the renderer cannot be created', () => {
    const app = mountGame(root, {
      createScene: () => {
        throw new Error('no webgl');
      },
      storage: memoryStorage()
    });
    expect(root.querySelector('[data-webgl-error]')).toBeTruthy();
    app.destroy();
  });

  it('removes its listeners on destroy', () => {
    const app = mount();
    const resize = app.sceneController().resize as ReturnType<typeof vi.fn>;
    app.destroy();
    resize.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(resize).not.toHaveBeenCalled();
  });
});

describe('mountGame authored models', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector<HTMLElement>('#app')!;
    frameHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('plays procedurally when no models are configured', () => {
    const app = mountGame(root, {
      createScene: fakeScene as never,
      storage: memoryStorage(),
      loadModels: false
    });
    expect(app.authoredModelCount()).toBe(0);
    expect(root.querySelector('[data-setup-panel]')).toBeTruthy();
    app.destroy();
  });

  it('never blocks startup on a model fetch that fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    );
    const app = mountGame(root, {
      createScene: fakeScene as never,
      storage: memoryStorage()
    });
    expect(root.querySelector('[data-start]')).toBeTruthy();
    await Promise.resolve();
    expect(app.authoredModelCount()).toBe(0);
    app.destroy();
  });
});
