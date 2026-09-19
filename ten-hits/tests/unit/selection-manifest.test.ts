import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/selection-manifest.json';
import {
  parseSelectionManifest,
  toPoseModelManifest,
  BORROWED_CLIP,
  SELECTION_SCHEMA
} from '../../src/render/selection-manifest';
import { POSES, POSE_IDS } from '../../src/game/config';

/** The real authoring manifest, so the adapter is proven against actual data. */
const imported = parseSelectionManifest(fixture)!;

describe('parseSelectionManifest', () => {
  it('accepts the authoring pipeline manifest', () => {
    expect(fixture.schema).toBe(SELECTION_SCHEMA);
    expect(imported).not.toBeNull();
    expect(imported.revision).toBe('2026-09-16-common-material-footwear-r01');
  });

  it('reads the attacker rig and its strike chain', () => {
    expect(imported.character.id).toBe('DARK_ELF_UNIFIED_V11');
    expect(imported.character.bones).toBe(27);
    expect(imported.character.strikeChain).toEqual(['thigh.R', 'shin.R', 'foot.R']);
  });

  it('maps the four target postures that match a game pose', () => {
    // POSE_01 is the run-in kick and carries no target posture, so it used to
    // be dropped. It is the current take for the standing pose.
    expect(imported.poses['standing-front']?.sourceId).toBe('POSE_01');
    expect(imported.candidates['standing-front']?.map((p) => p.sourceId)).toEqual([
      'POSE_01',
      'POSE_12'
    ]);
    expect(imported.poses['spread-standing']?.sourceId).toBe('POSE_17');
    expect(imported.poses['seated-chair']?.sourceId).toBe('POSE_16');
    expect(imported.poses['kneeling-front']?.sourceId).toBe('POSE_11');
    expect(imported.poses['crouch-front']?.sourceId).toBe('POSE_13');
  });

  it('leaves no pose on the blocky procedural attacker', () => {
    // Two poses shipped without a clip in the first APK and drew a placeholder
    // doll instead of the authored character.
    for (const id of POSE_IDS) {
      expect(imported.poses[id]).toBeTruthy();
    }
  });

  it('keeps every authored clip close to the game pose anchor height', () => {
    for (const [id, pose] of Object.entries(imported.poses)) {
      // A borrowed clip was authored for a different posture, so this
      // invariant is the authored rows' to keep.
      if (id in BORROWED_CLIP) continue;
      // Some authored clips declare no target height; there is nothing to
      // check against for those.
      if (!pose!.targetHeightM) continue;
      const anchor = POSES[id as keyof typeof POSES].anchorHeight;
      expect(Math.abs(pose!.targetHeightM - anchor)).toBeLessThan(0.06);
    }
  });

  it('keeps a borrowed clip behind the pose own takes', () => {
    for (const [id, from] of Object.entries(BORROWED_CLIP)) {
      // A lender must not itself be borrowing, or the fallback is circular.
      expect(BORROWED_CLIP[from as keyof typeof BORROWED_CLIP]).toBeUndefined();
      const list = (imported.candidates[id as keyof typeof imported.candidates] ?? []).map(
        (pose) => pose.sourceId
      );
      const lent = (imported.candidates[from as keyof typeof imported.candidates] ?? []).map(
        (pose) => pose.sourceId
      );
      // The lender's takes sit at the very end, behind anything the pose owns.
      expect(list.slice(-lent.length)).toEqual(lent);
      // spread-standing has POSE_17 of its own, so the borrow must not displace it.
      if (list.length > lent.length) expect(list[0]).not.toBe(lent[0]);
    }
  });

  it('reports the postures that have no game pose yet', () => {
    // Every authored posture now has a game pose to land in.
    expect(imported.unmapped).toEqual([]);
  });

  it('splits an authored clip into telegraph, strike, and recovery', () => {
    const standing = imported.candidates['standing-front']!.find(
      (pose) => pose.sourceId === 'POSE_12'
    )!;
    expect(standing.timing.fps).toBe(25);
    expect(standing.timing.preparationFrames[0]).toBe(26);
    expect(standing.timing.contactFrames[0]).toBe(32);
    // 26 frames of wind-up, 6 frames to contact, then the rest is recovery.
    expect(standing.timing.telegraphSeconds).toBeCloseTo(1, 5);
    expect(standing.timing.strikeSeconds).toBeCloseTo(0.24, 5);
    expect(standing.timing.recoverySeconds).toBeCloseTo((258 - 32) / 25, 5);
  });

  it('gives every mapped pose usable positive phase durations', () => {
    for (const pose of Object.values(imported.poses)) {
      expect(pose!.timing.strikeSeconds).toBeGreaterThan(0);
      expect(pose!.timing.telegraphSeconds).toBeGreaterThan(0);
      expect(pose!.timing.recoverySeconds).toBeGreaterThan(0);
    }
  });

  it('collects the five footwear sources', () => {
    expect(imported.footwear).toHaveLength(5);
    expect(imported.footwear.map((f) => f.id)).toContain('FOOTWEAR_01');
    for (const shoe of imported.footwear) {
      expect(shoe.asset.startsWith('assets/footwear/')).toBe(true);
      expect(shoe.sha256).toHaveLength(64);
    }
  });

  it('surfaces the stale-export warning the pipeline recorded', () => {
    expect(imported.warnings).toContain(
      'POSE_01: source changed after the glTF was exported'
    );
  });

  it('rejects a payload from a different schema', () => {
    expect(parseSelectionManifest({ schema: 'something-else', poses: {} })).toBeNull();
    expect(parseSelectionManifest(null)).toBeNull();
    expect(parseSelectionManifest('nope')).toBeNull();
  });

  it('refuses an asset path that escapes the project folder', () => {
    const hostile = parseSelectionManifest({
      schema: SELECTION_SCHEMA,
      poses: {
        POSE_99: { asset: '../../etc/passwd', target_posture: 'STANDING_BRACED' }
      },
      footwear_presets: [{ id: 'X', asset: '/etc/passwd' }]
    })!;
    expect(hostile.poses['standing-front']).toBeUndefined();
    expect(hostile.footwear).toHaveLength(0);
  });
});

describe('toPoseModelManifest', () => {
  it('projects the import onto the loader manifest shape', () => {
    const manifest = toPoseModelManifest(imported);
    expect(manifest.version).toBe(1);
    expect(manifest.poses?.['standing-front']).toBe('assets/pose-01.glb');
    expect(manifest.poses?.['seated-chair']).toBe('assets/pose-16.glb');
    expect(Object.keys(manifest.poses ?? {})).toHaveLength(POSE_IDS.length);
  });
});
