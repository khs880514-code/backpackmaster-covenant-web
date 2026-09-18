import { describe, expect, it } from 'vitest';
import { mountShell } from '../../src/main';

describe('mountShell', () => {
  it('creates the canvas and HUD roots', () => {
    document.body.innerHTML = '<main id="app"></main>';
    const app = document.querySelector<HTMLElement>('#app')!;
    mountShell(app);
    expect(app.querySelector('[data-game-canvas]')).toBeTruthy();
    expect(app.querySelector('[data-game-hud]')).toBeTruthy();
  });
});
