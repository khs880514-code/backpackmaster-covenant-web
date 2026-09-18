# Authored pose models

Drop `.glb` files here next to a `manifest.json` and the game uses them in
place of its procedural figures. Nothing here is required: with no manifest,
or with a file that fails to load, the game falls back to the built-in
capsule figures and plays exactly the same.

Copy `manifest.example.json` to `manifest.json` and point each pose id at the
file that should represent it:

| pose id | meaning |
| --- | --- |
| `standing-front` | 서서 정면 |
| `kneeling-front` | 무릎 정면 |
| `seated-chair` | ㄷ자 의자 |
| `spread-standing` | 대자 자세 |
| `crouch-front` | 웅크림 |
| `braced-back` | 뒤로 기댐 |

`attacker` is optional and names the model used for the attacking figure.

Every model is normalized on load: uniform-scaled to `playerHeight` world
units, centered on the x/z origin, and dropped so its lowest point rests at
`y = 0`. Authored pivots and units therefore do not need to match anything.

Files must be glTF 2.0 binary (`.glb`). Godot scenes (`.tscn`, `.tres`) and
Blender files (`.blend`) are not readable by the browser — export to glTF 2.0
first.
