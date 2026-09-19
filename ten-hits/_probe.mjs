import { createGameEngine } from './src/game/engine.ts';
function run(pose, power, seed, offset) {
  const e = createGameEngine({ pose, shoe: 'pump', power, seed });
  e.start();
  let hits = 0, prev = 'setup', snap = e.snapshot();
  for (let i = 0; i < 60 * 400; i++) {
    e.update(1/60); snap = e.snapshot();
    if (snap.phase === 'impact' && prev !== 'impact') hits++;
    prev = snap.phase;
    if (snap.phase === 'strike') e.movePelvis({ x: snap.foot.x > 0 ? -offset : offset, y: 0 });
    else if (snap.phase === 'recovery') e.movePelvis({ x: 0, y: 0 });
    if (snap.phase === 'won' || snap.phase === 'lost') break;
  }
  return { hits, result: snap.phase };
}
for (const pose of ['kneeling-front', 'standing-front']) {
  for (const power of [4, 7, 10]) {
    const rows = [1,2,3,4,5,6].map((s) => run(pose, power, s, 0));
    const hits = rows.map(r => r.hits);
    const lost = rows.filter(r => r.result === 'lost').length;
    console.log(`${pose.padEnd(15)} power ${power}  hits-to-end ${hits.join(',')}  (min ${Math.min(...hits)})  lost ${lost}/6`);
  }
}
