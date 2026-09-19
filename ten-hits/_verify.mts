const say = (l: string): void => void process.stdout.write(l + '\n');
import * as THREE from 'three';
class Progress extends Event {
  lengthComputable = false; loaded = 0; total = 0;
  constructor(t: string, i?: { lengthComputable?: boolean; loaded?: number; total?: number }) {
    super(t); this.lengthComputable = i?.lengthComputable ?? false;
    this.loaded = i?.loaded ?? 0; this.total = i?.total ?? 0;
  }
}
const g = globalThis as Record<string, unknown>;
g['ProgressEvent'] ??= Progress;
g['self'] ??= globalThis;
g['createImageBitmap'] ??= async () => ({ width: 1, height: 1, close() {} });

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { loadAttackClips, STRIKE_BONE, STRIKE_ROOT_BONE, sameName } from './src/render/attack-clips';
import { createCharacters, applySnapshot } from './src/render/characters';
import { createGameEngine } from './src/game/engine';
import { POSES, POSE_IDS } from './src/game/config';
import type { PoseId } from './src/game/types';

const root = join(process.cwd(), 'public');
const server = createServer(async (req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent((req.url ?? '/').split('?')[0]!)));
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': extname(p) === '.json' ? 'application/json' : 'model/gltf-binary' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const clips = await loadAttackClips({ baseUrl: `http://127.0.0.1:${port}/models/` });

const world = new THREE.Vector3();
const box = new THREE.Box3();

for (const id of POSE_IDS) {
  const clip = clips.get(id);
  if (!clip?.alignment) { say(`${id} no clip`); continue; }

  for (const dodge of [0, 0.5]) {
    const rig = createCharacters(id, 'pump');
    rig.applyAttackClip(clip);
    const engine = createGameEngine({ pose: id, shoe: 'pump', power: 5, seed: 7 });
    engine.start();
    engine.movePelvis({ x: dodge, y: 0 });

    let worstMiss = 0;
    let lowest = Infinity;
    let contactMiss = -1;
    let aimMiss = -1;
    let footGap = -1;
    let err = '';
    // Run one whole attack, sampling every simulation frame.
    for (let i = 0; i < 900; i += 1) {
      const snap = engine.update(1 / 60);
      applySnapshot(rig, snap);
      if (snap.phase !== 'strike' && snap.phase !== 'impact') continue;

      let ankle: THREE.Object3D | null = null;
      clip.scene.traverse((n) => { if (!ankle && sameName(n.name, STRIKE_BONE)) ankle = n; });
      (ankle as unknown as THREE.Object3D).getWorldPosition(world);
      world.setY(world.y + clip.alignment.standoff);
      const miss = Math.hypot(world.x - snap.foot.x, world.y - snap.foot.y, world.z - snap.foot.z);

      if (snap.phase === 'strike') {
        worstMiss = Math.max(worstMiss, miss);
        // The last strike frame is the one the contact is resolved from.
        contactMiss = miss;
        aimMiss = snap.aim
          ? Math.hypot(world.x - snap.aim.x, world.y - snap.aim.y, world.z - snap.aim.z)
          : -1;
        err = snap.aim
          ? `(${(world.x - snap.aim.x).toFixed(3)}, ${(world.y - snap.aim.y).toFixed(3)}, ${(world.z - snap.aim.z).toFixed(3)})`
          : '';
        footGap = Math.hypot(
          snap.foot.x - (snap.aim?.x ?? 0),
          snap.foot.y - (snap.aim?.y ?? 0),
          snap.foot.z - (snap.aim?.z ?? 0)
        );
      }
      box.makeEmpty();
      clip.scene.traverse((n) => { if ((n as THREE.Mesh).isMesh && n.visible) box.expandByObject(n); });
      if (!box.isEmpty()) lowest = Math.min(lowest, box.min.y);
      if (snap.phase === 'recovery') break;
    }
    say(
      `${id.padEnd(15)} dodge=${dodge.toFixed(1)} contactMiss=${contactMiss < 0 ? '  n/a' : contactMiss.toFixed(3)}m` +
        ` vsAim=${aimMiss.toFixed(3)}m err=${err} engineFootVsAim=${footGap.toFixed(3)}m feetLowest=${lowest.toFixed(3)}m`
    );
    rig.dispose();
  }
}
server.close();
