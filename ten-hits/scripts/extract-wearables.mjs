#!/usr/bin/env node
/**
 * Keeps only the wearable meshes out of an authored dressing file.
 *
 * Every footwear and wardrobe export carries the whole character so the artist
 * can see the fit: `Elf_Authored_LowerBody` alone is 66k-154k triangles, next
 * to 9k-113k for the shoes themselves. The game already has its own body, so
 * shipping theirs again would cost megabytes to draw something invisible.
 *
 * Usage: node scripts/extract-wearables.mjs --mode=<footwear|wardrobe> <dir> [...]
 * Rewrites each .glb in place.
 *
 * The two modes exist because the authored naming splits the other way for
 * each. A footwear export calls the shoe `Elf_Fitted_*` or `Wearable_*` and
 * everything else is body. A wardrobe export names each garment for what it is
 * — `Black_leggings`, `Suspender_1_front`, `Dress stitched hem_bound` — and
 * carries the same `Wearable_*` shoes as a fitting reference. So footwear keeps
 * that one pattern and wardrobe drops it, along with the body.
 */
import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const SHOE = /^(Elf_Fitted|Wearable)_/;
/** The authored character's own body, which the game already has its own of. */
const BODY = /^(DarkElf_UpperOriginal|Elf_Authored_LowerBody)$/;

function keeper(mode) {
  if (mode === 'footwear') return (name) => SHOE.test(name);
  return (name) => !SHOE.test(name) && !BODY.test(name);
}

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.slice('--mode='.length) : '';
  const dirs = args.filter((a) => !a.startsWith('--'));
  if (dirs.length === 0 || (mode !== 'footwear' && mode !== 'wardrobe')) {
    console.error('usage: node scripts/extract-wearables.mjs --mode=<footwear|wardrobe> <dir> [...]');
    process.exitCode = 1;
    return;
  }
  const keep = keeper(mode);

  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([...KHRONOS_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder
    });

  let before = 0;
  let after = 0;

  for (const dir of dirs) {
    for (const name of await readdir(dir)) {
      if (extname(name).toLowerCase() !== '.glb') continue;
      const file = join(dir, name);
      const size = (await stat(file)).size;
      const document = await io.readBinary(new Uint8Array(await readFile(file)));

      const kept = [];
      const dropped = [];
      for (const node of document.getRoot().listNodes()) {
        if (!node.getMesh()) continue;
        if (keep(node.getName())) kept.push(node.getName());
        else dropped.push(node.getName());
      }

      if (kept.length === 0) {
        console.warn(`${file}: nothing matched for mode ${mode}, left untouched`);
        before += size;
        after += size;
        continue;
      }

      for (const node of document.getRoot().listNodes()) {
        if (node.getMesh() && !keep(node.getName())) node.setMesh(null);
      }

      await document.transform(
        // With the body detached, prune takes its meshes, materials and the
        // textures only it referenced.
        prune(),
        dedup(),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' })
      );

      const out = await io.writeBinary(document);
      await writeFile(file, out);
      before += size;
      after += out.byteLength;
      console.log(
        `${name.padEnd(24)} ${(size / 1048576).toFixed(1)}MB -> ${(out.byteLength / 1048576).toFixed(2)}MB   kept ${kept.length}, dropped ${dropped.length} (${dropped.join(', ')})`
      );
    }
  }

  const pct = before > 0 ? ((1 - after / before) * 100).toFixed(0) : '0';
  console.log(
    `\ntotal ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(2)}MB (-${pct}%)`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
