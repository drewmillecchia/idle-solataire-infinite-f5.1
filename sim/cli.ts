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
console.log('cuts: ' + r.cuts.map((c, k) => `${formatDuration(c.t)}+${c.earned}[log10 rate ${c.log10RateBefore.toFixed(1)}->${(r.log10RateAfterCut[k] ?? NaN).toFixed(1)}]`).join(', '));
console.log('nodes: ' + (Object.entries(r.nodes).map(([k, v]) => `${k}x${v}`).join(', ') || 'none'));
console.log('reveals (first 60s): ' + r.reveals.filter((x) => x.t <= 60).map((x) => x.feature).join(', '));
console.log('milestones: ' + r.milestones.map((m) => `${m.id}@${formatDuration(m.t)}`).join(', '));
console.log('t\trate\tawake\tlifetime');
for (const s of r.samples) console.log(`${formatDuration(s.t)}\t${s.rate}\t${s.awake}\t${s.lifetime}`);
