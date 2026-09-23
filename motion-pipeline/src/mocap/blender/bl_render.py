"""Stage 9, inside Blender — a playblast to check, a render to keep.

Two passes because they answer different questions. The playblast is Workbench
at half size: it exists to tell you the framing is wrong before you spend an
hour finding out. The final is EEVEE with the lights on.
"""

from __future__ import annotations

import json
from pathlib import Path

import bpy  # type: ignore[import-not-found]

import sys as _sys
from pathlib import Path as _Path

# Blender's -P does not put the script's own directory on the path, so a
# sibling import fails no matter what the working directory is.
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

import bl_common as C


def configure(scene, *, engine: str, width: int, height: int, samples: int) -> None:
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False

    if engine == "workbench":
        scene.render.engine = "BLENDER_WORKBENCH"
        shading = scene.display.shading
        shading.light = "STUDIO"
        shading.color_type = "OBJECT"
        shading.show_shadows = True
        shading.show_cavity = True
    else:
        # EEVEE's identifier changed in 4.2; accept whichever this build has.
        for identifier in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            try:
                scene.render.engine = identifier
                break
            except TypeError:
                continue
        eevee = getattr(scene, "eevee", None)
        if eevee is not None:
            for attribute, value in (
                ("taa_render_samples", samples),
                ("use_gtao", True),
                ("use_soft_shadows", True),
                ("use_shadow_high_bitdepth", True),
            ):
                if hasattr(eevee, attribute):
                    setattr(eevee, attribute, value)


def main() -> None:
    options = C.options()
    bpy.ops.wm.open_mainfile(filepath=options["blend"])
    scene = bpy.context.scene

    camera_name = options["camera"]
    camera = bpy.data.objects.get(camera_name)
    if camera is None:
        available = ", ".join(o.name for o in bpy.data.objects if o.type == "CAMERA")
        raise SystemExit(f"no camera '{camera_name}' in the scene. Found: {available or 'none'}")
    scene.camera = camera

    quality = options.get("quality", "final")
    configure(
        scene,
        engine="workbench" if quality == "playblast" else "eevee",
        width=int(options.get("width", 1920)),
        height=int(options.get("height", 1080)),
        samples=int(options.get("samples", 32)),
    )

    frames = Path(options["frames"])
    frames.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(frames / "f_")

    step = int(options.get("step", 1))
    scene.frame_step = step
    bpy.ops.render.render(animation=True)

    written = sorted(frames.glob("f_*.png"))
    print("RENDER " + json.dumps({
        "camera": camera_name,
        "quality": quality,
        "frames": len(written),
        "size": [scene.render.resolution_x, scene.render.resolution_y],
        "engine": scene.render.engine,
    }))


if __name__ == "__main__":
    main()
