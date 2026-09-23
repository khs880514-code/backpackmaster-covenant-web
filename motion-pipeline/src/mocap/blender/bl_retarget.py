"""Stage 5, inside Blender — cleaned joints onto an armature.

Run as::

    blender -b -P bl_retarget.py -- '{"motion": "...", "blend": "...", ...}'

The armature's rest pose is the take's own proportions and only rotations are
keyed, so the action can be dropped onto a character of a different size. If
`character` names a .blend with an armature whose bones carry our joint names,
the action is copied onto it instead of the generated stand-in.
"""

from __future__ import annotations

from pathlib import Path

import bpy  # type: ignore[import-not-found]

import sys as _sys
from pathlib import Path as _Path

# Blender's -P does not put the script's own directory on the path, so a
# sibling import fails no matter what the working directory is.
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

import bl_common as C


def link_character(path: str) -> bpy.types.Object | None:
    """Appends every armature and mesh from a character file."""
    source = Path(path)
    if not source.exists():
        raise SystemExit(f"scene.character points at {source}, which does not exist")
    with bpy.data.libraries.load(str(source), link=False) as (src, dst):
        dst.objects = list(src.objects)
    rig = None
    for obj in dst.objects:
        if obj is None:
            continue
        bpy.context.collection.objects.link(obj)
        if obj.type == "ARMATURE" and rig is None:
            rig = obj
    return rig


def copy_action(source: bpy.types.Object, target: bpy.types.Object) -> int:
    """Moves the keyed rotations across, by bone name. Returns bones matched."""
    if source.animation_data is None or source.animation_data.action is None:
        return 0
    action = source.animation_data.action
    if target.animation_data is None:
        target.animation_data_create()
    target.animation_data.action = action
    matched = sum(1 for bone in target.pose.bones if bone.name in source.pose.bones)
    for bone in target.pose.bones:
        if bone.name in source.pose.bones:
            bone.rotation_mode = "QUATERNION"
    return matched


def main() -> None:
    options = C.options()
    C.reset_scene()

    joints, fps = C.load_motion(options["motion"])
    rig = C.build_armature(joints, name=options.get("name", "Demonstrator"))
    frames = C.key_armature(rig, joints, fps)

    matched = 0
    character = options.get("character")
    if character:
        target = link_character(character)
        if target is None:
            raise SystemExit(f"no armature found in {character}")
        matched = copy_action(rig, target)
        if matched == 0:
            raise SystemExit(
                f"{Path(character).name} has an armature, but none of its bones are "
                "named like the pipeline's joints. See docs/troubleshooting.md, "
                "'retargeting onto your own character'."
            )
        rig.hide_viewport = rig.hide_render = True
    else:
        C.add_body(rig)

    if options.get("stand_in", True) and not character:
        C.ground()
        C.three_point_light()

    blend = Path(options["blend"])
    blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))

    export = options.get("export")
    if export:
        target = Path(export)
        target.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.object.select_all(action="SELECT")
        if target.suffix.lower() == ".glb":
            bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB")
        elif target.suffix.lower() == ".fbx":
            bpy.ops.export_scene.fbx(filepath=str(target), add_leaf_bones=False)
        else:
            raise SystemExit(f"cannot export {target.suffix}; use .glb or .fbx")

    print(f"RETARGET frames={frames} bones={len(rig.data.bones)} matched={matched}")


if __name__ == "__main__":
    main()
