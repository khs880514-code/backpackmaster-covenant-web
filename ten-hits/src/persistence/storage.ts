import { MAX_POWER, MIN_POWER, isPoseId, isShoeId } from '../game/config';
import type { PoseId, ShoeId } from '../game/types';

export const SAVE_KEY = 'ten-hits-save-v1';
export const SAVE_VERSION = 1;

export interface SaveSettings {
  sound: boolean;
  vibration: boolean;
  shake: boolean;
}

export interface SaveSetup {
  pose: PoseId;
  shoe: ShoeId;
  power: number;
}

export interface SaveData {
  version: number;
  settings: SaveSettings;
  /** Highest cleared power per `pose:shoe` combination. */
  records: Record<string, number>;
  lastSetup: SaveSetup;
  bestNoMissRun: number;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: { sound: true, vibration: true, shake: true },
    records: {},
    lastSetup: { pose: 'standing-front', shoe: 'pump', power: 4 },
    bestNoMissRun: 0
  };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampPower(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MIN_POWER;
  return Math.min(MAX_POWER, Math.max(MIN_POWER, Math.round(value)));
}

function readRecords(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[key] = Math.min(MAX_POWER, Math.max(0, Math.round(raw)));
    }
  }
  return out;
}

/**
 * Reads persisted state defensively. Any missing, malformed, or hostile value
 * falls back to the default so a bad entry can never break a fresh run.
 */
export function loadSave(storage: Storage): SaveData {
  const fallback = defaultSave();
  let raw: string | null = null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return fallback;
  }
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback;

  const data = parsed as Record<string, unknown>;
  if (data['version'] !== SAVE_VERSION) return fallback;

  const settings = (data['settings'] ?? {}) as Record<string, unknown>;
  const setup = (data['lastSetup'] ?? {}) as Record<string, unknown>;
  const best = data['bestNoMissRun'];

  return {
    version: SAVE_VERSION,
    settings: {
      sound: bool(settings['sound'], fallback.settings.sound),
      vibration: bool(settings['vibration'], fallback.settings.vibration),
      shake: bool(settings['shake'], fallback.settings.shake)
    },
    records: readRecords(data['records']),
    lastSetup: {
      pose: isPoseId(setup['pose']) ? setup['pose'] : fallback.lastSetup.pose,
      shoe: isShoeId(setup['shoe']) ? setup['shoe'] : fallback.lastSetup.shoe,
      power: clampPower(setup['power'])
    },
    bestNoMissRun:
      typeof best === 'number' && Number.isFinite(best) ? Math.max(0, Math.round(best)) : 0
  };
}

export function writeSave(storage: Storage, save: SaveData): void {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ ...save, version: SAVE_VERSION }));
  } catch {
    // Private-mode and quota failures are not worth interrupting a run for.
  }
}

export function recordKey(pose: PoseId, shoe: ShoeId): string {
  return `${pose}:${shoe}`;
}
