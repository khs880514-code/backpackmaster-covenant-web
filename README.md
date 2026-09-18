# Backpack Master: Covenant

Browser-playable submission build for OpenAI Game Builders Seoul 2026.

Built with Godot. The game source remains in its separate private repository.

Latest browser build: 2026-08-10 final candidate. The 131,287,752-byte Godot
package is delivered as three versioned parts and verified in-browser against
SHA-256 `d7c0d1d7c915871a20c5cd81632a84a4a48469af1879a1c46580243aebb8347e`
before the game starts. The embedded Noto Sans KR font keeps both English and
Korean UI readable. The read-only all-weapon axis lab is available at `/site/`.

## TEN HITS (prototype)

A second, self-contained browser prototype lives in this repository. `TEN HITS`
is a mobile-first 3D survival game built with TypeScript, Vite, and Three.js:
the player must survive ten valid attacks by sliding two pendulum-like target
indicators out of direct compression and into safe grazing contact.

- Play: `/play/`
- Source: `ten-hits/`
- Design constraints: fictional adults, fully clothed, abstract translucent
  sphere indicators only, and damage shown as egg/rubber-ball proxy shapes.
  No numeric durability, percentage, or health bar is ever displayed.

### Working on it

```bash
cd ten-hits
npm install
npm run dev        # local dev server
npm run check      # unit tests, typecheck, production build
npm run test:e2e   # Chromium desktop, iPhone 12 Pro, and Fold portrait
```

`npm run build` writes the deployable site to `play/` at the repository root.
