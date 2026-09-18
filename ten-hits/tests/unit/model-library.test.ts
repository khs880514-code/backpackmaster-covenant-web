import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { fitModel, loadPoseModels, type GltfSource } from '../../src/render/model-library';

function boxOf(object: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(object);
}

/** Stands in for an authored file: off-origin, wrong units, odd pivot. */
function authored(width = 4, height = 8, offset = new THREE.Vector3(12, -3, 7)): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, width));
  mesh.position.copy(offset);
  return mesh;
}

function manifestResponse(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body
  }) as unknown as typeof fetch;
}

function sourceFor(files: Record<string, THREE.Object3D>): GltfSource {
  return {
    load: async (url: string) => {
      const name = url.split('/').at(-1)!;
      const found = files[name];
      if (!found) throw new Error(`missing ${name}`);
      return found;
    }
  };
}

describe('fitModel', () => {
  it('scales an authored model to the requested height', () => {
    const fitted = fitModel(authored(4, 8), 1.8);
    const size = new THREE.Vector3();
    boxOf(fitted).getSize(size);
    expect(size.y).toBeCloseTo(1.8, 4);
  });

  it('grounds the model and centres it on the origin', () => {
    const box = boxOf(fitModel(authored(), 1.8));
    expect(box.min.y).toBeCloseTo(0, 4);
    const center = new THREE.Vector3();
    box.getCenter(center);
    expect(center.x).toBeCloseTo(0, 4);
    expect(center.z).toBeCloseTo(0, 4);
  });

  it('keeps proportions uniform', () => {
    const size = new THREE.Vector3();
    boxOf(fitModel(authored(4, 8), 1.8)).getSize(size);
    expect(size.x / size.y).toBeCloseTo(4 / 8, 4);
  });

  it('survives a degenerate model without producing NaN', () => {
    const flat = new THREE.Mesh(new THREE.BoxGeometry(1, 0, 1));
    const box = boxOf(fitModel(flat, 1.8));
    expect(Number.isNaN(box.min.y)).toBe(false);
  });
});

describe('loadPoseModels', () => {
  const manifest = {
    version: 1,
    playerHeight: 1.8,
    poses: {
      'standing-front': 'pose-01.glb',
      'kneeling-front': 'pose-04.glb'
    },
    attacker: 'pose-12.glb'
  };

  it('loads every pose the manifest names', async () => {
    const library = await loadPoseModels({
      fetchImpl: manifestResponse(manifest),
      source: sourceFor({
        'pose-01.glb': authored(),
        'pose-04.glb': authored(),
        'pose-12.glb': authored()
      })
    });
    expect(library.pose('standing-front')).toBeInstanceOf(THREE.Group);
    expect(library.pose('kneeling-front')).toBeInstanceOf(THREE.Group);
    expect(library.attacker()).toBeInstanceOf(THREE.Group);
    expect(library.count()).toBe(3);
  });

  it('leaves unlisted poses empty so they fall back to the built-in figure', async () => {
    const library = await loadPoseModels({
      fetchImpl: manifestResponse(manifest),
      source: sourceFor({ 'pose-01.glb': authored(), 'pose-04.glb': authored() })
    });
    expect(library.pose('crouch-front')).toBeNull();
  });

  it('normalizes loaded models to the manifest height', async () => {
    const library = await loadPoseModels({
      fetchImpl: manifestResponse({ ...manifest, playerHeight: 2.4 }),
      source: sourceFor({ 'pose-01.glb': authored(4, 8) })
    });
    const size = new THREE.Vector3();
    boxOf(library.pose('standing-front')!).getSize(size);
    expect(size.y).toBeCloseTo(2.4, 4);
  });

  it('returns an empty library when the manifest is missing', async () => {
    const library = await loadPoseModels({ fetchImpl: manifestResponse({}, false) });
    expect(library.count()).toBe(0);
    expect(library.pose('standing-front')).toBeNull();
  });

  it('returns an empty library when the manifest is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      }
    }) as unknown as typeof fetch;
    const library = await loadPoseModels({ fetchImpl });
    expect(library.count()).toBe(0);
  });

  it('returns an empty library when the network fails outright', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(loadPoseModels({ fetchImpl })).resolves.toBeDefined();
    expect((await loadPoseModels({ fetchImpl })).count()).toBe(0);
  });

  it('keeps the good files when one of them fails', async () => {
    const library = await loadPoseModels({
      fetchImpl: manifestResponse(manifest),
      source: sourceFor({ 'pose-01.glb': authored() })
    });
    expect(library.pose('standing-front')).toBeInstanceOf(THREE.Group);
    expect(library.pose('kneeling-front')).toBeNull();
    expect(library.attacker()).toBeNull();
    expect(library.count()).toBe(1);
  });

  it('refuses a path that tries to climb out of the model folder', async () => {
    const load = vi.fn();
    await loadPoseModels({
      fetchImpl: manifestResponse({
        version: 1,
        poses: { 'standing-front': '../../secrets.glb' },
        attacker: '../../secrets.glb'
      }),
      source: { load }
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('prefixes every request with the base url', async () => {
    const load = vi.fn().mockResolvedValue(authored());
    await loadPoseModels({
      baseUrl: 'assets/models/',
      fetchImpl: manifestResponse({ version: 1, poses: { 'standing-front': 'pose-01.glb' } }),
      source: { load }
    });
    expect(load).toHaveBeenCalledWith('assets/models/pose-01.glb');
  });
});
