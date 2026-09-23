"""Stage 8, inside Blender — one scene per (motion x partner preset).

The demonstrator is the captured take. The partner is a static pose placed at
a distance the preset decides. The cameras frame the pair, not the room.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy  # type: ignore[import-not-found]
import numpy as np
from mathutils import Euler, Vector  # type: ignore[import-not-found]

import sys as _sys
from pathlib import Path as _Path

# Blender's -P does not put the script's own directory on the path, so a
# sibling import fails no matter what the working directory is.
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

import bl_common as C


def place_partner(joints: np.ndarray, *, distance: float, facing: float, offset: float):
    """A static figure, turned and set down at `distance` in front of origin."""
    rig = C.build_armature(joints[None], name="Partner")
    C.add_body(rig, radius=0.05, colour=(0.74, 0.62, 0.56, 1.0))
    rig.location = Vector((offset, distance, 0.0))
    rig.rotation_euler = Euler((0.0, 0.0, math.radians(facing)), "XYZ")
    return rig


def add_camera(name: str, spec: dict, focus: Vector) -> bpy.types.Object:
    """One camera on a ring around the focus, at the preset's angle."""
    data = bpy.data.cameras.new(name)
    data.lens = float(spec.get("lens", 50.0))
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)

    yaw = math.radians(float(spec.get("yaw", 0.0)))
    pitch = math.radians(float(spec.get("pitch", 6.0)))
    distance = float(spec.get("distance", 4.2))
    height = focus.z + distance * math.sin(pitch)
    obj.location = Vector((
        focus.x + distance * math.cos(pitch) * math.sin(yaw),
        focus.y - distance * math.cos(pitch) * math.cos(yaw),
        height,
    ))

    target = bpy.data.objects.new(f"{name}_focus", None)
    target.location = focus
    target.empty_display_size = 0.12
    bpy.context.collection.objects.link(target)
    track = obj.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    return obj


def main() -> None:
    options = C.options()
    C.reset_scene()

    joints, fps = C.load_motion(options["motion"])
    demonstrator = C.build_armature(joints, name="Demonstrator")
    frames = C.key_armature(demonstrator, joints, fps)
    C.add_body(demonstrator)

    preset = options["preset"]
    partner_joints = np.asarray(preset["joints"], dtype=np.float64)
    partner = place_partner(
        C.to_blender(partner_joints[None])[0],
        distance=float(preset.get("distance", 1.1)),
        facing=float(preset.get("facing", 0.0)),
        offset=float(preset.get("offset", 0.0)),
    )

    C.ground(size=float(options.get("ground", 10.0)))
    C.three_point_light()

    # Everything points at the working height, halfway between the two.
    focus = Vector((
        partner.location.x * 0.5,
        partner.location.y * 0.5,
        float(preset.get("target_height", 0.9)),
    ))
    key_light = bpy.data.objects.get("Key")
    focus_empty = bpy.data.objects.new("Focus", None)
    focus_empty.location = focus
    bpy.context.collection.objects.link(focus_empty)
    C.aim_lights_at(focus_empty)

    cameras = {}
    for name, spec in options.get("cameras", {}).items():
        cameras[name] = add_camera(name, spec, focus).name
    if cameras:
        bpy.context.scene.camera = bpy.data.objects[next(iter(cameras.values()))]

    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, frames
    scene.render.fps = int(round(fps))

    blend = Path(options["blend"])
    blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))

    print("SCENE " + json.dumps({
        "frames": frames,
        "fps": fps,
        "cameras": sorted(cameras),
        "preset": preset.get("name"),
        "focus": [round(v, 3) for v in focus],
    }))


if __name__ == "__main__":
    main()
