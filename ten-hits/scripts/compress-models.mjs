#!/usr/bin/env node
/**
 * Squeezes the shipped glTF assets with EXT_meshopt_compression.
 *
 * Geometry, not texture, is what makes these files big: a pose clip carries
 * ~1.7MB of vertex buffers behind ~0.2MB of WebP. Meshopt quantizes and
 * entropy-codes those buffers, and the decoder ships inside `three` already,
 * so nothing extra has to be fetched at runtime.
 *
 * Usage: node scripts/compress-models.mjs [dir ...]   (default: public/models)
 *
 * Re-running is safe: a file that already declares the extension is skipped.
 */
import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (extname(path).toLowerCase() === '.glb') yield path;
  }
}

async function main() {
  const roots = process.argv.slice(2);
  const targets = roots.length > 0 ? roots : ['public/models'];

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([...KHRONOS_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  let before = 0;
  let after = 0;
  let skipped = 0;

  for (const root of targets) {
    for await (const file of walk(root)) {
      const size = (await stat(file)).size;
      const raw = await readFile(file);
      if (raw.includes(Buffer.from('EXT_meshopt_compression'))) {
        skipped += 1;
        before += size;
        after += size;
        continue;
      }

      const document = await io.readBinary(new Uint8Array(raw));
      await document.transform(
        dedup(),
        // 'medium' keeps the filters visually lossless on these meshes; the
        // authored normals and UVs survive the quantization unchanged.
        meshopt({ encoder: MeshoptEncoder, level: 'medium' })
      );
      const out = await io.writeBinary(document);
      await writeFile(file, out);

      before += size;
      after += out.byteLength;
      const pct = ((1 - out.byteLength / size) * 100).toFixed(0);
      console.log(
        `${file}  ${(size / 1048576).toFixed(2)}MB -> ${(out.byteLength / 1048576).toFixed(2)}MB  (-${pct}%)`
      );
    }
  }

  const pct = before > 0 ? ((1 - after / before) * 100).toFixed(0) : '0';
  console.log(
    `\ntotal ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB (-${pct}%), ${skipped} already compressed`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
