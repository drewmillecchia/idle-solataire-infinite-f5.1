/**
 * Headless balance simulator: drives the REAL engine + rules in Node.
 * Usage: npm run sim -- <hours> [engaged|relaxer|idle] [seed]
 */
import { createInitialState, step, derive, homeCard, tableauSpark, winHand, dealHand, buyUpgrade, visibleUpgrades, upgradeCost, maxAffordable, formatNumber, formatRate, formatDuration } from '$engine/index';
import { EventBus } from '$engine/events';
import { mulberry32 } from '$engine/rng';
import { NO_TWISTS } from '$rules/module';
import { gameById } from '$rules/registry';
import { nextMove } from '$rules/autoplay';

type Profile = 'engaged' | 'relaxer' | 'idle';

export interface SimResult {
  hours: number;
  profile: Profile;
  firstAwakeAt: number | null;
  allAwakeAt: number | null;
  hands: number;
  wins: number;
  finalRate: string;
  lifetime: string;
  samples: { t: number; rate: string; awake: number; lifetime: string }[];
  milestones: { id: string; t: number }[];
}

export function runSim(hours: number, profile: Profile, seed = 1): SimResult {
  const bus = new EventBus();
  const state = createInitialState(0);
  const rng = mulberry32(seed);
  const game = gameById('klondike')!;
  let board: unknown = game.deal(rng, {}, NO_TWISTS);
  let seen = new Set<string>();
  const res: SimResult = { hours, profile, firstAwakeAt: null, allAwakeAt: null, hands: 0, wins: 0, finalRate: '', lifetime: '', samples: [], milestones: [] };
  let t = 0;
  const dt = 1 / 20;
  const total = hours * 3600;
  let nextSample = 0;
  // The simulated player makes one move per `movePeriod` seconds while playing.
  const movePeriod = profile === 'engaged' ? 1.2 : 2.0;
  let moveAcc = 0;
  let handsToday = 0;
  let dayStart = 0;
  let playing = true;
  let handStart = 0;

  bus.on((e) => {
    if (e.type === 'milestone') res.milestones.push({ id: e.id, t });
  });

  const newHand = () => {
    board = game.deal(rng, {}, NO_TWISTS);
    seen = new Set();
    dealHand(state, bus, 'klondike', 0);
    res.hands++;
    handStart = t;
  };
  dealHand(state, bus, 'klondike', 0);
  res.hands++;

  while (t < total) {
    step(state, dt, bus);
    t += dt;
    const d = derive(state);
    if (res.firstAwakeAt === null && d.awakeCount > 0) res.firstAwakeAt = t;
    if (res.allAwakeAt === null && d.awakeCount >= 52) res.allAwakeAt = t;

    // Day boundary for the relaxer.
    if (t - dayStart >= 86400) { dayStart = t; handsToday = 0; playing = true; }
    if (profile === 'idle' && res.hands > 1) playing = false;
    if (profile === 'relaxer' && handsToday >= 3) playing = false;

    if (playing) {
      moveAcc += dt;
      if (moveAcc >= movePeriod) {
        moveAcc = 0;
        const mv = nextMove(game, board, NO_TWISTS, seen);
        if (!mv || t - handStart > 900) {
          handsToday++;
          newHand();
        } else {
          seen.add(game.hash(board));
          const r = mv.kind === 'draw' ? game.draw(board, NO_TWISTS) : game.move(board, mv.pile, mv.index, mv.to, NO_TWISTS);
          if (r.changed) {
            board = r.board;
            for (const id of r.homed) homeCard(state, bus, id, 'sim');
            if (r.homed.length === 0 && mv.kind !== 'draw') tableauSpark(state, bus);
            if (r.won) { winHand(state, bus, { game: 'klondike', moves: 0, seconds: t - handStart }); res.wins++; handsToday++; newHand(); }
          }
        }
      }
      // Greedy buyer: every 5 s buy the cheapest affordable upgrade.
      if (profile === 'engaged' && Math.floor(t) % 5 === 0 && moveAcc < dt) {
        const ups = visibleUpgrades(state).filter((u) => maxAffordable(state, u.id) > 0);
        ups.sort((a, b) => upgradeCost(state, a.id).cmp(upgradeCost(state, b.id)));
        const u = ups[0];
        if (u) buyUpgrade(state, bus, u.id, 1);
      }
    }
    if (t >= nextSample) {
      nextSample += Math.max(60, total / 48);
      res.samples.push({ t, rate: formatRate(d.deckRate), awake: d.awakeCount, lifetime: formatNumber(state.lifetimeShuffles) });
    }
  }
  const d = derive(state);
  res.finalRate = formatRate(d.deckRate);
  res.lifetime = formatNumber(state.lifetimeShuffles);
  res.wins = state.stats.totalWins;
  return res;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sim/cli.ts')) {
  const hours = Number(process.argv[2] ?? '1');
  const profile = (process.argv[3] ?? 'engaged') as Profile;
  const seed = Number(process.argv[4] ?? '1');
  const r = runSim(hours, profile, seed);
  console.log(`profile=${r.profile} hours=${r.hours} seed=${seed}`);
  console.log(`first awake: ${r.firstAwakeAt === null ? 'never' : formatDuration(r.firstAwakeAt)}   all awake: ${r.allAwakeAt === null ? 'never' : formatDuration(r.allAwakeAt)}`);
  console.log(`hands: ${r.hands}  wins: ${r.wins}  final rate: ${r.finalRate}  lifetime: ${r.lifetime}`);
  console.log('milestones: ' + r.milestones.map((m) => `${m.id}@${formatDuration(m.t)}`).join(', '));
  console.log('t\trate\tawake\tlifetime');
  for (const s of r.samples) console.log(`${formatDuration(s.t)}\t${s.rate}\t${s.awake}\t${s.lifetime}`);
}
