import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POSE_IDS } from '../../src/game/config';
import { OUTFIT_IDS } from '../../src/render/wearables';
import { createHud } from '../../src/ui/hud';
import { createGameEngine } from '../../src/game/engine';
import type { GameSnapshot } from '../../src/game/types';

function root(): HTMLElement {
  document.body.innerHTML = '<div id="hud"></div>';
  return document.querySelector<HTMLElement>('#hud')!;
}

function snapshotAfter(seconds: number): GameSnapshot {
  const engine = createGameEngine({
    pose: 'standing-front',
    shoe: 'pump',
    power: 5,
    seed: 3
  });
  engine.start();
  let snapshot = engine.snapshot();
  for (let t = 0; t < seconds; t += 1 / 60) snapshot = engine.update(1 / 60);
  return snapshot;
}

describe('HUD', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = root();
  });

  it('exposes pose, shoe, and power controls in setup', () => {
    const hud = createHud(host, {});
    hud.render(snapshotAfter(0));
    expect(host.querySelectorAll('[data-pose-option]')).toHaveLength(POSE_IDS.length);
    expect(host.querySelectorAll('[data-shoe-option]')).toHaveLength(5);
    const power = host.querySelector<HTMLInputElement>('[data-power-input]')!;
    expect(power.min).toBe('1');
    expect(power.max).toBe('10');
  });

  it('reports the chosen setup through handlers', () => {
    const start = vi.fn();
    const hud = createHud(host, { onStart: start });
    hud.render(snapshotAfter(0));
    host.querySelectorAll<HTMLButtonElement>('[data-pose-option]')[1]!.click();
    host.querySelectorAll<HTMLButtonElement>('[data-shoe-option]')[4]!.click();
    host.querySelectorAll<HTMLButtonElement>('[data-outfit-option]')[1]!.click();
    host.querySelector<HTMLButtonElement>('[data-start]')!.click();
    expect(start).toHaveBeenCalledWith({
      pose: 'kneeling-front',
      shoe: 'platform',
      outfit: 'mini-stockings',
      power: expect.any(Number)
    });
  });

  it('offers an outfit for the attacker without changing what is judged', () => {
    const start = vi.fn();
    const hud = createHud(host, { onStart: start });
    hud.render(snapshotAfter(0));
    const options = host.querySelectorAll<HTMLButtonElement>('[data-outfit-option]');
    expect(options.length).toBe(OUTFIT_IDS.length);
    options[3]!.click();
    expect(options[3]!.getAttribute('aria-pressed')).toBe('true');
    host.querySelector<HTMLButtonElement>('[data-start]')!.click();
    // The engine is handed the same pose, shoe and power whatever she wears.
    expect(start.mock.calls[0]![0]).toMatchObject({ outfit: OUTFIT_IDS[3] });
  });

  it('shows exactly ten unlabelled progress dots during play', () => {
    const hud = createHud(host, {});
    hud.render(snapshotAfter(1.5));
    const dots = host.querySelectorAll('[data-hit-dot]');
    expect(dots).toHaveLength(10);
    for (const dot of dots) {
      expect(dot.textContent?.trim()).toBe('');
    }
  });

  it('never renders numeric durability anywhere', () => {
    const hud = createHud(host, {});
    const snapshot = snapshotAfter(6);
    hud.render(snapshot);
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/HP|hp\b/);
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it('describes proxy state with classes rather than numbers', () => {
    const hud = createHud(host, {});
    hud.render(snapshotAfter(6));
    const proxies = host.querySelectorAll('[data-proxy]');
    expect(proxies).toHaveLength(2);
    for (const proxy of proxies) {
      const stage = proxy.getAttribute('data-stage');
      expect(['normal', 'initial', 'damaged', 'critical', 'ruptured']).toContain(stage);
      expect(proxy.textContent?.trim()).toBe('');
    }
  });

  it('shows anger as a mood without a meter', () => {
    const hud = createHud(host, {});
    hud.render(snapshotAfter(6));
    const mood = host.querySelector('[data-anger]')!;
    expect(['calm', 'annoyed', 'irritated', 'furious', 'seething']).toContain(
      mood.getAttribute('data-mood')
    );
    expect(host.querySelector('progress')).toBeNull();
    expect(host.querySelector('meter')).toBeNull();
  });

  it('shows the result and the chosen conditions when the run ends', () => {
    const hud = createHud(host, {});
    const snapshot: GameSnapshot = {
      ...snapshotAfter(1),
      phase: 'won',
      result: 'survived'
    };
    hud.render(snapshot);
    const result = host.querySelector('[data-result]')!;
    expect(result.getAttribute('data-outcome')).toBe('survived');
    expect(result.textContent).toContain('pump');
  });

  it('exposes accessible toggles for sound, vibration, and shake', () => {
    const toggled = vi.fn();
    const hud = createHud(host, { onToggle: toggled });
    hud.render(snapshotAfter(0));
    const toggles = host.querySelectorAll<HTMLButtonElement>('[data-toggle]');
    expect(toggles).toHaveLength(3);
    toggles[0]!.click();
    expect(toggled).toHaveBeenCalled();
    for (const toggle of toggles) {
      expect(toggle.getAttribute('aria-pressed')).toMatch(/true|false/);
    }
  });

  it('keeps the start menu out of the way during play', () => {
    const hud = createHud(host, {});
    hud.render(snapshotAfter(1.5));
    expect(host.querySelector('[data-setup-panel]')!.getAttribute('hidden')).not.toBeNull();
  });

  it('is safe to render repeatedly without leaking nodes', () => {
    const hud = createHud(host, {});
    for (let i = 0; i < 5; i += 1) hud.render(snapshotAfter(1.5));
    expect(host.querySelectorAll('[data-hit-dot]')).toHaveLength(10);
  });
});

describe('HUD review controls', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = root();
  });

  it('offers a six-entry view menu', () => {
    const hud = createHud(host, {});
    hud.render(snapshotAfter(0));
    const views = host.querySelectorAll('[data-view-option]');
    expect(views).toHaveLength(6);
    expect([...views].map((node) => node.getAttribute('data-view-option'))).toEqual([
      'side',
      'front',
      'back',
      'top',
      'diagonal',
      'zoom'
    ]);
  });

  it('reports the chosen view and marks it active', () => {
    const onView = vi.fn();
    const hud = createHud(host, { onView });
    hud.render(snapshotAfter(0));
    const top = host.querySelector<HTMLButtonElement>('[data-view-option="top"]')!;
    top.click();
    expect(onView).toHaveBeenCalledWith('top');
    expect(top.getAttribute('aria-pressed')).toBe('true');
    expect(
      host.querySelector('[data-view-option="side"]')!.getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('exposes an inspect toggle that is separate from the feedback toggles', () => {
    const onInspect = vi.fn();
    const hud = createHud(host, { onInspect });
    hud.render(snapshotAfter(0));
    const inspect = host.querySelector<HTMLButtonElement>('[data-inspect]')!;
    expect(inspect.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelectorAll('[data-toggle]')).toHaveLength(3);

    inspect.click();
    expect(onInspect).toHaveBeenCalledWith(true);
    expect(inspect.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.hud')!.classList.contains('is-inspecting')).toBe(true);

    inspect.click();
    expect(onInspect).toHaveBeenLastCalledWith(false);
    expect(host.querySelector('.hud')!.classList.contains('is-inspecting')).toBe(false);
  });

  it('keeps the review menu out of an attack', () => {
    const hud = createHud(host, {});
    hud.render(snapshotAfter(1.5));
    expect(host.querySelector('[data-review-panel]')!.getAttribute('hidden')).not.toBeNull();
  });

  it('leaves inspection when a run starts', () => {
    const onInspect = vi.fn();
    const hud = createHud(host, { onInspect });
    hud.render(snapshotAfter(0));
    host.querySelector<HTMLButtonElement>('[data-inspect]')!.click();
    hud.render(snapshotAfter(1.5));
    expect(host.querySelector('.hud')!.classList.contains('is-inspecting')).toBe(false);
    expect(
      host.querySelector('[data-inspect]')!.getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('still prints no numbers with the review menu open', () => {
    const hud = createHud(host, {});
    hud.render(snapshotAfter(0));
    host.querySelector<HTMLButtonElement>('[data-inspect]')!.click();
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
  });
});
