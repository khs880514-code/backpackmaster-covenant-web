import { describe, expect, it } from 'vitest';
import { SAVE_KEY, defaultSave, loadSave, writeSave } from '../../src/persistence/storage';

function memoryStorage(seed?: string): Storage {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(SAVE_KEY, seed);
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value)
  };
}

describe('save data', () => {
  it('returns defaults for empty storage', () => {
    expect(loadSave(memoryStorage())).toEqual(defaultSave());
  });

  it('returns defaults for corrupted JSON', () => {
    expect(loadSave(memoryStorage('{not json'))).toEqual(defaultSave());
  });

  it('returns defaults for a mismatched schema version', () => {
    expect(loadSave(memoryStorage(JSON.stringify({ version: 99, settings: {} })))).toEqual(
      defaultSave()
    );
  });

  it('rejects values of the wrong type', () => {
    const hostile = JSON.stringify({
      version: 1,
      settings: { sound: 'yes', vibration: 1, shake: null },
      records: 'nope',
      lastSetup: { pose: 'flying', shoe: 'boot', power: 900 }
    });
    const save = loadSave(memoryStorage(hostile));
    expect(save.settings.sound).toBe(true);
    expect(save.lastSetup.pose).toBe('standing-front');
    expect(save.lastSetup.power).toBeLessThanOrEqual(10);
    expect(save.records).toEqual({});
  });

  it('round-trips a valid save', () => {
    const storage = memoryStorage();
    const save = defaultSave();
    save.settings.vibration = false;
    save.lastSetup = { pose: 'kneeling-front', shoe: 'stiletto', outfit: 'leggings', power: 7 };
    save.records['kneeling-front:stiletto'] = 7;
    save.bestNoMissRun = 9;
    writeSave(storage, save);
    expect(loadSave(storage)).toEqual(save);
  });

  it('never throws when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    } as unknown as Storage;
    expect(() => loadSave(broken)).not.toThrow();
    expect(loadSave(broken)).toEqual(defaultSave());
    expect(() => writeSave(broken, defaultSave())).not.toThrow();
  });
});
