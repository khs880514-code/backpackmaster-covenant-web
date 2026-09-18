#!/usr/bin/env node
/**
 * Turns the authoring pipeline's glTF exports into web-shippable assets.
 *
 * Two jobs:
 *  1. Drop the anatomical target subtree. TEN HITS renders its target as two
 *     abstract proxy spheres by design, so that geometry is never displayed —
 *     and it is 82% of every file.
 *  2. Prune whatever the removal orphaned, so the download shrinks with it.
 *
 * Usage: node scripts/prepare-models.mjs <src-dir> <out-dir>
 */
import { readdir, mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

/** Authoring textures are 2K PNGs; this is a stylized game at phone size. */
const TEXTURE_SIZE = 1024;

/** Subtrees removed from every authored file before it ships. */
const STRIP_ROOTS = [/^LATEST_MEDICAL_\d+_ROOT$/, /^MED_/];

function shouldStrip(name) {
  return STRIP_ROOTS.some((pattern) => pattern.test(name ?? ''));
}

async function convert(io, srcPath, outPath) {
  const document = await io.read(srcPath);
  const root = document.getRoot();

  let removed = 0;
  // Detach matching nodes, then their descendants, so nothing keeps a
  // reference to the geometry that is on its way out.
  for (const node of root.listNodes()) {
    if (!shouldStrip(node.getName())) continue;
    const doomed = [node];
    for (let i = 0; i < doomed.length; i += 1) {
      doomed.push(...doomed[i].listChildren());
    }
    for (const victim of doomed.reverse()) {
      victim.detach();
      victim.dispose();
      removed += 1;
    }
  }

  // Materials survive node removal on their own, so clear them explicitly.
  for (const material of root.listMaterials()) {
    const name = material.getName() ?? '';
    if (name.startsWith('medical_phantom_')) {
      material.dispose();
      removed += 1;
    }
  }

  await document.transform(
    prune(),
    dedup(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [TEXTURE_SIZE, TEXTURE_SIZE]
    })
  );
  await io.write(outPath, document);

  const before = (await stat(srcPath)).size;
  const after = (await stat(outPath)).size;
  return { removed, before, after };
}

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error('usage: node scripts/prepare-models.mjs <src-dir> <out-dir>');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const io = new NodeIO();
const files = (await readdir(srcDir)).filter((f) => f.endsWith('.glb'));

let totalBefore = 0;
let totalAfter = 0;
for (const file of files.sort()) {
  const out = join(outDir, basename(file));
  const { removed, before, after } = await convert(io, join(srcDir, file), out);
  totalBefore += before;
  totalAfter += after;
  const pct = ((1 - after / before) * 100).toFixed(0);
  console.log(
    `${basename(file).padEnd(24)} ${(before / 1e6).toFixed(1)}MB -> ` +
      `${(after / 1e6).toFixed(1)}MB  (-${pct}%, ${removed} objects removed)`
  );
}
console.log(
  `\ntotal ${(totalBefore / 1e6).toFixed(1)}MB -> ${(totalAfter / 1e6).toFixed(1)}MB ` +
    `(-${((1 - totalAfter / totalBefore) * 100).toFixed(0)}%)`
);
