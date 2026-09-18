#!/usr/bin/env node
/**
 * Shrinks an authored .glb until it is small enough to hand over.
 *
 * This is the same reduction the game's own build runs, folded into one file so
 * it can be dropped onto a Windows machine and run there. The authored clips
 * arrive at 100MB and up — past what a chat upload takes — and come out of here
 * at a couple of megabytes.
 *
 * Usage: node shrink-glb.mjs <file.glb> [...]
 * Also takes the authoring pipeline's `.glb.raw` exports. Writes
 * <name>.small.glb beside each input and never touches the original.
 */
import { stat, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

/** Authoring textures are 2K or 4K PNGs; this is a stylized game at phone size. */
const TEXTURE_SIZE = 1024;

/** Authoring-only subtrees, never rendered by the game. */
const STRIP_ROOTS = [/^LATEST_MEDICAL_\d+_ROOT$/, /^MED_/];

function shouldStrip(name) {
  return STRIP_ROOTS.some((pattern) => pattern.test(name ?? ''));
}

/**
 * Repairs two faults the authored exports carry: every material shipped as
 * alpha BLEND, which on a double-sided closed body punches black holes through
 * the figure, and one material with a colour map bound to its normal slot.
 */
function repairMaterials(document) {
  const normals = document
    .getRoot()
    .listTextures()
    .filter((texture) => /normal/i.test(texture.getName() ?? ''));
  const fallbackNormal = normals[0] ?? null;

  let repaired = 0;
  for (const material of document.getRoot().listMaterials()) {
    if (material.getAlphaMode() === 'BLEND') {
      material.setAlphaMode('MASK').setAlphaCutoff(0.5);
      repaired += 1;
    }
    const normal = material.getNormalTexture();
    if (normal && !/normal/i.test(normal.getName() ?? '')) {
      material.setNormalTexture(fallbackNormal);
      repaired += 1;
    }
  }
  return repaired;
}

function stripAuthoringNodes(document) {
  let removed = 0;
  for (const node of document.getRoot().listNodes()) {
    if (!shouldStrip(node.getName())) continue;
    const doomed = [node];
    for (let i = 0; i < doomed.length; i += 1) doomed.push(...doomed[i].listChildren());
    for (const victim of doomed.reverse()) {
      victim.detach();
      victim.dispose();
      removed += 1;
    }
  }
  for (const material of document.getRoot().listMaterials()) {
    if ((material.getName() ?? '').startsWith('medical_phantom_')) {
      material.dispose();
      removed += 1;
    }
  }
  return removed;
}

const MB = (bytes) => (bytes / 1048576).toFixed(2);

async function main() {
  // The authored exports arrive as .glb or as .glb.raw, depending on which
  // stage of their pipeline they came out of.
  const files = process.argv.slice(2).filter((a) => /\.(glb|glb\.raw|raw)$/i.test(a));
  if (files.length === 0) {
    console.error('사용법: node shrink-glb.mjs <파일.glb> [...]  (.glb.raw 도 가능)');
    process.exitCode = 1;
    return;
  }

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

  for (const file of files) {
    const name = basename(file);
    let size = 0;
    try {
      size = (await stat(file)).size;
    } catch {
      console.error(`  ${name}: 파일을 찾을 수 없습니다`);
      continue;
    }

    process.stdout.write(`  ${name}  ${MB(size)} MB  처리 중...`);
    try {
      const document = await io.readBinary(new Uint8Array(await readFile(file)));
      stripAuthoringNodes(document);
      repairMaterials(document);

      await document.transform(
        prune(),
        dedup(),
        textureCompress({
          encoder: sharp,
          targetFormat: 'webp',
          resize: [TEXTURE_SIZE, TEXTURE_SIZE]
        }),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' })
      );

      const stem = name.replace(/\.raw$/i, '').replace(/\.glb$/i, '');
      const out = join(dirname(file), `${stem}.small.glb`);
      const bytes = await io.writeBinary(document);
      await writeFile(out, bytes);

      before += size;
      after += bytes.byteLength;
      const pct = Math.round((1 - bytes.byteLength / size) * 100);
      console.log(`\r  ${name}  ${MB(size)} MB -> ${MB(bytes.byteLength)} MB  (-${pct}%)   `);
      console.log(`     => ${basename(out)}`);
    } catch (error) {
      console.log('\r');
      console.error(`  ${name}: 실패 - ${error.message}`);
    }
  }

  if (before > 0) {
    console.log(`\n합계  ${MB(before)} MB -> ${MB(after)} MB  (-${Math.round((1 - after / before) * 100)}%)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
