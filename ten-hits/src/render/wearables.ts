import * as THREE from 'three';
import { SHOE_IDS } from '../game/config';
import { createGltfLoader } from './gltf';
import type { ShoeId } from '../game/types';

/**
 * Loads the authored footwear and wardrobe sets on demand.
 *
 * They are fetched the first time one is worn rather than at start-up: a run
 * uses one pair of shoes and one outfit, and pulling all ten would cost several
 * megabytes to show two of them.
 */

export type OutfitId =
  | 'mini-bare'
  | 'mini-stockings'
  | 'nude-layered'
  | 'leggings'
  | 'suspender';

export const OUTFIT_IDS: OutfitId[] = [
  'mini-bare',
  'mini-stockings',
  'nude-layered',
  'leggings',
  'suspender'
];

/** Which authored export dresses each shoe the game already lets you pick. */
export const SHOE_FILE: Record<ShoeId, string> = {
  pump: 'FOOTWEAR_01.glb',
  strap: 'FOOTWEAR_02.glb',
  plateau: 'FOOTWEAR_04_WHITE.glb',
  stiletto: 'FOOTWEAR_05.glb',
  platform: 'FOOTWEAR_07.glb'
};

export const OUTFIT_FILE: Record<OutfitId, string> = {
  'mini-bare': '01-mini-bare.glb',
  'mini-stockings': '02-mini-stockings.glb',
  'nude-layered': '03-nude-layered.glb',
  leggings: '04-leggings.glb',
  suspender: '05-suspender.glb'
};

export const OUTFIT_LABEL: Record<OutfitId, string> = {
  'mini-bare': '미니',
  'mini-stockings': '스타킹',
  'nude-layered': '레이어드',
  leggings: '레깅스',
  suspender: '서스펜더'
};

export interface WearableSource {
  load(url: string): Promise<THREE.Object3D>;
}

export interface WearableLibrary {
  shoe(id: ShoeId): Promise<THREE.Object3D | null>;
  outfit(id: OutfitId): Promise<THREE.Object3D | null>;
}

export interface WearableOptions {
  baseUrl?: string;
  source?: WearableSource;
}

function defaultSource(): WearableSource {
  return {
    async load(url: string): Promise<THREE.Object3D> {
      const loader = await createGltfLoader();
      return (await loader.loadAsync(url)).scene;
    }
  };
}

export function isOutfitId(value: unknown): value is OutfitId {
  return typeof value === 'string' && OUTFIT_IDS.includes(value as OutfitId);
}

export function createWearables(options: WearableOptions = {}): WearableLibrary {
  const baseUrl = options.baseUrl ?? 'models/assets/';
  const source = options.source ?? defaultSource();
  const cache = new Map<string, Promise<THREE.Object3D | null>>();

  /** One in-flight request per file, and a failure never retries in a loop. */
  function fetchOnce(path: string): Promise<THREE.Object3D | null> {
    const existing = cache.get(path);
    if (existing) return existing;
    const pending = source
      .load(`${baseUrl}${path}`)
      .catch(() => null);
    cache.set(path, pending);
    return pending;
  }

  return {
    shoe(id: ShoeId): Promise<THREE.Object3D | null> {
      if (!SHOE_IDS.includes(id)) return Promise.resolve(null);
      return fetchOnce(`footwear/${SHOE_FILE[id]}`);
    },
    outfit(id: OutfitId): Promise<THREE.Object3D | null> {
      if (!OUTFIT_IDS.includes(id)) return Promise.resolve(null);
      return fetchOnce(`wardrobe/${OUTFIT_FILE[id]}`);
    }
  };
}
