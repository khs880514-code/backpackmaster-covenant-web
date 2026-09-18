import './styles.css';

export function mountShell(root: HTMLElement): HTMLElement {
  root.innerHTML = `
    <canvas data-game-canvas aria-label="TEN HITS 3D game"></canvas>
    <section data-game-hud aria-live="polite"></section>
  `;
  return root;
}

const shellRoot = document.querySelector<HTMLElement>('#app');
if (shellRoot) mountShell(shellRoot);
