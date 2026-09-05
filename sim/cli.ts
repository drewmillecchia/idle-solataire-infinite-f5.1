/** CLI: npm run sim -- <hours> [engaged|relaxer|idle] [seed] */
import { runSim } from './run';
import { formatDuration } from '$engine/index';

const hours = Number(process.argv[2] ?? '1');
const profile = (process.argv[3] ?? 'engaged') as 'engaged' | 'relaxer' | 'idle';
const seed = Number(process.argv[4] ?? '1');
const r = runSim(hours, profile, seed);
const at = (v: number | null) => (v === null ? 'never' : formatDuration(v));
console.log(`profile=${r.profile} hours=${r.hours} seed=${seed}`);
console.log(`first awake: ${at(r.firstAwakeAt)}   all awake: ${at(r.allAwakeAt)} (in first run: ${r.allAwakeInFirstRun})`);
console.log(`hands: ${r.hands}  wins: ${r.wins}  final rate: ${r.finalRate}  lifetime: ${r.lifetime}`);
console.log(`cut available: ${at(r.firstCutAvailableAt)}   first cut: ${at(r.firstCutAt)}   cuts taken: ${r.cuts.length}  lifetime cuts: ${r.lifetimeCuts}`);
console.log('cuts/hour: ' + Array.from({ length: Math.ceil(hours) }, (_, h) => `h${h + 1}=${r.cutsPerHourInHour(h)}`).join(' '));
// A rate of 0 right after a cut is correct (nothing survives awake without Kept Flame), and
// log10(0) is NaN — print it as a rate, not as a number, so it never reads like an engine fault.
const afterRate = (k: number): string => {
  const v = r.log10RateAfterCut[k];
  if (v === undefined || v === null) return 'not sampled';
  return Number.isNaN(v) ? 'asleep' : v.toFixed(1);
};
console.log('cuts: ' + r.cuts.map((c, k) => `${formatDuration(c.t)}+${c.earned}[log10 rate ${c.log10RateBefore.toFixed(1)}->${afterRate(k)}]`).join(', '));
console.log(`reshuffles: ${r.reshuffles.length}  first: ${at(r.firstReshuffleAt)}  lifetime permutations: ${r.lifetimePermutations}`);
console.log('reshuffle events: ' + (r.reshuffles.map((x) => `${formatDuration(x.t)}+${x.earned}[cycle cuts ${x.cycleCuts}]`).join(', ') || 'none'));
console.log('cycles: ' + r.cycles.map((c) => `#${c.index} ${formatDuration(c.start)}->${c.end === null ? 'open' : formatDuration(c.end)} cuts=${c.cutsInCycle}${c.end === null ? '' : ` dur=${formatDuration(c.end - c.start)}`}`).join(' | '));
console.log(`numbering: ${r.numbering}  unlocked: ${r.unlockedNumberings.join(', ')}`);
console.log('nodes: ' + (Object.entries(r.nodes).map(([k, v]) => `${k}x${v}`).join(', ') || 'none'));
console.log('reveals (first 60s): ' + r.reveals.filter((x) => x.t <= 60).map((x) => x.feature).join(', '));
console.log('milestones: ' + r.milestones.map((m) => `${m.id}@${formatDuration(m.t)}`).join(', '));
console.log('t\trate\tawake\tlifetime');
for (const s of r.samples) console.log(`${formatDuration(s.t)}\t${s.rate}\t${s.awake}\t${s.lifetime}`);
