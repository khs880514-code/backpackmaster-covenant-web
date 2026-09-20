import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCharacters, applySnapshot } from '../../src/render/characters';
import { createShoe } from '../../src/render/shoes';
import { createTargetOverlay } from '../../src/render/targets';
import { createGameEngine } from '../../src/game/engine';
import { POSES, POSE_IDS } from '../../src/game/config';
import type { ShoeId } from '../../src/game/types';

function countGeometry(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

describe('createCharacters', () => {
  it('exposes the named rig nodes the engine drives', () => {
    const rig = createCharacters('standing-front', 'pump');
    expect(rig.player).toBeInstanceOf(THREE.Object3D);
    expect(rig.attacker).toBeInstanceOf(THREE.Object3D);
    expect(rig.attackingFoot).toBeInstanceOf(THREE.Object3D);
    expect(rig.leftTarget).toBeInstanceOf(THREE.Object3D);
    expect(rig.rightTarget).toBeInstanceOf(THREE.Object3D);
  });

  it('builds two figures with clothing meshes', () => {
    const rig = createCharacters('standing-front', 'pump');
    expect(countGeometry(rig.player)).toBeGreaterThan(5);
    expect(countGeometry(rig.attacker)).toBeGreaterThan(5);
  });

  it('lowers the player silhouette when kneeling', () => {
    const standing = createCharacters('standing-front', 'pump');
    const kneeling = createCharacters('kneeling-front', 'pump');
    const boxOf = (o: THREE.Object3D): number =>
      new THREE.Box3().setFromObject(o).max.y;
    expect(boxOf(kneeling.player)).toBeLessThan(boxOf(standing.player));
  });

  it('keeps the target overlay translucent and separate from the body', () => {
    const rig = createCharacters('standing-front', 'pump');
    const mesh = rig.leftTarget.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(1);
  });
});

describe('createShoe', () => {
  const kinds: ShoeId[] = ['pump', 'stiletto', 'platform'];

  it('produces a non-empty group for every shoe', () => {
    for (const kind of kinds) {
      const group = createShoe(kind);
      expect(countGeometry(group)).toBeGreaterThan(0);
    }
  });

  it('gives every shoe a distinct silhouette', () => {
    const sizes = kinds.map((kind) => {
      const box = new THREE.Box3().setFromObject(createShoe(kind));
      const size = new THREE.Vector3();
      box.getSize(size);
      return `${size.x.toFixed(3)}|${size.y.toFixed(3)}|${size.z.toFixed(3)}`;
    });
    expect(new Set(sizes).size).toBe(kinds.length);
  });

  it('makes the platform sole thicker than the pump sole', () => {
    const height = (kind: ShoeId): number => {
      const box = new THREE.Box3().setFromObject(createShoe(kind));
      return box.max.y - box.min.y;
    };
    expect(height('platform')).toBeGreaterThan(height('pump'));
  });
});

describe('applySnapshot', () => {
  it('moves the overlay targets and the foot to snapshot positions', () => {
    const rig = createCharacters('standing-front', 'pump');
    const engine = createGameEngine({
      pose: 'standing-front',
      shoe: 'pump',
      power: 5,
      seed: 5
    });
    engine.start();
    const snapshot = engine.update(0.5);
    applySnapshot(rig, snapshot);
    expect(rig.leftTarget.position.x).toBeCloseTo(snapshot.proxies[0].position.x, 5);
    expect(rig.attackingFoot.position.z).toBeCloseTo(snapshot.foot.z, 5);
  });

  it('squashes and recolors a damaged proxy without numeric labels', () => {
    const rig = createCharacters('standing-front', 'pump');
    const overlay = createTargetOverlay();
    overlay.apply({
      side: 'left',
      stage: 'critical',
      colorStage: 3,
      squash: 0.8,
      cracking: 0.6,
      imprint: null,
      offset: { x: 0, y: 0, z: 0 },
      core: 0.5,
      position: { x: 0, y: 0 }
    });
    expect(overlay.group.scale.y).toBeLessThan(1);
    expect(overlay.group.scale.x).toBeGreaterThan(1);
    expect(rig.leftTarget.name).toBe('leftTarget');
  });
});

describe('pose variety and inspection', () => {
  it('gives every pose a distinct player silhouette height', () => {
    const heights = POSE_IDS.map((id) => {
      const rig = createCharacters(id, 'pump');
      return new THREE.Box3().setFromObject(rig.player).max.y.toFixed(3);
    });
    expect(new Set(heights).size).toBe(POSE_IDS.length);
  });

  it('places each pose overlay at that pose profile height', () => {
    for (const id of POSE_IDS) {
      const rig = createCharacters(id, 'pump');
      expect(rig.targetAnchor.position.y).toBeCloseTo(POSES[id].anchorHeight, 5);
    }
  });

  it('builds a seat prop only for the seated pose', () => {
    expect(createCharacters('seated-chair', 'pump').root.getObjectByName('seat')).toBeTruthy();
    expect(createCharacters('standing-front', 'pump').root.getObjectByName('seat')).toBeFalsy();
  });

  it('spreads the stance wider than the standing pose', () => {
    const width = (id: (typeof POSE_IDS)[number]): number => {
      const box = new THREE.Box3().setFromObject(createCharacters(id, 'pump').player);
      return box.max.x - box.min.x;
    };
    expect(width('spread-standing')).toBeGreaterThan(width('standing-front'));
  });

  it('hides the attacker and fades the body while inspecting', () => {
    const rig = createCharacters('standing-front', 'pump');
    const bodyMaterials = (): THREE.MeshStandardMaterial[] => {
      const found: THREE.MeshStandardMaterial[] = [];
      rig.player.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) found.push(mesh.material as THREE.MeshStandardMaterial);
      });
      return found;
    };

    expect(rig.attacker.visible).toBe(true);
    expect(bodyMaterials().every((m) => m.opacity === 1)).toBe(true);

    rig.setInspect(true);
    expect(rig.attacker.visible).toBe(false);
    expect(rig.attackingFoot.visible).toBe(false);
    expect(rig.attackerThigh.visible).toBe(false);
    expect(bodyMaterials().every((m) => m.transparent && m.opacity < 1)).toBe(true);
    // The abstract proxy must read louder, not quieter, while being reviewed.
    expect((rig.overlays.left.mesh.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(
      0.62
    );

    rig.setInspect(false);
    expect(rig.attacker.visible).toBe(true);
    expect(bodyMaterials().every((m) => m.opacity === 1)).toBe(true);
  });

  it('reports the inspection state', () => {
    const rig = createCharacters('standing-front', 'pump');
    expect(rig.inspecting()).toBe(false);
    rig.setInspect(true);
    expect(rig.inspecting()).toBe(true);
  });
});

describe('authored model swapping', () => {
  const authored = (): THREE.Group => {
    const group = new THREE.Group();
    group.name = 'authored-model';
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.8, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x884422 })
    );
    mesh.position.y = 0.9;
    group.add(mesh);
    return group;
  };

  it('hides the built-in figure once an authored model arrives', () => {
    const rig = createCharacters('standing-front', 'pump');
    expect(rig.usingAuthoredModel()).toBe(false);

    rig.applyPoseModel(authored());
    expect(rig.usingAuthoredModel()).toBe(true);
    expect(rig.proceduralPlayer.visible).toBe(false);
    expect(rig.player.getObjectByName('authored-model')).toBeTruthy();
  });

  it('restores the built-in figure when the model is cleared', () => {
    const rig = createCharacters('standing-front', 'pump');
    rig.applyPoseModel(authored());
    rig.applyPoseModel(null);
    expect(rig.usingAuthoredModel()).toBe(false);
    expect(rig.proceduralPlayer.visible).toBe(true);
    expect(rig.player.getObjectByName('authored-model')).toBeFalsy();
  });

  it('replaces a previous model instead of stacking them', () => {
    const rig = createCharacters('standing-front', 'pump');
    rig.applyPoseModel(authored());
    rig.applyPoseModel(authored());
    let count = 0;
    rig.player.traverse((node) => {
      if (node.name === 'authored-model') count += 1;
    });
    expect(count).toBe(1);
  });

  it('keeps the gameplay overlay above an authored model', () => {
    const rig = createCharacters('standing-front', 'pump');
    rig.applyPoseModel(authored());
    // The overlay lives on its own anchor, never inside the swapped figure.
    expect(rig.leftTarget.parent).toBe(rig.targetAnchor);
    expect(rig.player.getObjectByName('leftTarget')).toBeFalsy();
  });

  it('fades an authored model in review mode like the built-in figure', () => {
    const rig = createCharacters('standing-front', 'pump');
    const model = authored();
    rig.applyPoseModel(model);
    const material = (model.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(material.opacity).toBe(1);

    rig.setInspect(true);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(1);

    rig.setInspect(false);
    expect(material.opacity).toBe(1);
  });

  it('fades a model that arrives while review mode is already on', () => {
    const rig = createCharacters('standing-front', 'pump');
    rig.setInspect(true);
    const model = authored();
    rig.applyPoseModel(model);
    const material = (model.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(material.opacity).toBeLessThan(1);
  });
});

describe('authored attack clip playback', () => {
  /** A clip that slides a named node along x, so scrubbing is observable. */
  function clipScene(): { scene: THREE.Group; clip: THREE.AnimationClip } {
    const scene = new THREE.Group();
    const guide = new THREE.Mesh(new THREE.SphereGeometry(0.1));
    guide.name = 'POSTURE_GUIDE_Pelvis';
    scene.add(guide);

    const foot = new THREE.Object3D();
    foot.name = 'foot_R';
    scene.add(foot);

    const track = new THREE.VectorKeyframeTrack(
      'foot_R.position',
      [0, 10],
      [0, 0, 0, 10, 0, 0]
    );
    return { scene, clip: new THREE.AnimationClip('Scene', 10, [track]) };
  }

  function rigWithClip() {
    const rig = createCharacters('standing-front', 'pump');
    const { scene, clip } = clipScene();
    rig.applyAttackClip({
      poseId: 'standing-front',
      sourceId: 'POSE_12',
      scene,
      animation: clip,
      timing: {
        fps: 25,
        telegraphSeconds: 1,
        strikeSeconds: 0.24,
        recoverySeconds: 2,
        contactFrames: [50],
        preparationFrames: [25],
        startMode: 'STEP_IN'
      },
      alignment: null
    });
    return { rig, foot: scene.getObjectByName('foot_R')! };
  }

  it('reports that an authored attacker took over', () => {
    const { rig } = rigWithClip();
    expect(rig.usingAuthoredAttacker()).toBe(true);
    expect(rig.attacker.visible).toBe(false);
    expect(rig.attackingFoot.visible).toBe(false);
  });

  it('actually moves the rig when the clip is scrubbed', () => {
    const { rig, foot } = rigWithClip();
    rig.scrubAttackClip('telegraph', 0);
    expect(foot.position.x).toBeCloseTo(0, 4);

    rig.scrubAttackClip('telegraph', 1);
    // Wind-up frame 25 at 25 fps is one second in, a tenth of a ten-second clip.
    expect(foot.position.x).toBeCloseTo(1, 4);

    rig.scrubAttackClip('strike', 1);
    // Contact frame 50 is two seconds in.
    expect(foot.position.x).toBeCloseTo(2, 4);
  });

  it('advances the pose monotonically through an attack', () => {
    const { rig, foot } = rigWithClip();
    let previous = -Infinity;
    for (const phase of ['telegraph', 'strike', 'recovery'] as const) {
      for (let i = 0; i <= 4; i += 1) {
        rig.scrubAttackClip(phase, i / 4);
        expect(foot.position.x).toBeGreaterThanOrEqual(previous - 1e-6);
        previous = foot.position.x;
      }
    }
    expect(previous).toBeGreaterThan(2);
  });

  it('puts the procedural attacker back when the clip is cleared', () => {
    const { rig } = rigWithClip();
    rig.applyAttackClip(null);
    expect(rig.usingAuthoredAttacker()).toBe(false);
    expect(rig.attacker.visible).toBe(true);
  });
});

describe('fading an alpha-masked body', () => {
  it('lifts the alpha mask so a masked figure turns see-through, not invisible', () => {
    const rig = createCharacters('standing-front', 'pump');
    const masked = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 1.7, 0.3),
      new THREE.MeshStandardMaterial({ alphaTest: 0.5, transparent: false, opacity: 1 })
    );
    const model = new THREE.Group();
    model.add(masked);
    rig.applyPoseModel(model);

    const material = masked.material as THREE.MeshStandardMaterial;
    rig.setInspect(true);
    // Opacity below the mask threshold would discard every fragment.
    expect(material.opacity).toBeLessThan(0.5);
    expect(material.alphaTest).toBe(0);

    rig.setInspect(false);
    expect(material.alphaTest).toBe(0.5);
    expect(material.opacity).toBe(1);
  });
});

describe('aiming the authored kick', () => {
  /**
   * A two-bone leg with the authored joint names, hanging from a hip so the
   * whole chain starts out pointing straight down +/- nothing. Straight is the
   * configuration an aim solver has the most trouble with, so it is the one
   * worth testing from.
   */
  function legRig(standoff = 0): {
    rig: ReturnType<typeof createCharacters>;
    contact: () => THREE.Vector3;
  } {
    const scene = new THREE.Group();
    const hip = new THREE.Bone();
    hip.name = 'thigh.R';
    hip.position.set(0, 0.9, 1.2);
    const knee = new THREE.Bone();
    knee.name = 'shin.R';
    knee.position.set(0, -0.44, 0);
    const ankle = new THREE.Bone();
    ankle.name = 'foot.R';
    ankle.position.set(0, -0.44, 0);
    knee.add(ankle);
    hip.add(knee);
    scene.add(hip);

    const rig = createCharacters('standing-front', 'pump');
    rig.applyAttackClip({
      poseId: 'standing-front',
      sourceId: 'POSE_12',
      scene,
      animation: null,
      timing: {
        fps: 25,
        telegraphSeconds: 1,
        strikeSeconds: 0.24,
        recoverySeconds: 2,
        contactFrames: [50],
        preparationFrames: [25],
        startMode: 'STEP_IN'
      },
      alignment: {
        // Where this leg's contact sits when it hangs straight down: the
        // ankle at 0.02, plus however far off the bone the shoe strikes.
        landsAt: { x: 0, y: 0.02 + standoff, z: 1.2 },
        base: new THREE.Vector3(),
        travel: { x: 0, y: 0, z: -1 },
        standoff,
        sink: 0
      }
    });

    return {
      rig,
      contact: () => {
        scene.updateMatrixWorld(true);
        const at = new THREE.Vector3();
        ankle.getWorldPosition(at);
        return at.setY(at.y + standoff);
      }
    };
  }

  it('puts the contact on what the attack is aimed at', () => {
    const { rig, contact } = legRig();
    const aim = { x: 0.18, y: 0.5, z: 0.6 };
    rig.aimAttackClip(aim, 1);

    const at = contact();
    expect(at.x).toBeCloseTo(aim.x, 3);
    expect(at.y).toBeCloseTo(aim.y, 3);
    expect(at.z).toBeCloseTo(aim.z, 3);
  });

  it('bends the knee to reach a target the leg is too long for', () => {
    // The failure this was written for: an aim straight down the leg, nearer
    // than the leg is long. Turning both joints toward it changes nothing —
    // they are already pointing at it — so a solver that only turns them
    // stalls. Measured against the real clips it stalled 9.3cm out and stayed
    // there however many rounds it was given.
    const { rig, contact } = legRig();
    const aim = { x: 0, y: 0.34, z: 1.2 };
    rig.aimAttackClip(aim, 1);

    const at = contact();
    expect(at.distanceTo(new THREE.Vector3(aim.x, aim.y, aim.z))).toBeLessThan(0.002);
  });

  it('allows for the shoe striking off the bone that carries it', () => {
    const standoff = 0.035;
    const { rig, contact } = legRig(standoff);
    const aim = { x: 0.1, y: 0.4, z: 0.9 };
    rig.aimAttackClip(aim, 1);

    // The ankle sits below the contact by exactly the authored offset.
    expect(contact().y).toBeCloseTo(aim.y, 3);
  });

  it('gives the correction back as she recovers', () => {
    const { rig, contact } = legRig();
    const before = contact().clone();
    rig.aimAttackClip({ x: 0.18, y: 0.5, z: 0.6 }, 0);
    expect(contact().distanceTo(before)).toBeLessThan(1e-6);
  });
});

describe('coming apart while the shoe is still pressing', () => {
  function ruptured(depth: number) {
    return {
      side: 'left' as const,
      stage: 'ruptured' as const,
      colorStage: 4 as const,
      squash: 1,
      cracking: 1,
      core: 1,
      offset: { x: 0, y: 0, z: 0 },
      imprint: { x: 0, y: 0, z: -1, width: 0.2, depth },
      position: { x: 0, y: 0 }
    };
  }

  it('collapses as the dent deepens rather than the moment it is scored', () => {
    // It used to drop to its collapsed shape and colour on the first frame of
    // the impact, before the shoe that did it had finished arriving — so the
    // one hit worth watching was over before it could be seen.
    const overlay = createTargetOverlay();
    overlay.apply(ruptured(0));
    const standing = overlay.group.scale.y;

    overlay.apply(ruptured(0.3));
    const partway = overlay.group.scale.y;
    expect(partway).toBeLessThan(standing);

    overlay.apply(ruptured(1));
    expect(overlay.group.scale.y).toBeLessThan(partway);
  });

  it('never stands back up once it has gone', () => {
    const overlay = createTargetOverlay();
    overlay.apply(ruptured(1));
    const gone = overlay.group.scale.y;
    // The dent settles back toward the core afterwards; the collapse does not.
    overlay.apply(ruptured(0.1));
    expect(overlay.group.scale.y).toBeCloseTo(gone, 6);
  });
});

describe('coming down onto a target the kick was aimed above', () => {
  /** A figure with two legs: one that kicks and one she stands on. */
  function twoLegged(sink: number) {
    const scene = new THREE.Group();
    const bones: Record<string, THREE.Bone> = {};
    for (const side of ['R', 'L'] as const) {
      const hip = new THREE.Bone();
      hip.name = `thigh.${side}`;
      hip.position.set(side === 'R' ? 0.1 : -0.1, 0.9, 1.2);
      const knee = new THREE.Bone();
      knee.name = `shin.${side}`;
      // Not locked straight: a leg with no bend has no plane to bend in.
      knee.position.set(0, -0.42, 0.06);
      const ankle = new THREE.Bone();
      ankle.name = `foot.${side}`;
      ankle.position.set(0, -0.42, -0.06);
      knee.add(ankle);
      hip.add(knee);
      scene.add(hip);
      bones[`hip${side}`] = hip;
      bones[`ankle${side}`] = ankle;
    }

    const rig = createCharacters('standing-front', 'pump');
    rig.applyAttackClip({
      poseId: 'standing-front',
      sourceId: 'POSE_12',
      scene,
      animation: null,
      timing: {
        fps: 25,
        telegraphSeconds: 1,
        strikeSeconds: 0.24,
        recoverySeconds: 2,
        contactFrames: [50],
        preparationFrames: [25],
        startMode: 'STEP_IN'
      },
      alignment: {
        landsAt: { x: 0.1, y: 0.06 - sink, z: 1.2 },
        base: new THREE.Vector3(),
        travel: { x: 0, y: 0, z: -1 },
        standoff: 0,
        sink
      }
    });

    const at = (bone: THREE.Object3D): THREE.Vector3 => {
      scene.updateMatrixWorld(true);
      return bone.getWorldPosition(new THREE.Vector3());
    };
    return { rig, scene, standing: () => at(bones['ankleL']!), kicking: () => at(bones['ankleR']!) };
  }

  it('drops her hips and leaves the standing foot where it was', () => {
    // A clip authored against a higher target used to be reached by the
    // kicking leg alone, which held it tens of degrees off what the animator
    // drew for the whole strike. She comes down onto it instead, the way a
    // person kicks lower, and the standing knee takes it.
    const sink = 0.08;
    const { rig, scene, standing } = twoLegged(sink);
    const planted = standing().clone();

    rig.aimAttackClip({ x: 0.1, y: 0.06 - sink, z: 1.2 }, 1);
    expect(scene.position.y).toBeCloseTo(-sink, 6);
    expect(standing().distanceTo(planted)).toBeLessThan(0.002);
  });

  it('takes the drop up and gives it back with the attack', () => {
    const sink = 0.08;
    const { rig, scene } = twoLegged(sink);
    rig.aimAttackClip({ x: 0.1, y: 0.06 - sink, z: 1.2 }, 0);
    expect(scene.position.y).toBeCloseTo(0, 6);
    rig.aimAttackClip({ x: 0.1, y: 0.06 - sink, z: 1.2 }, 0.5);
    expect(scene.position.y).toBeCloseTo(-sink / 2, 6);
  });

  it('puts the kick on the target once she is down there', () => {
    const sink = 0.08;
    const aim = { x: 0.14, y: 0.06 - sink, z: 1.1 };
    const { rig, kicking } = twoLegged(sink);
    rig.aimAttackClip(aim, 1);
    const at = kicking();
    expect(at.distanceTo(new THREE.Vector3(aim.x, aim.y, aim.z))).toBeLessThan(0.003);
  });
});
