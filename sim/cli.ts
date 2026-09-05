/** CLI: npm run sim -- <hours> [engaged|relaxer|idle] [seed] */
import { runSim } from './run';
import { formatDuration } from '$engine/index';

const hours = Number(process.argv[2] ?? '1');
const profile = (process.argv[3] ?? 'engaged') as 'engaged' | 'relaxer' | 'idle';
const seed = Number(process.argv[4] ?? '1');
const r = runSim(hours, profile, seed);
console.log(`profile=${r.profile} hours=${r.hours} seed=${seed}`);
console.log(`first awake: ${r.firstAwakeAt === null ? 'never' : formatDuration(r.firstAwakeAt)}   all awake: ${r.allAwakeAt === null ? 'never' : formatDuration(r.allAwakeAt)}`);
console.log(`hands: ${r.hands}  wins: ${r.wins}  final rate: ${r.finalRate}  lifetime: ${r.lifetime}`);
console.log('milestones: ' + r.milestones.map((m) => `${m.id}@${formatDuration(m.t)}`).join(', '));
console.log('t\trate\tawake\tlifetime');
for (const s of r.samples) console.log(`${formatDuration(s.t)}\t${s.rate}\t${s.awake}\t${s.lifetime}`);
