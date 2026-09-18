# Authored models

The game ships with procedural capsule figures and plays fine without anything
here. Files in this folder upgrade the attacker; if one is missing or fails to
load, that pose simply stays procedural.

## What is in here

`selection-manifest.json` is the authoring pipeline's own
`impact-shift.godot-playable-selection.v1` file, trimmed to the poses the web
build ships. Each entry is an **attack clip**: a rigged attacker plus the kick
authored for the posture the player is in. `src/render/selection-manifest.ts`
reads it directly, so nothing is maintained by hand.

| authored target posture | game pose | clip |
| --- | --- | --- |
| `STANDING_BRACED` | `standing-front` | `pose-12.glb` |
| `UPRIGHT_KNEELING` | `kneeling-front` | `pose-11.glb` |
| `SEATED_APERTURE` | `seated-chair` | `pose-16.glb` |
| `KNEELING_LOW` | `crouch-front` | `pose-13.glb` |

`manifest.json` is this loader's own simpler format and describes authored
**player** figures. There are none yet, so it is empty.

## Preparing new exports

Raw pipeline exports are not shipped as-is. Run them through:

```bash
node scripts/prepare-models.mjs <export-dir> public/models/assets
```

That does two things:

1. **Removes the anatomical target subtree** (`LATEST_MEDICAL_*_ROOT` and its
   `MED_*` meshes). TEN HITS renders its target as two abstract proxy spheres
   by design, so this geometry is never displayed — and it is 82% of every
   file.
2. **Downscales textures** to 1K WebP. The authoring textures are 2K PNGs,
   which is more than a stylized game at phone size can use.

Together these take a pose export from about 10 MB to about 2 MB.

## How a clip is placed and played

- The authoring files put the attacker on -Z and the receiving figure on +Z;
  the game is laid out the other way round. `alignToTargetGuide` turns the
  scene halfway round and slides it until `POSTURE_GUIDE_Pelvis` sits on the
  origin, which is where the player stands.
- The authored `POSTURE_GUIDE_*` stand-ins are hidden: the game animates its
  own player, which moves under player input.
- The engine keeps owning the pacing. Power and anger still decide how long
  each phase lasts, and `clipTimeForPhase` resamples the clip onto that
  schedule so the telegraph still ends on the authored wind-up frame and the
  strike still lands on the authored contact frame.

## Damage response

The authoring pipeline's `target_response` block is a set of numbers and rules,
not geometry, so it transfers to the game's abstract proxies directly. What the
game already did, and what was adopted from it:

| authored rule | in the game |
| --- | --- |
| `states: [S0, S1, S2, S3]` | five colour stages, the last being a collapsed proxy |
| `independent_sides: true` | left and right proxies carry separate state |
| `persistent_across_modes: true` | damage persists for the whole run |
| `playback_rate_affects_damage: false` | fixed timestep; damage comes from the grade, never from frame time |
| `miss_response`: nothing moves before a contact registers | a miss returns both proxies unchanged and produces no flinch |
| retained dents | `permanent` never recovers; only `reversible` springs back |
| `S3` stays collapsed, no tear geometry | the ruptured stage desaturates and shrinks; nothing is torn |
| `body_damage_enabled: false` | only the proxies ever take damage |
| `deformation_depth_multiplier: 1.12` | **adopted** in `squashFactor` |
| `all_fours_body_flinch` curve | **adopted** in `flinchImpulse`, applied to the whole figure |

Nothing from `anatomical_pose_presets`, `LATEST_MEDICAL_*_ROOT` or the
`medical_phantom_*` materials is used. The target the player sees and the target
the contact test measures are both the abstract proxy pair.
