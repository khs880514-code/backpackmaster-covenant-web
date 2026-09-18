import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createFeedback } from '../../src/audio/feedback';
import { contactClipKeys, contactClipUrl } from '../../src/audio/contact-clips';

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
}

function fakeAudioContext() {
  const created = { oscillators: 0, noise: 0 };
  const node = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: new FakeParam(),
    gain: new FakeParam(),
    Q: new FakeParam(),
    type: 'sine',
    buffer: null
  });
  return {
    created,
    ctx: {
      state: 'running' as AudioContextState,
      currentTime: 0,
      destination: {},
      sampleRate: 48000,
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      createOscillator: () => {
        created.oscillators += 1;
        return node();
      },
      createGain: () => node(),
      createBiquadFilter: () => node(),
      createBufferSource: () => {
        created.noise += 1;
        return node();
      },
      createBuffer: (_c: number, length: number) => ({
        getChannelData: () => new Float32Array(length)
      }),
      decodeAudioData: (data: ArrayBuffer) =>
        Promise.resolve({ duration: data.byteLength / 48000 } as AudioBuffer)
    } as unknown as AudioContext
  };
}

describe('feedback controller', () => {
  it('creates no oscillator while sound is muted', () => {
    const { ctx, created } = fakeAudioContext();
    const feedback = createFeedback({ createContext: () => ctx });
    feedback.setEnabled('sound', false);
    feedback.unlock();
    feedback.play('graze');
    expect(created.oscillators).toBe(0);
  });

  it('plays a cue for each impact grade once unlocked', () => {
    const { ctx, created } = fakeAudioContext();
    const feedback = createFeedback({ createContext: () => ctx });
    feedback.unlock();
    feedback.play('warning');
    feedback.play('graze');
    feedback.play('compression');
    feedback.play('critical');
    feedback.play('rupture');
    expect(created.oscillators).toBeGreaterThan(0);
  });

  it('stays silent until a user gesture unlocks audio', () => {
    const { ctx, created } = fakeAudioContext();
    const feedback = createFeedback({ createContext: () => ctx });
    feedback.play('graze');
    expect(created.oscillators).toBe(0);
  });

  it('does not throw when vibration is unsupported', () => {
    const feedback = createFeedback({ vibrate: null });
    feedback.unlock();
    expect(() => feedback.play('compression')).not.toThrow();
  });

  it('skips vibration when the toggle is off', () => {
    const vibrate = vi.fn();
    const feedback = createFeedback({ vibrate });
    feedback.unlock();
    feedback.setEnabled('vibration', false);
    feedback.play('compression');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('vibrates with a pattern for a strong contact', () => {
    const vibrate = vi.fn();
    const feedback = createFeedback({ vibrate });
    feedback.unlock();
    feedback.play('critical');
    expect(vibrate).toHaveBeenCalled();
    expect(Array.isArray(vibrate.mock.calls[0]![0])).toBe(true);
  });

  it('survives an audio context that refuses to be created', () => {
    const feedback = createFeedback({
      createContext: () => {
        throw new Error('no audio');
      }
    });
    expect(() => {
      feedback.unlock();
      feedback.play('graze');
    }).not.toThrow();
  });

  it('ships every recording the pose map asks for', () => {
    for (const key of contactClipKeys()) {
      const file = readFileSync(`public/${contactClipUrl(key)}`);
      expect(file.subarray(0, 4).toString('latin1')).toBe('RIFF');
      expect(file.byteLength).toBeGreaterThan(1024);
    }
  });

  it('plays the authored recording once it has decoded', async () => {
    const { ctx, created } = fakeAudioContext();
    const feedback = createFeedback({
      createContext: () => ctx,
      vibrate: null,
      loadClip: () => Promise.resolve(new ArrayBuffer(4800))
    });
    feedback.unlock();
    await vi.waitFor(() => expect(feedback.clipsReady()).toBe(8));
    created.oscillators = 0;
    created.noise = 0;
    feedback.playContact('center-compression', 'standing-front');
    expect(created.noise).toBe(1);
    expect(created.oscillators).toBe(0);
  });

  it('falls back to the synthesized cue when no recording arrives', async () => {
    const { ctx, created } = fakeAudioContext();
    const feedback = createFeedback({
      createContext: () => ctx,
      vibrate: null,
      loadClip: () => Promise.reject(new Error('offline'))
    });
    feedback.unlock();
    await vi.waitFor(() => expect(feedback.clipsReady()).toBe(0));
    feedback.playContact('graze', 'standing-front');
    expect(created.oscillators).toBe(1);
  });

  it('creates no source for a contact while sound is muted', async () => {
    const { ctx, created } = fakeAudioContext();
    const feedback = createFeedback({
      createContext: () => ctx,
      vibrate: null,
      loadClip: () => Promise.resolve(new ArrayBuffer(4800))
    });
    feedback.unlock();
    await vi.waitFor(() => expect(feedback.clipsReady()).toBe(8));
    feedback.setEnabled('sound', false);
    created.noise = 0;
    feedback.playContact('center-compression', 'standing-front');
    expect(created.noise).toBe(0);
    expect(created.oscillators).toBe(0);
  });

  it('still vibrates when a recording carries the contact', async () => {
    const { ctx } = fakeAudioContext();
    const vibrate = vi.fn();
    const feedback = createFeedback({
      createContext: () => ctx,
      vibrate,
      loadClip: () => Promise.resolve(new ArrayBuffer(4800))
    });
    feedback.unlock();
    await vi.waitFor(() => expect(feedback.clipsReady()).toBe(8));
    feedback.playContact('single-compression', 'kneeling-front');
    expect(vibrate).toHaveBeenCalled();
  });

  it('alternates takes as the picker moves', async () => {
    const { ctx } = fakeAudioContext();
    const picks: number[] = [0.1, 0.9];
    let index = 0;
    const urls: string[] = [];
    const feedback = createFeedback({
      createContext: () => ctx,
      vibrate: null,
      random: () => picks[index++ % picks.length]!,
      loadClip: (url: string) => {
        urls.push(url);
        return Promise.resolve(new ArrayBuffer(4800));
      }
    });
    feedback.unlock();
    await vi.waitFor(() => expect(feedback.clipsReady()).toBe(8));
    expect(urls).toContain('audio/pose_12-contact-01.wav');
    expect(urls).toContain('audio/pose_12-contact-02.wav');
    expect(() => {
      feedback.playContact('graze', 'standing-front');
      feedback.playContact('graze', 'standing-front');
    }).not.toThrow();
  });

  it('never requests a recording when clips are disabled', () => {
    const { ctx } = fakeAudioContext();
    const feedback = createFeedback({
      createContext: () => ctx,
      vibrate: null,
      loadClip: null
    });
    feedback.unlock();
    expect(feedback.clipsReady()).toBe(0);
  });

  it('reports toggle state back to callers', () => {
    const feedback = createFeedback({ vibrate: null });
    feedback.setEnabled('shake', false);
    expect(feedback.enabled('shake')).toBe(false);
    expect(feedback.enabled('sound')).toBe(true);
  });
});
