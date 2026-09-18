export type FeedbackEvent =
  | 'warning'
  | 'graze'
  | 'compression'
  | 'critical'
  | 'rupture'
  | 'win'
  | 'select';

export type FeedbackToggle = 'sound' | 'vibration' | 'shake';

export type VibrateFn = (pattern: number[]) => void;

export interface FeedbackOptions {
  createContext?: () => AudioContext;
  vibrate?: VibrateFn | null;
}

export interface FeedbackController {
  unlock(): void;
  play(event: FeedbackEvent): void;
  setEnabled(toggle: FeedbackToggle, enabled: boolean): void;
  enabled(toggle: FeedbackToggle): boolean;
  dispose(): void;
}

interface CueSpec {
  frequency: number;
  endFrequency: number;
  duration: number;
  gain: number;
  type: OscillatorType;
  noise: boolean;
}

/** Abstract, non-graphic cues. Nothing here imitates a real-world sound. */
const CUES: Record<FeedbackEvent, CueSpec> = {
  warning: { frequency: 620, endFrequency: 880, duration: 0.14, gain: 0.1, type: 'triangle', noise: false },
  select: { frequency: 440, endFrequency: 520, duration: 0.07, gain: 0.08, type: 'sine', noise: false },
  graze: { frequency: 300, endFrequency: 220, duration: 0.12, gain: 0.12, type: 'sine', noise: true },
  compression: { frequency: 170, endFrequency: 90, duration: 0.2, gain: 0.2, type: 'sine', noise: true },
  critical: { frequency: 120, endFrequency: 58, duration: 0.3, gain: 0.26, type: 'sawtooth', noise: true },
  rupture: { frequency: 90, endFrequency: 40, duration: 0.42, gain: 0.24, type: 'triangle', noise: true },
  win: { frequency: 520, endFrequency: 780, duration: 0.34, gain: 0.16, type: 'sine', noise: false }
};

const PATTERNS: Record<FeedbackEvent, number[]> = {
  warning: [10],
  select: [6],
  graze: [10],
  compression: [18, 30, 18],
  critical: [26, 40, 26],
  rupture: [40, 60, 40, 60, 60],
  win: [20, 40, 20]
};

function defaultVibrate(): VibrateFn | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { vibrate?: (pattern: number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return null;
  return (pattern: number[]) => {
    nav.vibrate?.(pattern);
  };
}

/**
 * Synthesized audio and haptics. Nothing is created until a real user gesture
 * unlocks it, and every branch degrades quietly when a platform says no.
 */
export function createFeedback(options: FeedbackOptions = {}): FeedbackController {
  const toggles: Record<FeedbackToggle, boolean> = {
    sound: true,
    vibration: true,
    shake: true
  };

  const vibrate =
    options.vibrate === undefined ? defaultVibrate() : options.vibrate;
  const createContext =
    options.createContext ??
    ((): AudioContext => {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio unavailable');
      return new Ctor();
    });

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;

  function noiseBurst(context: AudioContext, spec: CueSpec, now: number): void {
    const length = Math.max(1, Math.floor(context.sampleRate * spec.duration * 0.5));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(spec.frequency * 3, now);
    const gain = context.createGain();
    gain.gain.setValueAtTime(spec.gain * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master ?? context.destination);
    source.start(now);
    source.stop(now + spec.duration);
  }

  return {
    unlock(): void {
      if (ctx) {
        void ctx.resume?.();
        return;
      }
      try {
        ctx = createContext();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
        void ctx.resume?.();
      } catch {
        ctx = null;
        master = null;
      }
    },

    play(event: FeedbackEvent): void {
      const spec = CUES[event];

      if (toggles.sound && ctx) {
        try {
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = spec.type;
          osc.frequency.setValueAtTime(spec.frequency, now);
          osc.frequency.exponentialRampToValueAtTime(
            Math.max(20, spec.endFrequency),
            now + spec.duration
          );
          gain.gain.setValueAtTime(spec.gain, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);
          osc.connect(gain);
          gain.connect(master ?? ctx.destination);
          osc.start(now);
          osc.stop(now + spec.duration);
          if (spec.noise) noiseBurst(ctx, spec, now);
        } catch {
          // A failed cue must never interrupt gameplay.
        }
      }

      if (toggles.vibration && vibrate) {
        try {
          vibrate(PATTERNS[event]);
        } catch {
          // Vibration is advisory; browsers may refuse it at any time.
        }
      }
    },

    setEnabled(toggle: FeedbackToggle, value: boolean): void {
      toggles[toggle] = value;
    },

    enabled(toggle: FeedbackToggle): boolean {
      return toggles[toggle];
    },

    dispose(): void {
      try {
        void ctx?.close?.();
      } catch {
        // Nothing to recover from when teardown fails.
      }
      ctx = null;
      master = null;
    }
  };
}
