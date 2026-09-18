#!/usr/bin/env node
/**
 * Brings each authored shoe under a triangle budget.
 *
 * The exports were modelled for stills, not for a phone: one pair of stilettos
 * arrives at 132k triangles, five times the whole attacker body. They are drawn
 * every frame of every kick, so the ones over budget are decimated until they
 * fit. Anything already under it is left exactly as authored.
 *
 * Usage: node scripts/simplify-footwear.mjs <dir> [budget]
 */
import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

function triangles(document) {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
      total += count / 3;
    }
  }
  return Math.round(total);
}

async function main() {
  const [dir, budgetArg] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: node scripts/simplify-footwear.mjs <dir> [budget]');
    process.exitCode = 1;
    return;
  }
  const budget = Number(budgetArg ?? 24000);

  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO()
    .registerExtensions([...KHRONOS_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder
    });

  for (const name of await readdir(dir)) {
    if (extname(name).toLowerCase() !== '.glb') continue;
    const file = join(dir, name);
    const size = (await stat(file)).size;
    const document = await io.readBinary(new Uint8Array(await readFile(file)));
    const before = triangles(document);

    if (before <= budget) {
      console.log(`${name.padEnd(24)} ${before} tris, already under ${budget}`);
      continue;
    }

    await document.transform(
      // Welding first is what lets the simplifier collapse across the seams
      // the exporter split the mesh along.
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: budget / before, error: 0.002 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' })
    );

    const out = await io.writeBinary(document);
    await writeFile(file, out);
    const after = triangles(document);
    console.log(
      `${name.padEnd(24)} ${before} -> ${after} tris   ${(size / 1048576).toFixed(2)}MB -> ${(out.byteLength / 1048576).toFixed(2)}MB`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
