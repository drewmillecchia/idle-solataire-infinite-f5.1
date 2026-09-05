import { dealKlondike, klondike } from '../../src/rules/games/klondike';
import { NO_TWISTS } from '../../src/rules/module';
import { solveKlondike, findWinnableSeed, type SolverMove } from '../../src/rules/solver/klondike';

function replay(seed: number, line: SolverMove[]): boolean {
  let b = dealKlondike(seed);
  for (const m of line) {
    const r = 'kind' in m ? klondike.draw(b, NO_TWISTS) : klondike.move(b, m.pile, m.index, m.to, NO_TWISTS);
    if (!r.changed) { console.log('ILLEGAL MOVE', JSON.stringify(m)); return false; }
    b = r.board;
  }
  return klondike.isWon(b);
}

const mode = process.argv[2] ?? 'find';

if (mode === 'find') {
  const times: number[] = [];
  for (let s = 1; s <= 20; s++) {
    const t0 = performance.now();
    const f = findWinnableSeed(s * 1000);
    const dt = performance.now() - t0;
    times.push(dt);
    if (!f) { console.log(`start ${s * 1000}: NONE in ${dt.toFixed(0)}ms`); continue; }
    const ok = replay(f.seed, f.line);
    console.log(`start ${s * 1000}: seed ${f.seed} tries ${f.tries} nodes ${f.nodes} line ${f.line.length} ${dt.toFixed(0)}ms replay=${ok}`);
  }
  times.sort((a, b) => a - b);
  console.log(`median ${times[Math.floor(times.length / 2)]!.toFixed(0)}ms  max ${times[times.length - 1]!.toFixed(0)}ms  mean ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)}ms`);
} else {
  const budget = Number(process.argv[3] ?? 60000);
  const n = Number(process.argv[4] ?? 100);
  let won = 0, lost = 0, unknown = 0, totalMs = 0, nodes = 0;
  for (let s = 1; s <= n; s++) {
    const t0 = performance.now();
    const r = solveKlondike(dealKlondike(s), { budgetNodes: budget });
    totalMs += performance.now() - t0;
    nodes += r.nodes;
    if (r.result === 'won') { won++; if (!replay(s, r.line!)) console.log('REPLAY FAIL', s); }
    else if (r.result === 'lost') lost++;
    else unknown++;
  }
  console.log(`budget ${budget} over ${n} seeds: won ${won} lost ${lost} unknown ${unknown}; ${(totalMs / n).toFixed(0)}ms/seed, ${(nodes / totalMs * 1000 / 1000).toFixed(0)}k nodes/s`);
}
