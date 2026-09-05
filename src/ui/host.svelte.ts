/**
 * THE host seam: the one place the engine meets Svelte and the table. Owns the loop (20 Hz logic,
 * 10 Hz view snapshot), the active game, persistence, and presenter wiring.
 */
import type { GameModule, GameConfig, BoardView } from '$rules/module';
import { NO_TWISTS } from '$rules/module';
import { GAMES, gameById } from '$rules/registry';
import { nextMove } from '$rules/autoplay';
import { mulberry32, randomSeed } from '$engine/rng';
import { EventBus } from '$engine/events';
import type { GameEvent, CardId } from '$engine/types';
import {
  createInitialState, type GameState, TICK_HZ, step, applyOffline, derive, type Derived,
  homeCard, tableauSpark, winHand, dealHand, serialize, deserialize, exportString, importString,
  formatNumber, formatRate, visibleUpgrades, upgradeCost, buyUpgrade, maxAffordable, nextMilestone, SAVE_VERSION
} from '$engine/index';
import { MILESTONES, FEEL, type Feel } from '$content/index';
import type { Table, TableHost } from '../table/Table';
import { loadSave, persistSave, requestPersistence, clearSaves } from '../platform/storage';
import { sound, haptic, unlockAudio } from '../audio/presenters';

export interface Ledger {
  id: string;
  text: string;
  at: number;
}

export interface View {
  revision: number;
  shuffles: string;
  lifetime: string;
  rate: string;
  awake: number;
  cutsPerformed: number;
  handsWon: number;
  handsPlayed: number;
  moves: number;
  won: boolean;
  stuck: boolean;
  canUndo: boolean;
  dealerActive: boolean;
  dealerUnlocked: boolean;
  dealerCountdown: number;
  nextMilestoneLabel: string;
  nextMilestoneProgress: number; // 0..1 log-progress toward the next milestone
  journey: number; // 0..1 log-progress toward 52!
  ledger: Ledger[];
  toasts: { id: number; text: string }[];
  upgrades: { id: string; name: string; blurb: string; owned: number; max: number | null; cost: string; affordable: boolean; effect: string }[];
  offline: { seconds: number; earned: string } | null;
  gameId: string;
  gameName: string;
  settings: GameState['settings'];
}

const LOG_52 = 67.9066; // log10(52!)

export class GameHost implements TableHost {
  state: GameState;
  bus = new EventBus();
  derived: Derived;
  module: GameModule<unknown>;
  board: unknown;
  history: unknown[] = [];
  seed = 0;
  handStartedAt = 0;
  handMoves = 0;
  table: Table | null = null;
  feel: Feel = $state(structuredClone(FEEL));
  view: View = $state(this.snapshot0());
  private acc = 0;
  private lastFrame = 0;
  private raf = 0;
  private saveTimer = 0;
  private snapTimer = 0;
  private lastActivity = performance.now();
  private dealerTimer = 0;
  private dealerSeen = new Set<string>();
  private toastId = 0;
  private toasts: { id: number; text: string }[] = [];
  private ledger: Ledger[] = [];
  private offlineNotice: View['offline'] = null;
  private stopped = false;

  constructor() {
    this.state = createInitialState(Date.now());
    this.derived = derive(this.state);
    this.module = (gameById('klondike') ?? GAMES[0]) as GameModule<unknown>;
    this.board = this.module.deal(mulberry32(1), this.config(), NO_TWISTS);
    this.bus.on((e) => this.onEvent(e));
  }

  // ---------------------------------------------------------------- lifecycle

  async boot(): Promise<void> {
    const saved = await loadSave();
    if (saved) {
      this.state = deserialize(saved.json);
      this.derived = derive(this.state);
      const gone = (Date.now() - this.state.lastSeenAt) / 1000;
      if (gone > 60) {
        const r = applyOffline(this.state, gone, this.bus);
        if (r.earned.gt(0)) this.offlineNotice = { seconds: r.seconds, earned: formatNumber(r.earned) };
      }
    }
    this.state.lastSeenAt = Date.now();
    void requestPersistence();
    this.module = (gameById(this.state.activeGame) ?? GAMES[0]) as GameModule<unknown>;
    this.newHand(true);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', () => void this.save());
    this.pushView();
  }

  attachTable(table: Table): void {
    this.table = table;
    table.reducedMotion = this.state.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    table.setBoard(this.module.view(this.board), { instant: true });
  }

  destroy(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      void this.save();
    } else {
      const gone = (Date.now() - this.state.lastSeenAt) / 1000;
      if (gone > 30) {
        const r = applyOffline(this.state, gone, this.bus);
        if (r.earned.gt(0)) this.offlineNotice = { seconds: r.seconds, earned: formatNumber(r.earned) };
      }
      this.state.lastSeenAt = Date.now();
      this.lastFrame = performance.now();
    }
  };

  private frame = (now: number): void => {
    if (this.stopped) return;
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 5) {
      // A long gap while visible (device slept): treat as offline.
      applyOffline(this.state, dt, this.bus);
      dt = 0;
    }
    this.acc += dt;
    const h = 1 / TICK_HZ;
    let n = 0;
    while (this.acc >= h && n < 200) {
      step(this.state, h, this.bus);
      this.acc -= h;
      n++;
    }
    this.state.lastSeenAt = Date.now();
    this.saveTimer += dt;
    if (this.saveTimer > 5) { this.saveTimer = 0; void this.save(); }
    this.snapTimer += dt;
    if (this.snapTimer > 0.1) { this.snapTimer = 0; this.pushView(); }
    this.dealerTick(dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  async save(): Promise<void> {
    try {
      this.derived = derive(this.state);
      await persistSave({ json: serialize(this.state), progress: this.state.lifetimeShuffles.toString(), savedAt: Date.now() });
    } catch (e) {
      console.warn('save failed', e);
    }
  }

  async hardReset(): Promise<void> {
    await clearSaves();
    location.reload();
  }

  exportSave(): string { return exportString(this.state); }
  importSave(s: string): boolean {
    try {
      const st = importString(s);
      this.state = st;
      this.derived = derive(st);
      this.newHand(true);
      void this.save();
      return true;
    } catch { return false; }
  }

  // ---------------------------------------------------------------- game

  private config(): GameConfig { return this.state.gameConfig[this.module.id] ?? {}; }

  newHand(silent = false): void {
    this.seed = randomSeed();
    this.board = this.module.deal(mulberry32(this.seed), this.config(), NO_TWISTS);
    this.history = [];
    this.handMoves = 0;
    this.handStartedAt = performance.now();
    this.dealerSeen.clear();
    dealHand(this.state, this.bus, this.module.id, this.seed);
    this.table?.setBoard(this.module.view(this.board), silent ? { instant: true } : { deal: true });
    if (!silent) sound('riffle', 0.6);
    this.pushView();
  }

  setBoardForTesting(board: unknown): void {
    this.board = board;
    this.history = [];
    this.table?.setBoard(this.module.view(this.board), { instant: true });
    this.pushView();
  }

  undo(): void {
    const prev = this.history.pop();
    if (prev === undefined) return;
    this.board = prev;
    this.state.run.undosThisHand++;
    this.table?.setBoard(this.module.view(this.board));
    sound('slideBack', 0.4);
    this.pushView();
  }

  private apply(result: { board: unknown; changed: boolean; homed: CardId[]; won: boolean; events: { type: string }[] }, from: string): boolean {
    if (!result.changed) return false;
    this.history.push(this.board);
    if (this.history.length > 200) this.history.shift();
    this.board = result.board;
    this.handMoves++;
    for (const id of result.homed) homeCard(this.state, this.bus, id, from);
    if (result.homed.length === 0 && from !== 'stock') tableauSpark(this.state, this.bus);
    this.table?.setBoard(this.module.view(this.board));
    if (result.won) {
      const secs = (performance.now() - this.handStartedAt) / 1000;
      winHand(this.state, this.bus, { game: this.module.id, moves: this.handMoves, seconds: secs });
    }
    this.pushView();
    return true;
  }

  // TableHost --------------------------------------------------------------
  canPickUp(pile: string, index: number): boolean { return this.module.canPickUp(this.board, pile, index, NO_TWISTS); }
  legalTargets(pile: string, index: number): string[] { return this.module.legalTargets(this.board, pile, index, NO_TWISTS); }
  tryMove(pile: string, index: number, to: string): boolean {
    return this.apply(this.module.move(this.board, pile, index, to, NO_TWISTS), pile);
  }
  tap(pile: string, index: number): void {
    if (pile === 'stock') { this.apply(this.module.draw(this.board, NO_TWISTS), 'stock'); sound('flip', 0.5); return; }
    const to = this.module.autoTarget(this.board, pile, index, NO_TWISTS);
    if (to) { if (this.tryMove(pile, index, to)) { sound('place', 0.5); haptic('soft'); return; } }
    sound('tick', 0.15);
  }
  tapSlot(pile: string): void {
    if (pile === 'stock') { this.apply(this.module.draw(this.board, NO_TWISTS), 'stock'); }
  }
  activity(): void {
    this.lastActivity = performance.now();
    this.dealerTimer = 0;
    unlockAudio();
  }
  sound(name: string, velocity: number): void { if (this.state.settings.sound) sound(name, velocity); }
  haptic(name: string): void { if (this.state.settings.haptics) haptic(name); }
  generator(id: CardId): { awake: boolean; charge: number } {
    const c = this.state.cards[id];
    return c ? { awake: c.awake, charge: c.charge } : { awake: false, charge: 0 };
  }

  // Auto-Dealer -----------------------------------------------------------
  dealerEnabled = true;
  private dealerTick(dt: number): void {
    if (!this.derived.autoDealerUnlocked || !this.dealerEnabled) return;
    if (this.module.isWon(this.board)) return;
    const idle = (performance.now() - this.lastActivity) / 1000;
    if (idle < this.state.settings.autoDealerDelaySeconds) return;
    this.dealerTimer += dt;
    if (this.dealerTimer < 0.9) return;
    this.dealerTimer = 0;
    const mv = nextMove(this.module, this.board, NO_TWISTS, this.dealerSeen);
    if (!mv) {
      // Nothing new: deal a fresh hand after a pause.
      if (idle > this.state.settings.autoDealerDelaySeconds + 4) this.newHand();
      return;
    }
    this.dealerSeen.add(this.module.hash(this.board));
    if (mv.kind === 'draw') this.apply(this.module.draw(this.board, NO_TWISTS), 'stock');
    else this.tryMove(mv.pile, mv.index, mv.to);
  }

  // Economy UI -------------------------------------------------------------
  buy(id: string, count = 1): void {
    if (buyUpgrade(this.state, this.bus, id, count)) { this.derived = derive(this.state); sound('tick', 0.5); haptic('tick'); this.pushView(); }
  }
  buyMax(id: string): void {
    const n = maxAffordable(this.state, id);
    if (n > 0) this.buy(id, n);
  }
  setSetting<K extends keyof GameState['settings']>(k: K, v: GameState['settings'][K]): void {
    this.state.settings[k] = v;
    if (this.table) this.table.reducedMotion = this.state.settings.reducedMotion;
    this.pushView();
  }
  setFeel<K extends keyof Feel>(k: K, v: Feel[K]): void {
    (this.feel as Feel)[k] = v;
    if (this.table) this.table.feel = $state.snapshot(this.feel) as Feel;
  }
  resetFeel(): void {
    Object.assign(this.feel, structuredClone(FEEL));
    if (this.table) this.table.feel = $state.snapshot(this.feel) as Feel;
  }
  feelJson(): string { return JSON.stringify($state.snapshot(this.feel), null, 2); }

  dismissOffline(): void { this.offlineNotice = null; this.pushView(); }

  // Events → presenters ------------------------------------------------------
  private onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'card-woken': this.sound('chime', 0.6); this.toast('A card wakes.'); break;
      case 'hand-won': this.sound('bloom', 0.8); this.haptic('success'); this.toast(`Hand won. ${formatNumber(e.burst)} shuffles.`); break;
      case 'milestone': {
        const m = MILESTONES.find((x) => x.id === e.id);
        if (m) this.ledger.unshift({ id: m.id, text: m.ledger, at: Date.now() });
        this.sound('chime', 0.9);
        break;
      }
      case 'purchase': this.derived = derive(this.state); break;
      case 'charge-gained': case 'card-home': this.derived = derive(this.state); break;
      default: break;
    }
  }

  private toast(text: string): void {
    const id = ++this.toastId;
    this.toasts.push({ id, text });
    if (this.toasts.length > 3) this.toasts.shift();
    setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); this.pushView(); }, 2600);
  }

  // View snapshot --------------------------------------------------------------
  private snapshot0(): View {
    return {
      revision: 0, shuffles: '0', lifetime: '0', rate: '0/s', awake: 0, cutsPerformed: 0, handsWon: 0, handsPlayed: 0,
      moves: 0, won: false, stuck: false, canUndo: false, dealerActive: false, dealerUnlocked: false, dealerCountdown: 0,
      nextMilestoneLabel: '', nextMilestoneProgress: 0, journey: 0, ledger: [], toasts: [], upgrades: [], offline: null,
      gameId: 'klondike', gameName: 'Klondike', settings: { sound: true, haptics: true, reducedMotion: false, autoDealerDelaySeconds: 12, shuffleStyle: 'riffle' }
    };
  }

  pushView(): void {
    const s = this.state;
    this.derived = derive(s);
    const d = this.derived;
    const nm = nextMilestone(s);
    const lifeLog = s.lifetimeShuffles.gt(1) ? s.lifetimeShuffles.log10().toNumber() : 0;
    let prog = 1;
    let label = 'Every arrangement.';
    if (nm) {
      const target = Number(nm.value);
      const tLog = Math.log10(target);
      const prevIdx = MILESTONES.indexOf(nm) - 1;
      const pLog = prevIdx >= 0 ? Math.log10(Number(MILESTONES[prevIdx]!.value)) : 0;
      prog = Math.max(0, Math.min(1, (lifeLog - pLog) / Math.max(0.001, tLog - pLog)));
      label = nm.label;
    }
    const idle = (performance.now() - this.lastActivity) / 1000;
    const v: View = {
      revision: this.view.revision + 1,
      shuffles: formatNumber(s.shuffles),
      lifetime: formatNumber(s.lifetimeShuffles),
      rate: formatRate(d.deckRate),
      awake: d.awakeCount,
      cutsPerformed: s.prestige.cutsPerformed,
      handsWon: s.run.handsWon,
      handsPlayed: s.run.handsPlayed,
      moves: this.handMoves,
      won: this.module.isWon(this.board),
      stuck: this.module.isStuck(this.board, NO_TWISTS),
      canUndo: this.history.length > 0,
      dealerUnlocked: d.autoDealerUnlocked,
      dealerActive: d.autoDealerUnlocked && this.dealerEnabled && idle >= s.settings.autoDealerDelaySeconds,
      dealerCountdown: d.autoDealerUnlocked && this.dealerEnabled ? Math.max(0, s.settings.autoDealerDelaySeconds - idle) : 0,
      nextMilestoneLabel: label,
      nextMilestoneProgress: prog,
      journey: Math.min(1, lifeLog / LOG_52),
      ledger: this.ledger.slice(0, 12),
      toasts: this.toasts.slice(),
      upgrades: visibleUpgrades(s).map((u) => {
        const owned = s.run.upgrades[u.id] ?? 0;
        const cost = upgradeCost(s, u.id, 1);
        return { id: u.id, name: u.name, blurb: u.blurb, owned, max: u.max, cost: formatNumber(cost), affordable: s.shuffles.gte(cost) && (u.max === null || owned < u.max), effect: describeEffect(u.effect) };
      }),
      offline: this.offlineNotice,
      gameId: this.module.id,
      gameName: this.module.name,
      settings: { ...s.settings }
    };
    this.view = v;
  }
}

function describeEffect(e: { kind: string; per?: number; add?: number; suit?: string }): string {
  switch (e.kind) {
    case 'globalMult': return `+${Math.round((e.per ?? 0) * 100)}% to everything, per level`;
    case 'suitMult': return `+${Math.round((e.per ?? 0) * 100)}% to ${suitName(e.suit)}, per level`;
    case 'chargeMult': return `each charge is worth +${Math.round((e.per ?? 0) * 100)}% more`;
    case 'burstMult': return `+${Math.round((e.per ?? 0) * 100)}% to the win burst`;
    case 'sparkMult': return `+${Math.round((e.per ?? 0) * 100)}% to sparks`;
    case 'awakeMult': return `up to +${Math.round((e.per ?? 0) * 100)}% as the deck wakes`;
    case 'devotionMult': return `grows with cards sent home this run`;
    case 'offlineHours': return `+${e.add ?? 0} h of earning while away`;
    case 'autoDealer': return `someone to play while you rest`;
    default: return '';
  }
}
function suitName(s?: string): string {
  return s === 'S' ? 'spades' : s === 'H' ? 'hearts' : s === 'D' ? 'diamonds' : s === 'C' ? 'clubs' : 'a suit';
}

export { SAVE_VERSION };
