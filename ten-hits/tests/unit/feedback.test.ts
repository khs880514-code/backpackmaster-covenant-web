import { describe, expect, it, vi } from 'vitest';
import { createFeedback } from '../../src/audio/feedback';

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
      })
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

  it('reports toggle state back to callers', () => {
    const feedback = createFeedback({ vibrate: null });
    feedback.setEnabled('shake', false);
    expect(feedback.enabled('shake')).toBe(false);
    expect(feedback.enabled('sound')).toBe(true);
  });
});
