"""Helpers that run inside Blender.

Imported by every ``bl_*.py`` under ``blender -b -P``. Nothing here imports
the rest of the package: Blender ships its own Python and adding this project
to its path is one more thing to get wrong on somebody else's machine. The
only contract between the two sides is the ``.npz`` the pipeline writes.

Axes. This pipeline is Y-up with Z forward, because that is what the pose
literature uses. Blender is Z-up with -Y forward. The conversion happens on
the way in, once, in `to_blender`.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy  # type: ignore[import-not-found]
import numpy as np
from mathutils import Matrix, Vector  # type: ignore[import-not-found]

JOINT_NAMES = (
    "pelvis", "left_hip", "right_hip", "spine1", "left_knee", "right_knee",
    "spine2", "left_ankle", "right_ankle", "spine3", "left_foot", "right_foot",
    "neck", "left_collar", "right_collar", "head", "left_shoulder",
    "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
    "left_hand", "right_hand",
)
PARENTS = (-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19, 20, 21)
INDEX = {name: i for i, name in enumerate(JOINT_NAMES)}
BONES = tuple((p, c) for c, p in enumerate(PARENTS) if p >= 0)


def argv() -> list[str]:
    """Whatever came after ``--`` on the Blender command line."""
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def options() -> dict:
    """The JSON blob the pipeline passes as the single argument after ``--``."""
    args = argv()
    if not args:
        raise SystemExit("this script expects: blender -b -P script.py -- '<json>'")
    payload = args[0]
    if Path(payload).exists():
        payload = Path(payload).read_text(encoding="utf-8")
    return json.loads(payload)


def to_blender(joints: np.ndarray) -> np.ndarray:
    """Y-up Z-forward into Blender's Z-up -Y-forward, in metres."""
    out = np.empty_like(joints)
    out[..., 0] = joints[..., 0]
    out[..., 1] = -joints[..., 2]
    out[..., 2] = joints[..., 1]
    return out


def load_motion(npz_path: str | Path) -> tuple[np.ndarray, float]:
    """The cleaned joints, in Blender's axes, plus the frame rate."""
    source = Path(npz_path)
    with np.load(source) as data:
        if "joints3d" not in data.files:
            raise SystemExit(f"{source.name} has no joints3d array")
        joints = np.asarray(data["joints3d"], dtype=np.float64)
    sidecar = source.with_suffix(".json")
    fps = 30.0
    if sidecar.exists():
        fps = float(json.loads(sidecar.read_text(encoding="utf-8")).get("fps", 30.0))
    return to_blender(joints), fps


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def rest_lengths(joints: np.ndarray) -> np.ndarray:
    parent = joints[:, [b[0] for b in BONES], :]
    child = joints[:, [b[1] for b in BONES], :]
    return np.median(np.linalg.norm(child - parent, axis=-1), axis=0)


def build_armature(joints: np.ndarray, name: str = "Demonstrator") -> bpy.types.Object:
    """An armature whose rest pose is the take's first frame.

    Built from the motion rather than from a template, so the proportions are
    the subject's. Retargeting onto somebody else's character is a separate
    step; this one just has to be able to hold the motion.
    """
    armature = bpy.data.armatures.new(f"{name}Data")
    rig = bpy.data.objects.new(name, armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")

    rest = joints[0]
    edit_bones = {}
    for parent_index, child_index in BONES:
        bone = armature.edit_bones.new(JOINT_NAMES[child_index])
        bone.head = Vector(rest[parent_index])
        tail = Vector(rest[child_index])
        if (tail - bone.head).length < 1e-4:
            tail = bone.head + Vector((0.0, 0.0, 1e-3))
        bone.tail = tail
        edit_bones[child_index] = bone

    # Parent each bone to the one that ends where it starts.
    for parent_index, child_index in BONES:
        if parent_index in edit_bones:
            edit_bones[child_index].parent = edit_bones[parent_index]
            edit_bones[child_index].use_connect = False

    # A root bone so the whole figure can be placed in a scene without
    # touching the motion.
    root = armature.edit_bones.new("root")
    root.head = Vector((rest[0][0], rest[0][1], 0.0))
    root.tail = Vector((rest[0][0], rest[0][1], 0.2))
    for parent_index, child_index in BONES:
        if parent_index == 0 and edit_bones[child_index].parent is None:
            edit_bones[child_index].parent = root

    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def _aim(head: Vector, tail: Vector, up: Vector) -> Matrix:
    """A world matrix whose Y points head->tail, rolled toward `up`.

    Blender bones run along their own +Y; `Matrix.OrthoProjection` style
    construction here keeps the roll stable from frame to frame, which is what
    stops a limb spinning about its own axis between keys.
    """
    y = (tail - head)
    if y.length < 1e-6:
        y = Vector((0.0, 1.0, 0.0))
    y.normalize()
    z = up - y * up.dot(y)
    if z.length < 1e-6:
        fallback = Vector((1.0, 0.0, 0.0)) if abs(y.z) > 0.9 else Vector((0.0, 0.0, 1.0))
        z = fallback - y * fallback.dot(y)
    z.normalize()
    x = y.cross(z)
    return Matrix((
        (x.x, y.x, z.x, head.x),
        (x.y, y.y, z.y, head.y),
        (x.z, y.z, z.z, head.z),
        (0.0, 0.0, 0.0, 1.0),
    ))


def key_armature(rig: bpy.types.Object, joints: np.ndarray, fps: float) -> int:
    """Keys every bone from the joint positions, one frame at a time.

    The pipeline carries positions, not rotations, so each bone is aimed from
    its own joint at its child's. Parents are keyed before children and the
    view layer is updated between them, because a child's local rotation is
    only meaningful once its parent has moved.
    """
    scene = bpy.context.scene
    scene.render.fps = int(round(fps))
    scene.frame_start = 1
    scene.frame_end = int(joints.shape[0])

    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"

    # Shallowest first: a bone cannot be placed before the one it hangs from.
    depth = {0: 0}
    for child, parent in enumerate(PARENTS):
        if parent >= 0:
            depth[child] = depth.get(parent, 0) + 1
    ordered = sorted(BONES, key=lambda pair: depth[pair[1]])

    up = Vector((0.0, 0.0, 1.0))
    rest_pelvis = joints[0][0]
    root_rest = rig.data.bones["root"].matrix_local.copy() if "root" in rig.data.bones else None
    for frame in range(joints.shape[0]):
        scene.frame_set(frame + 1)
        pose = joints[frame]

        root = rig.pose.bones.get("root")
        if root is not None:
            # The root carries the translation; the rest is rotation, which is
            # what makes the take reusable when the figure is moved.
            #
            # Measured against the pelvis, not against the root's own head.
            # The root sits on the floor and the pelvis does not, so taking
            # the delta from the root's head leaves every bone in the chain
            # short by the hip height — which showed up as 43mm of drift in
            # the round-trip, largest at the end of the spine where the most
            # offsets had accumulated.
            # Through the world matrix, not `location`. A pose bone's
            # location is in its own rest space, and the root points up, so
            # assigning a world delta to it sends the figure sideways: the
            # rig translated by (0, 0.038, 0.011) for a delta of
            # (0, 0.011, -0.038), and every bone inherited that error.
            root.matrix = Matrix.Translation(
                Vector(pose[0]) - Vector(rest_pelvis)
            ) @ root_rest
            root.keyframe_insert("location")
            # Before any child is aimed: a bone's local rotation is solved
            # against where its parent currently is, and the root has just
            # moved.
            bpy.context.view_layer.update()

        for parent_index, child_index in ordered:
            bone = rig.pose.bones.get(JOINT_NAMES[child_index])
            if bone is None:
                continue
            bone.matrix = _aim(Vector(pose[parent_index]), Vector(pose[child_index]), up)
            # Rotation only. Assigning a world matrix also writes a local
            # translation, and keeping it would weld this take to this
            # skeleton — the point of retargeting is that the rotations carry
            # to a character with different proportions. Zeroing it also stops
            # the leftover from the last assignment persisting into playback,
            # which showed up as every bone sharing one 43mm offset.
            bone.location = (0.0, 0.0, 0.0)
            bpy.context.view_layer.update()
            bone.keyframe_insert("rotation_quaternion")

    bpy.ops.object.mode_set(mode="OBJECT")
    return int(joints.shape[0])


def add_body(rig: bpy.types.Object, radius: float = 0.055, colour=(0.62, 0.66, 0.74, 1.0)):
    """Something to look at: a capsule along every bone, parented to it.

    Not a character — a legible stand-in, so a demonstration reads as a person
    from the first render instead of after somebody models one. A real
    character is dropped in by pointing `scene.character` at a .blend.
    """
    material = bpy.data.materials.new("BodyMaterial")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = colour
        bsdf.inputs["Roughness"].default_value = 0.62

    made = []
    for bone in rig.data.bones:
        if bone.name == "root":
            continue
        length = max(bone.length, 1e-3)
        thickness = radius * (1.6 if bone.name in ("spine1", "spine2", "spine3") else 1.0)
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=thickness, depth=length)
        limb = bpy.context.active_object
        limb.name = f"seg_{bone.name}"
        limb.data.materials.append(material)
        # A cylinder stands along Z; a bone runs along Y.
        limb.matrix_world = Matrix.Identity(4)
        limb.rotation_euler = (math.radians(90.0), 0.0, 0.0)
        limb.location = (0.0, length / 2.0, 0.0)
        bpy.ops.object.transform_apply(location=True, rotation=True)

        limb.parent = rig
        limb.parent_type = "BONE"
        limb.parent_bone = bone.name
        # Bone parenting puts the child at the bone's tail; step back to the head.
        limb.matrix_parent_inverse = Matrix.Translation((0.0, -length, 0.0))
        made.append(limb)

    head = bpy.data.objects.get("seg_head")
    if head is not None:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=radius * 1.9, segments=16, ring_count=10)
        skull = bpy.context.active_object
        skull.name = "seg_skull"
        skull.data.materials.append(material)
        skull.parent = rig
        skull.parent_type = "BONE"
        skull.parent_bone = "head"
        made.append(skull)
    return made


def ground(size: float = 8.0) -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=size)
    plane = bpy.context.active_object
    plane.name = "Ground"
    material = bpy.data.materials.new("GroundMaterial")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.16, 0.17, 0.2, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.95
    plane.data.materials.append(material)
    return plane


def three_point_light() -> None:
    """Key, fill and rim. A demonstration is about silhouette, and one lamp
    puts half the body in shadow exactly where the technique is."""
    for name, location, energy, size in (
        ("Key", (2.6, -3.2, 3.4), 900.0, 2.4),
        ("Fill", (-3.0, -2.2, 2.0), 320.0, 3.2),
        ("Rim", (-1.2, 3.4, 3.0), 520.0, 2.0),
    ):
        lamp = bpy.data.lights.new(name, type="AREA")
        lamp.energy = energy
        lamp.size = size
        obj = bpy.data.objects.new(name, lamp)
        obj.location = location
        constraint = obj.constraints.new("TRACK_TO")
        constraint.track_axis = "TRACK_NEGATIVE_Z"
        constraint.up_axis = "UP_Y"
        bpy.context.collection.objects.link(obj)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.055, 0.07, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    bpy.context.scene.world = world


def aim_lights_at(target: bpy.types.Object) -> None:
    for name in ("Key", "Fill", "Rim"):
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        for constraint in obj.constraints:
            if constraint.type == "TRACK_TO":
                constraint.target = target
