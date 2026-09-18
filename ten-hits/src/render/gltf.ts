import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * One configured loader for every authored asset.
 *
 * The shipped `.glb` files carry `EXT_meshopt_compression` — it is what keeps
 * them at roughly 40% of their authored size — so the decoder has to be
 * attached before anything will parse. Both live behind a dynamic import so
 * the loader and its decoder stay out of the first chunk.
 */
export async function createGltfLoader(): Promise<GLTFLoader> {
  const [{ GLTFLoader: Loader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js')
  ]);
  const loader = new Loader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
