import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import fixture from '../fixtures/selection-manifest.json';
import {
  alignToTargetGuide,
  clipTimeForPhase,
  hidePostureGuides,
  loadAttackClips
} from '../../src/render/attack-clips';
import { parseSelectionManifest } from '../../src/render/selection-manifest';

const timing = parseSelectionManifest(fixture)!.poses['standing-front']!.timing;

/** Mimics an authored file: an attacker plus offset posture-guide stand-ins. */
function authoredScene(): THREE.Group {
  const scene = new THREE.Group();
  const elf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.7, 0.3));
  elf.name = 'DarkElf_Visual';
  elf.position.set(0, 0.85, 0);
  scene.add(elf);

  for (const part of ['Pelvis', 'Chest', 'Head']) {
    const guide = new THREE.Mesh(new THREE.SphereGeometry(0.1));
    guide.name = `POSTURE_GUIDE_${part}`;
    guide.position.set(-0.333, 1.1, 0.68);
    scene.add(guide);
  }
  return scene;
}

describe('alignToTargetGuide', () => {
  it('moves the authored scene so the target guide sits on the origin', () => {
    const scene = authoredScene();
    expect(alignToTargetGuide(scene)).toBe(true);
    scene.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    scene.getObjectByName('POSTURE_GUIDE_Pelvis')!.getWorldPosition(world);
    expect(world.x).toBeCloseTo(0, 5);
    expect(world.z).toBeCloseTo(0, 5);
  });

  it('turns the attacker round to the game side of the target', () => {
    const scene = authoredScene();
    alignToTargetGuide(scene);
    scene.updateMatrixWorld(true);
    const elf = new THREE.Vector3();
    scene.getObjectByName('DarkElf_Visual')!.getWorldPosition(elf);
    // The authored 0.68 gap survives, but now on +Z where the camera looks.
    expect(elf.z).toBeCloseTo(0.68, 5);
    expect(elf.x).toBeCloseTo(-0.333, 5);
  });

  it('leaves the attacker facing the target it is kicking', () => {
    const scene = authoredScene();
    alignToTargetGuide(scene);
    expect(scene.rotation.y).toBeCloseTo(Math.PI, 5);
  });

  it('reports failure when there is no guide to align to', () => {
    expect(alignToTargetGuide(new THREE.Group())).toBe(false);
  });
});

describe('hidePostureGuides', () => {
  it('hides every stand-in and leaves the attacker visible', () => {
    const scene = authoredScene();
    expect(hidePostureGuides(scene)).toBe(3);
    expect(scene.getObjectByName('POSTURE_GUIDE_Pelvis')!.visible).toBe(false);
    expect(scene.getObjectByName('DarkElf_Visual')!.visible).toBe(true);
  });
});

describe('clipTimeForPhase', () => {
  const prep = timing.preparationFrames[0]! / timing.fps;
  const contact = timing.contactFrames[0]! / timing.fps;

  it('ends the telegraph exactly on the authored wind-up frame', () => {
    expect(clipTimeForPhase(timing, 'telegraph', 0)).toBeCloseTo(0, 5);
    expect(clipTimeForPhase(timing, 'telegraph', 1)).toBeCloseTo(prep, 5);
  });

  it('lands the strike exactly on the authored contact frame', () => {
    expect(clipTimeForPhase(timing, 'strike', 0)).toBeCloseTo(prep, 5);
    expect(clipTimeForPhase(timing, 'strike', 1)).toBeCloseTo(contact, 5);
    expect(clipTimeForPhase(timing, 'impact', 0.5)).toBeCloseTo(contact, 5);
  });

  it('advances monotonically through a whole attack', () => {
    const samples: number[] = [];
    for (const phase of ['telegraph', 'strike', 'recovery'] as const) {
      for (let i = 0; i <= 4; i += 1) samples.push(clipTimeForPhase(timing, phase, i / 4));
    }
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
  });

  it('clamps progress outside the unit interval', () => {
    expect(clipTimeForPhase(timing, 'strike', -5)).toBeCloseTo(prep, 5);
    expect(clipTimeForPhase(timing, 'strike', 9)).toBeCloseTo(contact, 5);
  });

  it('parks on the first frame outside an attack', () => {
    expect(clipTimeForPhase(timing, 'setup', 0.5)).toBe(0);
    expect(clipTimeForPhase(timing, 'won', 1)).toBe(0);
  });
});

describe('loadAttackClips', () => {
  const fetchOk = () =>
    vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }) as unknown as typeof fetch;

  it('loads a clip for every mapped pose and aligns it', async () => {
    const load = vi.fn(async () => ({
      scene: authoredScene(),
      animations: [new THREE.AnimationClip('Scene', 10, [])]
    }));
    const library = await loadAttackClips({ fetchImpl: fetchOk(), source: { load } });

    // Four postures with their own clip, spread-standing with POSE_17, and
    // braced-back borrowing the standing take.
    expect(library.count()).toBe(6);
    expect(library.get('spread-standing')?.sourceId).toBe('POSE_17');
    expect(library.get('braced-back')?.sourceId).toBe('POSE_01');
    const standing = library.get('standing-front')!;
    expect(standing.sourceId).toBe('POSE_01');
    expect(standing.animation?.name).toBe('Scene');
    expect(standing.scene.getObjectByName('POSTURE_GUIDE_Pelvis')!.visible).toBe(false);
    expect(load).toHaveBeenCalledWith('models/assets/pose-01.glb');
  });

  it('falls back to the next take when the preferred one is not delivered', async () => {
    // Only four of the twelve clips the manifest describes actually exist, so
    // a pose whose best take is missing has to use the one that is there.
    const load = vi.fn(async (url: string) => {
      if (url.includes('pose-01')) throw new Error('not delivered');
      return { scene: authoredScene(), animations: [] };
    });
    const library = await loadAttackClips({ fetchImpl: fetchOk(), source: { load } });
    expect(library.get('standing-front')?.sourceId).toBe('POSE_12');
    expect(load).toHaveBeenCalledWith('models/assets/pose-01.glb');
  });

  it('leaves a pose procedural only when every take fails', async () => {
    const load = vi.fn(async (url: string) => {
      if (url.includes('pose-01') || url.includes('pose-12')) throw new Error('bad file');
      return { scene: authoredScene(), animations: [] };
    });
    const library = await loadAttackClips({ fetchImpl: fetchOk(), source: { load } });
    expect(library.get('standing-front')).toBeNull();
    // braced-back borrows the standing take, so it goes with it.
    expect(library.get('braced-back')).toBeNull();
  });

  it('returns an empty library when the manifest is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const library = await loadAttackClips({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(library.count()).toBe(0);
  });
});

describe('clip follow-through', () => {
  const contact = timing.contactFrames[0]! / timing.fps;

  it('runs past the contact frame instead of freezing on it', () => {
    expect(clipTimeForPhase(timing, 'impact', 0, 0.2)).toBeCloseTo(contact, 5);
    expect(clipTimeForPhase(timing, 'impact', 1, 0.2)).toBeCloseTo(contact + 0.2, 5);
  });

  it('still freezes when there is no follow-through to run', () => {
    expect(clipTimeForPhase(timing, 'impact', 1)).toBeCloseTo(contact, 5);
  });

  it('starts the recovery from where the follow-through ended', () => {
    expect(clipTimeForPhase(timing, 'recovery', 0, 0.2)).toBeCloseTo(contact + 0.2, 5);
  });

  it('never runs the clip backwards across the contact', () => {
    const before = clipTimeForPhase(timing, 'strike', 1, 0.2);
    const during = clipTimeForPhase(timing, 'impact', 0.5, 0.2);
    const after = clipTimeForPhase(timing, 'recovery', 0, 0.2);
    expect(during).toBeGreaterThanOrEqual(before);
    expect(after).toBeGreaterThanOrEqual(during);
  });
});
