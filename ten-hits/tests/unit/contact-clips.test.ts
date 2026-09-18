import { describe, expect, it } from 'vitest';
import { POSES, POSE_IDS } from '../../src/game/config';
import {
  CLIP_BY_POSE,
  CLIP_FILE,
  CLIP_TARGET_HEIGHT,
  CONTACT_GAIN,
  CONTACT_TAKES,
  contactClipKey,
  contactClipKeys,
  contactClipUrl
} from '../../src/audio/contact-clips';

describe('authored contact recordings', () => {
  it('covers every pose the game can start', () => {
    for (const pose of POSE_IDS) {
      expect(CLIP_BY_POSE[pose]).toBeTruthy();
      expect(CLIP_FILE[CLIP_BY_POSE[pose]]).toBeTruthy();
    }
  });

  it('borrows the take recorded closest to the pose anchor', () => {
    for (const pose of POSE_IDS) {
      const anchor = POSES[pose].anchorHeight;
      const chosen = CLIP_TARGET_HEIGHT[CLIP_BY_POSE[pose]] ?? Number.NaN;
      const best = Math.min(
        ...Object.values(CLIP_TARGET_HEIGHT).map((h) => Math.abs(h - anchor))
      );
      expect(Math.abs(chosen - anchor)).toBeCloseTo(best, 6);
    }
  });

  it('names one file per take, clamped to the takes that exist', () => {
    expect(contactClipKey('standing-front', 1)).toBe('pose_12-contact-01');
    expect(contactClipKey('standing-front', 2)).toBe('pose_12-contact-02');
    expect(contactClipKey('standing-front', 9)).toBe('pose_12-contact-02');
    expect(contactClipKey('standing-front', 0)).toBe('pose_12-contact-01');
    expect(contactClipKey('seated-chair', 1)).toBe('pose_04-contact-01');
  });

  it('lists each shared file once', () => {
    const keys = contactClipKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(4 * CONTACT_TAKES);
    for (const pose of POSE_IDS) {
      expect(keys).toContain(contactClipKey(pose, 1));
    }
  });

  it('gets louder with the grade and stays silent on a miss', () => {
    expect(CONTACT_GAIN.miss).toBe(0);
    expect(CONTACT_GAIN.graze).toBeLessThan(CONTACT_GAIN['single-compression']);
    expect(CONTACT_GAIN['single-compression']).toBeLessThan(
      CONTACT_GAIN['center-compression']
    );
    expect(CONTACT_GAIN['center-compression']).toBeLessThanOrEqual(1);
  });

  it('resolves a relative url the bundle can serve', () => {
    expect(contactClipUrl('pose_12-contact-01')).toBe('audio/pose_12-contact-01.wav');
  });
});
