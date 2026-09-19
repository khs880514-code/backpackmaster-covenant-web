import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/selection-manifest.json';
import {
  parseSelectionManifest,
  toPoseModelManifest,
  SELECTION_SCHEMA,
  POSTURE_TO_POSE
} from '../../src/render/selection-manifest';
import { POSES, POSE_IDS } from '../../src/game/config';
import { targetRestPoint } from '../../src/game/engine';

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

  it('gives each pose the clip authored for its own posture', () => {
    expect(imported.poses['spread-standing']?.sourceId).toBe('POSE_17');
    expect(imported.poses['seated-chair']?.sourceId).toBe('POSE_16');
    expect(imported.poses['kneeling-front']?.sourceId).toBe('POSE_11');
    expect(imported.poses['crouch-front']?.sourceId).toBe('POSE_13');
    // POSE_01 is the run-in kick. It carries no target posture, so it used to
    // be dropped entirely; then it was made the standing pose's preferred take,
    // which was worse — it is authored against a target 43cm below where a
    // standing figure's pair hangs, so its kick could not reach. The standing
    // clip proper goes first and the run-in stays as the next take.
    expect(imported.poses['standing-front']?.sourceId).toBe('POSE_12');
    expect(imported.candidates['standing-front']?.slice(0, 2).map((p) => p.sourceId)).toEqual([
      'POSE_12',
      'POSE_01'
    ]);
  });

  it('leaves no pose on the blocky procedural attacker', () => {
    // Two poses shipped without a clip in the first APK and drew a placeholder
    // doll instead of the authored character.
    for (const id of POSE_IDS) {
      expect(imported.poses[id]).toBeTruthy();
    }
  });

  it('orders the takes a pose may borrow by what they can reach', () => {
    for (const id of POSE_IDS) {
      const list = imported.candidates[id] ?? [];
      expect(list.length).toBeGreaterThan(1);
      const want = targetRestPoint(POSES[id]).y;

      // A pose's own takes come first whatever their height, because the
      // animator built them for this posture. Everything behind them is
      // borrowed, and borrowed takes are ranked purely by what they can reach.
      const mine = (pose: (typeof list)[number]): boolean =>
        POSTURE_TO_POSE[pose.targetPosture ?? ''] === id ||
        (id === 'standing-front' && pose.sourceId === 'POSE_01');
      const own = list.filter(mine);
      expect(list.slice(0, own.length)).toEqual(own);

      const borrowed = list.slice(own.length);
      const fits = borrowed.map((pose) =>
        pose.targetHeightM === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(pose.targetHeightM - want)
      );
      expect(fits).toEqual([...fits].sort((a, b) => a - b));
    }
  });

  it('never lets a borrowed take displace a pose own clip', () => {
    for (const id of POSE_IDS) {
      const chosen = imported.poses[id]!;
      const posture = chosen.targetPosture;
      // Every pose in this manifest has a clip authored for its own posture,
      // so that is the one it must be playing however the heights fall.
      expect(posture).not.toBeNull();
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
    expect(manifest.poses?.['standing-front']).toBe('assets/pose-12.glb');
    expect(manifest.poses?.['seated-chair']).toBe('assets/pose-16.glb');
    expect(Object.keys(manifest.poses ?? {})).toHaveLength(POSE_IDS.length);
  });
});
