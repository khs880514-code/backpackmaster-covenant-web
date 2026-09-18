export type FeedbackEvent =
  | 'warning'
  | 'graze'
  | 'compression'
  | 'critical'
  | 'rupture'
  | 'win'
  | 'select';

import type { ImpactGrade, PoseId } from '../game/types';
import {
  CONTACT_GAIN,
  CONTACT_TAKES,
  contactClipKey,
  contactClipKeys,
  contactClipUrl
} from './contact-clips';

export type FeedbackToggle = 'sound' | 'vibration' | 'shake';

export type VibrateFn = (pattern: number[]) => void;

export interface FeedbackOptions {
  createContext?: () => AudioContext;
  vibrate?: VibrateFn | null;
  /** Fetches one authored contact recording. Null disables them entirely. */
  loadClip?: ((url: string) => Promise<ArrayBuffer>) | null;
  /** Take picker, so a replay of the same seed hears the same takes. */
  random?: () => number;
  clipBase?: string;
}

export interface FeedbackController {
  unlock(): void;
  play(event: FeedbackEvent): void;
  /** Authored recording for this pose, or the synthesized cue as a fallback. */
  playContact(grade: ImpactGrade, pose: PoseId): void;
  /** How many recordings finished decoding. Zero means synth-only. */
  clipsReady(): number;
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

/** The synthesized stand-in for each grade, used until a clip has decoded. */
const CUE_BY_GRADE: Record<ImpactGrade, FeedbackEvent> = {
  miss: 'warning',
  graze: 'graze',
  'single-compression': 'compression',
  'center-compression': 'critical'
};

function defaultLoadClip(url: string): Promise<ArrayBuffer> {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`clip ${url} ${response.status}`);
    return response.arrayBuffer();
  });
}

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

  const loadClip =
    options.loadClip === undefined ? defaultLoadClip : options.loadClip;
  const random = options.random ?? Math.random;
  const clipBase = options.clipBase ?? 'audio/';

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  const clips = new Map<string, AudioBuffer>();
  let requested = false;

  /**
   * Decodes every authored take once the context exists. A clip that fails to
   * arrive simply leaves its grade on the synthesized cue.
   */
  function preloadClips(context: AudioContext): void {
    if (requested || !loadClip) return;
    requested = true;
    for (const key of contactClipKeys()) {
      void loadClip(contactClipUrl(key, clipBase))
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
          clips.set(key, buffer);
        })
        .catch(() => {
          // A missing recording is not a failure; the synth cue covers it.
        });
    }
  }

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

  function buzz(event: FeedbackEvent): void {
    if (!toggles.vibration || !vibrate) return;
    try {
      vibrate(PATTERNS[event]);
    } catch {
      // Vibration is advisory; browsers may refuse it at any time.
    }
  }

  function playCue(event: FeedbackEvent): void {
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

    buzz(event);
  }

  return {
    unlock(): void {
      if (ctx) {
        void ctx.resume?.();
        preloadClips(ctx);
        return;
      }
      try {
        ctx = createContext();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
        void ctx.resume?.();
        preloadClips(ctx);
      } catch {
        ctx = null;
        master = null;
      }
    },

    play: playCue,

    playContact(grade: ImpactGrade, pose: PoseId): void {
      const cue = CUE_BY_GRADE[grade];
      const take = Math.min(
        CONTACT_TAKES,
        1 + Math.floor(random() * CONTACT_TAKES)
      );
      const buffer = clips.get(contactClipKey(pose, take));

      if (!buffer || !toggles.sound || !ctx || CONTACT_GAIN[grade] <= 0) {
        playCue(cue);
        return;
      }

      try {
        const now = ctx.currentTime;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(CONTACT_GAIN[grade], now);
        source.connect(gain);
        gain.connect(master ?? ctx.destination);
        source.start(now);
      } catch {
        playCue(cue);
        return;
      }

      buzz(cue);
    },

    clipsReady(): number {
      return clips.size;
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
      clips.clear();
      requested = false;
    }
  };
}
