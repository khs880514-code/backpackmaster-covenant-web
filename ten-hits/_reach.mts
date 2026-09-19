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
import { loadAttackClips, STRIKE_BONE, STRIKE_CHAIN, sameName } from './src/render/attack-clips';
import { createCharacters, applySnapshot } from './src/render/characters';
import { createGameEngine } from './src/game/engine';
import { POSE_IDS } from './src/game/config';

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
(globalThis as Record<string, unknown>)['__stepIn'] = [];
const clips = await loadAttackClips({ baseUrl: `http://127.0.0.1:${port}/models/` });

say('stepIn per place(): ' + JSON.stringify((globalThis as Record<string, unknown>)['__stepIn']));
for (const id of POSE_IDS) {
  const clip = clips.get(id);
  if (!clip?.alignment) continue;
  const rig = createCharacters(id, 'pump');
  rig.applyAttackClip(clip);
  const engine = createGameEngine({ pose: id, shoe: 'pump', power: 5, seed: 7 });
  engine.start();

  const hip = new THREE.Vector3(), knee = new THREE.Vector3(), ankle = new THREE.Vector3();
  for (let i = 0; i < 900; i += 1) {
    const snap = engine.update(1 / 60);
    applySnapshot(rig, snap);
    if (snap.phase !== 'strike' || !snap.aim) continue;
    let h: THREE.Object3D | null = null, k: THREE.Object3D | null = null, a: THREE.Object3D | null = null;
    clip.scene.traverse((n) => {
      if (!h && sameName(n.name, STRIKE_CHAIN[0])) h = n;
      if (!k && sameName(n.name, STRIKE_CHAIN[1])) k = n;
      if (!a && sameName(n.name, STRIKE_BONE)) a = n;
    });
    if (!h || !k || !a) break;
    (h as THREE.Object3D).getWorldPosition(hip);
    (k as THREE.Object3D).getWorldPosition(knee);
    (a as THREE.Object3D).getWorldPosition(ankle);
    const contact = ankle.clone().setY(ankle.y + clip.alignment.standoff);
    const upper = hip.distanceTo(knee);
    const lower = knee.distanceTo(contact);
    const want = hip.distanceTo(new THREE.Vector3(snap.aim.x, snap.aim.y, snap.aim.z));
    if (snap.phaseProgress > 0.95) {
      say(
        `${id.padEnd(15)} upper=${upper.toFixed(3)} lower=${lower.toFixed(3)} span=${(upper + lower).toFixed(3)}` +
          ` hipToAim=${want.toFixed(3)} short=${(want - upper - lower).toFixed(3)}`
      );
      break;
    }
  }
  rig.dispose();
}
server.close();
