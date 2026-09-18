#!/usr/bin/env node
/**
 * Derives each shoe's contact profile from its actual geometry, so how a kick
 * lands follows the shape of the shoe rather than a number somebody guessed.
 *
 * For each shoe it finds the sole, takes a band across the forefoot — the part
 * that meets the target — and measures how wide that band is and how much of
 * it can touch at once. A broad platform spreads the load; a pointed toe
 * concentrates it.
 *
 * Usage: node scripts/measure-shoes.mjs <dir-of-footwear-glb>
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';

/**
 * Parts are identified by node name, not mesh name: one of these files leaves
 * its meshes as `Mesh.046` and carries the real name on the node above it.
 */
const CONTACT_PART = /sole|outsole|plateau|platform|plane\.001/i;
const RIGHT_FOOT = /_R_|_R$|\bR\b/;
const LEFT_FOOT = /_L_|_L$|\bL\b/;

function meshPoints(mesh) {
  const points = [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i += 1) {
      pos.getElement(i, v);
      points.push([...v]);
    }
  }
  return points;
}

function extent(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min, max, size: [0, 1, 2].map((k) => max[k] - min[k]) };
}

/**
 * The forefoot band: the front fifth along the shoe's longest axis. Its width
 * is the contact width, and its area is what the load is spread over.
 */
function forefoot(points) {
  const { min, max, size } = extent(points);
  const long = size.indexOf(Math.max(...size));
  const others = [0, 1, 2].filter((k) => k !== long);
  // Whichever end is narrower is the toe; the heel end carries the block.
  const widthAt = (lo, hi) => {
    const band = points.filter((p) => p[long] >= lo && p[long] <= hi);
    if (band.length < 8) return null;
    const e = extent(band);
    return { width: Math.max(e.size[others[0]], e.size[others[1]]), count: band.length };
  };
  const step = size[long] * 0.2;
  const front = widthAt(min[long], min[long] + step);
  const back = widthAt(max[long] - step, max[long]);
  const toe = front && back ? (front.width <= back.width ? front : back) : (front ?? back);
  return { length: size[long], toeWidth: toe ? toe.width : size[others[0]] };
}

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/measure-shoes.mjs <dir-of-footwear-glb>');
  process.exit(1);
}

const io = new NodeIO();
const measured = {};

for (const file of readdirSync(dir).filter((f) => /footwear/i.test(f) && f.endsWith('.glb'))) {
  const doc = await io.read(join(dir, file));
  const contact = [];
  let bulkVolume = 0;

  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName() ?? '';
    // One foot only: the pair is mirrored, so counting both doubles everything.
    if (LEFT_FOOT.test(name) || !RIGHT_FOOT.test(name)) continue;

    const points = meshPoints(mesh);
    if (points.length === 0) continue;

    const s = extent(points).size;
    bulkVolume += s[0] * s[1] * s[2];
    if (CONTACT_PART.test(name)) contact.push(...points);
  }

  if (contact.length === 0) continue;
  const { length, toeWidth } = forefoot(contact);
  measured[file.replace('.glb', '')] = {
    toeWidthM: +toeWidth.toFixed(4),
    soleLengthM: +length.toFixed(4),
    bulkVolumeM3: +bulkVolume.toFixed(6),
    contactSamples: contact.length
  };
}

// Normalise against the median so the numbers read as ratios, not millimetres.
const widths = Object.values(measured).map((m) => m.toeWidthM).sort((a, b) => a - b);
const median = widths[Math.floor(widths.length / 2)];
const volumes = Object.values(measured).map((m) => m.bulkVolumeM3).sort((a, b) => a - b);
const medianVolume = volumes[Math.floor(volumes.length / 2)];

console.log('shoe                  toe(cm)  sole(cm)   bulk    contactWidth  localPressure  mass');
for (const [name, m] of Object.entries(measured)) {
  const contactWidth = +(m.toeWidthM / median).toFixed(3);
  // A narrow toe puts the same force through less shoe.
  const localPressure = +Math.min(1.4, Math.max(0.35, 1 / contactWidth ** 1.5)).toFixed(3);
  const mass = +Math.min(1.6, Math.max(0.6, m.bulkVolumeM3 / medianVolume)).toFixed(3);
  console.log(
    `${name.padEnd(20)} ${(m.toeWidthM * 100).toFixed(1).padStart(6)} ${(m.soleLengthM * 100).toFixed(1).padStart(9)} ` +
      `${m.bulkVolumeM3.toFixed(4).padStart(8)}  ${String(contactWidth).padStart(11)}  ${String(localPressure).padStart(12)}  ${String(mass).padStart(5)}`
  );
}
