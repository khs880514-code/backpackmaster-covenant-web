# Backpack Master: Covenant

Browser-playable submission build for OpenAI Game Builders Seoul 2026.

Built with Godot. The game source remains in its separate private repository.

Latest browser build: 2026-08-10 final candidate. The 131,287,752-byte Godot
package is delivered as three versioned parts and verified in-browser against
SHA-256 `d7c0d1d7c915871a20c5cd81632a84a4a48469af1879a1c46580243aebb8347e`
before the game starts. The embedded Noto Sans KR font keeps both English and
Korean UI readable. The read-only all-weapon axis lab is available at `/site/`.

## Render quality

The page renders the game into a canvas whose pixel resolution is chosen by the
shell, independently of the CSS size it is displayed at. By default it
supersamples (2x the display density where the pixel budget allows), which
removes most of the stair-stepping on sprite edges and UI text. It never
renders below the display's own pixel density, and if the browser cannot hold
roughly 45 FPS the extra supersampling is dropped automatically, back down to
that density.

Override it per visit with a query string; the choice is remembered afterwards:

| URL | Result |
| --- | --- |
| `?quality=low` | one render pixel per CSS pixel — the fastest option |
| `?quality=native` | follows the display density only (no supersampling) |
| `?quality=high` | default: supersamples up to 2x within the pixel budget |
| `?quality=ultra` | aims for 3x, still capped by the pixel budget |
| `?render_scale=1.75` | an explicit multiplier (0.5–4), no automatic fallback |

From the browser console, `set_render_scale('ultra')` changes it live and
`get_render_scale()` reports what is in use.
