/**
 * THE host seam: the one place the engine meets Svelte and the table. Owns the loop (20 Hz logic,
 * 10 Hz view snapshot), the active game, persistence, and presenter wiring.
 */
import type { GameModule, GameConfig, BoardView } from '$rules/module';

import { GAMES, gameById } from '$rules/registry';
import type { GameOption } from '$rules/module';
import { nextMove } from '$rules/autoplay';
import { mulberry32, randomSeed } from '$engine/rng';
import { EventBus } from '$engine/events';
import type { GameEvent, CardId } from '$engine/types';
import {
  createInitialState, type GameState, TICK_HZ, step, applyOffline, derive, type Derived,
  homeCard, tableauSpark, winHand, dealHand, serialize, deserialize, exportString, importString,
  formatNumber, formatRate, visibleUpgrades, upgradeCost, buyUpgrade, maxAffordable, nextMilestone, SAVE_VERSION,
  cutPotential, cutsOnCut, canCut, performCut, cutThreshold, runEarned,
  nodeLevel, nodeCost, canBuyNode, buyNode, visibleNodes,
  attachMarks, twistsFor, availableMarks, canPlace, placeMark, removeMark, placementFor, markSlots, usedSlots, markDef,
  canReshuffle, permutationsOnReshuffle, reshufflePotential, reshuffleThreshold, cycleCuts, performReshuffle,
  numberingOptions, unlockNumbering, selectNumbering, journeyFraction, arrangementIndex, LOG10_FACT_52
} from '$engine/index';
import { MILESTONES, FEEL, MARKS, type Feel } from '$content/index';
import { WAYS } from '$content/ways';
import type { WayId, NumberingId } from '$engine/types';
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
  wonBanner: { burst: string } | null;
  lastGesture: string;
  storageWarning: boolean;
  cut: {
    revealed: boolean;
    canCut: boolean;
    cutsOnCut: string;
    progress: number; // 0..1 toward the first Cut of this run
    potential: string;
    runEarned: string;
    threshold: string;
    cuts: string;
    lifetimeCuts: string;
    cutsPerformed: number;
    way: WayId;
    ways: { id: WayId; name: string; mood: string; blurb: string; mechanics: string; unlocked: boolean }[];
    cutting: boolean;
  };
  deck: { awake: boolean; charge: number; glyph?: string | undefined; selected: boolean }[];
  marks: {
    slots: number;
    used: number;
    available: { id: string; name: string; glyph: string; rule: string; arity: number; kind: string; placed: number }[];
    placed: { id: string; name: string; glyph: string; cards: number[] }[];
    picking: string | null;
    canPlace: boolean;
  };
  reshuffle: {
    revealed: boolean;
    can: boolean;
    onReshuffle: string;
    progress: number;
    cycleCuts: string;
    threshold: string;
    permutations: string;
    lifetimePermutations: string;
    reshuffles: number;
  };
  numbering: { id: string; name: string; blurb: string; cost: string; unlocked: boolean; selected: boolean; affordable: boolean; values: number[] }[];
  odometer: string;
  constellation: { id: string; name: string; blurb: string; branch: string; level: number; max: number; cost: string; affordable: boolean; effect: string }[];
  gameId: string;
  gameName: string;
  games: { id: string; name: string; blurb: string }[];
  gameOptions: { option: GameOption; value: string }[];
  settings: GameState['settings'];
}


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
  private wonBanner: View['wonBanner'] = null;
  private cutting = false;
  private stopped = false;

  constructor() {
    this.state = createInitialState(Date.now());
    this.derived = derive(this.state);
    this.module = (gameById('klondike') ?? GAMES[0]) as GameModule<unknown>;
    this.board = this.module.deal(mulberry32(1), this.config(), twistsFor(this.state));
    this.bus.on((e) => this.onEvent(e));
    this.detachMarks = attachMarks(this.state, this.bus);
  }
  private detachMarks: () => void = () => {};
  /** The interpreter closes over `state`; re-attach whenever the state object is replaced. */
  private reattachMarks(): void {
    this.detachMarks();
    this.detachMarks = attachMarks(this.state, this.bus);
  }
  private twists() { return twistsFor(this.state); }

  // ---------------------------------------------------------------- lifecycle

  async boot(): Promise<void> {
    const saved = await loadSave();
    if (saved) {
      this.state = deserialize(saved.json);
      this.reattachMarks();
      this.derived = derive(this.state);
      const gone = (Date.now() - this.state.lastSeenAt) / 1000;
      if (gone > 0) {
        const r = applyOffline(this.state, gone, this.bus);
        // Earnings always accrue; the welcome-back note only for a real absence.
        if (gone > 60 && r.earned.gt(0)) this.offlineNotice = { seconds: r.seconds, earned: formatNumber(r.earned) };
      }
      this.rebuildLedger();
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

  /** The ledger is derived from persisted state (milestones passed, cuts made), never stored itself. */
  private rebuildLedger(): void {
    const entries: Ledger[] = [];
    for (const id of this.state.milestones) {
      const m = MILESTONES.find((x) => x.id === id);
      if (m) entries.push({ id: m.id, text: m.ledger, at: 0 });
    }
    for (let i = 1; i <= this.state.prestige.cutsPerformed; i++) entries.push({ id: `cut-${i}`, text: `Cut ${i}. The deck forgets; the Keeper does not.`, at: 0 });
    for (let i = 1; i <= this.state.prestige.reshuffles; i++) entries.push({ id: `reshuffle-${i}`, text: `Reshuffle ${i}. Every cut, traded for a new shape of value.`, at: 0 });
    this.ledger = entries.reverse();
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
      if (gone > 0) {
        const r = applyOffline(this.state, gone, this.bus);
        if (gone > 30 && r.earned.gt(0)) this.offlineNotice = { seconds: r.seconds, earned: formatNumber(r.earned) };
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
    if (n > 0) { visibleUpgrades(this.state, this.bus); availableMarks(this.state, this.bus); }
    this.saveTimer += dt;
    if (this.saveTimer > 5) { this.saveTimer = 0; void this.save(); }
    this.snapTimer += dt;
    if (this.snapTimer > 0.1) { this.snapTimer = 0; this.pushView(); }
    this.dealerTick(dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  async save(): Promise<void> {
    try {
      const r = await persistSave({ json: serialize(this.state), progress: this.state.lifetimeShuffles.toString(), savedAt: Date.now() });
      this.storageWarning = !r.idb && !r.ls;
    } catch (e) {
      console.warn('save failed', e);
      this.storageWarning = true;
    }
  }
  private storageWarning = false;

  async hardReset(): Promise<void> {
    await clearSaves();
    location.reload();
  }

  exportSave(): string { return exportString(this.state); }
  importSave(s: string): boolean {
    if (this.cutting) return false;
    // importString never throws — a bad string yields a blank state — so check the payload first, and
    // never write over the existing save unless it is a real save.
    let raw: unknown;
    try { raw = JSON.parse(atob(s.trim())); } catch { return false; }
    if (!raw || typeof raw !== 'object' || !('lifetimeShuffles' in raw) || !('cards' in raw)) return false;
    const st = importString(s.trim());
    if (!Array.isArray(st.cards) || st.cards.length < 52) return false;
    this.state = st;
    this.reattachMarks();
    this.derived = derive(st);
    this.rebuildLedger();
    this.newHand(true);
    void this.save();
    return true;
  }

  // ---------------------------------------------------------------- game

  private config(): GameConfig { return this.state.gameConfig[this.module.id] ?? {}; }

  newHand(silent = false, count = !silent): void {
    if (this.cutting) return;
    this.dealerPending = null;
    this.table?.clearHint();
    this.seed = randomSeed();
    this.board = this.module.deal(mulberry32(this.seed), this.config(), this.twists());
    this.history = [];
    this.handMoves = 0;
    this.handStartedAt = performance.now();
    this.dealerSeen.clear();
    dealHand(this.state, this.bus, this.module.id, this.seed, { count });
    this.wonBanner = null;
    const style = this.state.settings.shuffleStyle === 'random' ? (Math.random() < 0.5 ? 'riffle' : 'overhand') : this.state.settings.shuffleStyle;
    this.table?.setBoard(this.module.view(this.board), silent ? { instant: true } : { deal: true, shuffle: style });
    this.pushView();
  }

  switchGame(id: string): void {
    if (this.cutting) return;
    const m = gameById(id);
    if (!m) return;
    this.module = m as GameModule<unknown>;
    this.state.activeGame = id;
    this.newHand();
    void this.save();
  }

  setGameOption(optionId: string, value: string): void {
    const cfg = { ...(this.state.gameConfig[this.module.id] ?? {}) };
    cfg[optionId] = value;
    this.state.gameConfig[this.module.id] = cfg;
    this.pushView();
  }

  setBoardForTesting(board: unknown): void {
    this.board = board;
    this.history = [];
    this.state.run.hand.homedThisHand = []; // a constructed board is a fresh hand for payout purposes
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
    // Moves off a foundation pay nothing (otherwise a two-tap round trip farms sparks forever).
    const fromKind = this.module.view(this.board).piles.find((p) => p.id === from)?.kind;
    if (result.homed.length === 0 && from !== 'stock' && fromKind !== 'foundation') tableauSpark(this.state, this.bus);
    this.table?.setBoard(this.module.view(this.board));
    if (result.won) {
      const secs = (performance.now() - this.handStartedAt) / 1000;
      const burst = winHand(this.state, this.bus, { game: this.module.id, moves: this.handMoves, seconds: secs });
      this.wonBanner = { burst: formatNumber(burst) };
      this.table?.celebrate();
    }
    this.pushView();
    return true;
  }

  // TableHost --------------------------------------------------------------
  canPickUp(pile: string, index: number): boolean { return this.module.canPickUp(this.board, pile, index, this.twists()); }
  legalTargets(pile: string, index: number): string[] { return this.module.legalTargets(this.board, pile, index, this.twists()); }
  tryMove(pile: string, index: number, to: string): boolean {
    const moved = this.module.view(this.board).piles.find((p) => p.id === pile)?.cards.slice(index).map((c) => c.id) ?? [];
    const r = this.module.move(this.board, pile, index, to, this.twists());
    const changed = this.apply(r, pile);
    if (changed && r.homed.length === 0) for (const id of moved) if (id !== null) this.bus.emit({ type: 'card-moved', card: id, from: pile, to });
    return changed;
  }
  tap(pile: string, index: number): boolean {
    const pv = this.module.view(this.board).piles.find((p) => p.id === pile);
    // Only the top of the waste (or a stock whose top is playable, as in Pyramid) can move: aim the tap there.
    if (pv && (pile === 'waste' || pile === 'stock') && pv.pickableFrom !== undefined) index = pv.cards.length - 1;
    if (pile === 'stock') {
      const to = pv?.pickableFrom !== undefined ? this.module.autoTarget(this.board, pile, index, this.twists()) : null;
      if (to && this.tryMove(pile, index, to)) { sound('place', 0.5); haptic('soft'); return true; }
      const ok = this.apply(this.module.draw(this.board, this.twists()), 'stock'); if (ok) sound('flip', 0.5); return ok;
    }
    const to = this.module.autoTarget(this.board, pile, index, this.twists());
    if (to && this.tryMove(pile, index, to)) { sound('place', 0.5); haptic('soft'); return true; }
    sound('tick', 0.15);
    return false;
  }
  tapSlot(pile: string): void {
    if (pile === 'stock') { this.apply(this.module.draw(this.board, this.twists()), 'stock'); }
  }
  activity(): void {
    this.lastActivity = performance.now();
    this.dealerTimer = 0;
    unlockAudio();
  }
  sound(name: string, velocity: number): void { if (this.state.settings.sound) sound(name, velocity); }
  haptic(name: string): void { if (this.state.settings.haptics) haptic(name); }
  generator(id: CardId): { awake: boolean; charge: number; glyph?: string | undefined } {
    const c = this.state.cards[id];
    return c ? { awake: c.awake, charge: c.charge, glyph: this.glyphFor(c.marks) } : { awake: false, charge: 0 };
  }
  selectedCards: CardId[] = [];
  /** Tap on a card in the deck spread. Selection drives Mark placement (M4). */
  tapDeckCard(id: CardId): void {
    const arity = this.pickingMark ? (markDef(this.pickingMark)?.arity ?? 1) : 2;
    this.selectedCards = this.selectedCards.includes(id) ? this.selectedCards.filter((x) => x !== id) : [...this.selectedCards, id].slice(-arity);
    this.pushView();
  }
  /** The card's own mark glyph first; a Twin (the wire) is appended as a small second glyph. */
  glyphFor(marks: string[]): string | undefined {
    if (marks.length === 0) return undefined;
    const own = marks.find((m) => m !== 'twin');
    const g = (id: string | undefined) => (id ? MARKS.find((m) => m.id === id)?.glyph ?? '' : '');
    const out = g(own) + (marks.includes('twin') ? g('twin') : '');
    return out || undefined;
  }

  // Marks ----------------------------------------------------------------------
  pickingMark: string | null = null;
  pickMark(id: string | null): void {
    this.pickingMark = this.pickingMark === id ? null : id;
    this.selectedCards = [];
    this.pushView();
  }
  placePickedMark(): void {
    if (!this.pickingMark) return;
    if (placeMark(this.state, this.bus, this.derived, this.pickingMark, this.selectedCards)) {
      this.derived = derive(this.state);
      sound('chime', 0.5); haptic('soft');
      this.pickingMark = null;
      this.selectedCards = [];
      this.table?.setBoard(this.module.view(this.board));
      this.pushView();
    }
  }
  unplaceMark(id: string, card: number): void {
    if (removeMark(this.state, id, card)) {
      this.derived = derive(this.state);
      sound('slideBack', 0.3);
      this.table?.setBoard(this.module.view(this.board));
      this.pushView();
    }
  }
  markOn(card: number): string | undefined { return placementFor(this.state, card)?.mark; }

  // Auto-Dealer -----------------------------------------------------------
  dealerEnabled = true;
  private dealerPending: ReturnType<typeof nextMove> | null = null;
  private dealerTick(dt: number): void {
    if (!this.derived.autoDealerUnlocked || !this.dealerEnabled || this.cutting) return;
    if (this.module.isWon(this.board)) return;
    const idle = (performance.now() - this.lastActivity) / 1000;
    if (idle < this.state.settings.autoDealerDelaySeconds) { this.dealerPending = null; return; }
    this.dealerTimer += dt;
    const beat = this.dealerBeat();
    if (this.dealerPending) {
      // Phase 2: the telegraphed move lands after half a beat.
      if (this.dealerTimer < beat * 0.5) return;
      this.dealerTimer = 0;
      const mv = this.dealerPending;
      this.dealerPending = null;
      this.table?.clearHint();
      this.dealerSeen.add(this.module.hash(this.board));
      if (mv.kind === 'draw') this.apply(this.module.draw(this.board, this.twists()), 'stock');
      else this.tryMove(mv.pile, mv.index, mv.to);
      return;
    }
    if (this.dealerTimer < beat * 0.5) return;
    this.dealerTimer = 0;
    const mv = nextMove(this.module, this.board, this.twists(), this.dealerSeen);
    if (!mv) {
      // Nothing new: deal a fresh hand after a pause.
      if (idle > this.state.settings.autoDealerDelaySeconds + 4) this.newHand();
      return;
    }
    // Phase 1: telegraph.
    this.dealerPending = mv;
    if (mv.kind === 'draw') this.table?.hint('stock', 0, null);
    else this.table?.hint(mv.pile, mv.index, mv.to);
  }
  private dealerBeat(): number {
    const d = this.derived as Derived & { dealerBeatSeconds?: number };
    return d.dealerBeatSeconds ?? 0.9;
  }

  // Prestige -----------------------------------------------------------------
  cut(way: WayId): void {
    if (this.cutting || !canCut(this.state, this.derived)) return;
    this.cutting = true;
    this.wonBanner = null;
    this.dealerPending = null;
    this.table?.clearHint();
    this.pushView();
    const finish = () => {
      const earned = performCut(this.state, this.bus, way, Date.now());
      this.derived = derive(this.state);
      this.cutting = false;
      this.toast(`The deck is cut. ${formatNumber(earned)} ${earned.eq(1) ? 'Cut' : 'Cuts'}.`);
      this.newHand();
      void this.save();
    };
    if (this.table) this.table.cutCeremony(finish);
    else finish();
  }
  reshuffle(): void {
    if (this.cutting || !canReshuffle(this.state, this.derived)) return;
    this.cutting = true;
    this.wonBanner = null;
    this.dealerPending = null;
    this.table?.clearHint();
    this.pushView();
    const finish = () => {
      const earned = performReshuffle(this.state, this.bus, Date.now());
      this.derived = derive(this.state);
      this.cutting = false;
      this.toast(`The deck is reshuffled. ${formatNumber(earned)} ${earned.eq(1) ? 'Permutation' : 'Permutations'}.`);
      this.newHand();
      void this.save();
    };
    if (this.table) this.table.cutCeremony(finish);
    else finish();
  }
  unlockNumbering(id: string): void {
    if (unlockNumbering(this.state, this.bus, id as NumberingId)) { this.derived = derive(this.state); sound('chime', 0.6); haptic('soft'); this.pushView(); void this.save(); }
  }
  selectNumbering(id: string): void {
    if (selectNumbering(this.state, id as NumberingId)) { this.derived = derive(this.state); sound('tick', 0.5); this.pushView(); void this.save(); }
  }
  buyNode(id: string): void {
    if (buyNode(this.state, this.bus, id)) { this.derived = derive(this.state); sound('chime', 0.5); haptic('soft'); this.pushView(); }
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
    if (this.table) this.table.reducedMotion = this.state.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.pushView();
    void this.save();
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
      case 'card-woken':
        this.sound('chime', 0.6);
        // Words only for the first few wakes ever; after that the chime and the brass star carry it.
        if (this.state.stats.totalHomed <= 3) this.toast('A card wakes. It will count for you from now on.');
        break;
      case 'hand-won': this.sound('bloom', 0.8); this.haptic('success'); break;
      case 'milestone': {
        const m = MILESTONES.find((x) => x.id === e.id);
        if (m) this.ledger.unshift({ id: m.id, text: m.ledger, at: Date.now() });
        this.sound('chime', 0.9);
        break;
      }
      case 'purchase': this.derived = derive(this.state); break;
      case 'reveal':
        if (e.feature === 'cut') { this.toast('The lamp is bright enough to cut the deck.'); this.sound('chime', 0.5); }
        else if (e.feature.startsWith('mark:')) { const m = markDef(e.feature.slice(5)); if (m) this.toast(`A Mark is yours to place: ${m.name}.`); }
        break;
      case 'mark-fired': this.sound('tick', 0.6); this.derived = derive(this.state); break;
      case 'reshuffle': this.ledger.unshift({ id: `reshuffle-${this.state.prestige.reshuffles}`, text: `Reshuffle ${this.state.prestige.reshuffles}. Every cut, traded for a new shape of value.`, at: Date.now() }); break;
      case 'cut': this.ledger.unshift({ id: `cut-${this.state.prestige.cutsPerformed}`, text: `Cut ${this.state.prestige.cutsPerformed}. The deck forgets; the Keeper does not.`, at: Date.now() }); break;
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
      nextMilestoneLabel: '', nextMilestoneProgress: 0, journey: 0, ledger: [], toasts: [], upgrades: [], offline: null, wonBanner: null, lastGesture: '', storageWarning: false,
      cut: { revealed: false, canCut: false, cutsOnCut: '0', progress: 0, potential: '0', runEarned: '0', threshold: '0', cuts: '0', lifetimeCuts: '0', cutsPerformed: 0, way: 'none', ways: [], cutting: false },
      constellation: [],
      reshuffle: { revealed: false, can: false, onReshuffle: '0', progress: 0, cycleCuts: '0', threshold: '0', permutations: '0', lifetimePermutations: '0', reshuffles: 0 },
      numbering: [],
      odometer: '0',
      deck: [],
      marks: { slots: 0, used: 0, available: [], placed: [], picking: null, canPlace: false },
      gameId: 'klondike', gameName: 'Klondike', games: [], gameOptions: [], settings: { sound: true, haptics: true, reducedMotion: false, autoDealerDelaySeconds: 12, shuffleStyle: 'riffle' }
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
      stuck: this.module.isStuck(this.board, this.twists()),
      canUndo: this.history.length > 0,
      dealerUnlocked: d.autoDealerUnlocked,
      dealerActive: d.autoDealerUnlocked && this.dealerEnabled && idle >= s.settings.autoDealerDelaySeconds,
      dealerCountdown: d.autoDealerUnlocked && this.dealerEnabled ? Math.max(0, s.settings.autoDealerDelaySeconds - idle) : 0,
      nextMilestoneLabel: label,
      nextMilestoneProgress: prog,
      journey: journeyFraction(s),
      ledger: this.ledger.slice(0, 12),
      toasts: this.toasts.slice(),
      upgrades: visibleUpgrades(s).map((u) => {
        const owned = s.run.upgrades[u.id] ?? 0;
        const cost = upgradeCost(s, u.id, 1);
        return { id: u.id, name: u.name, blurb: u.blurb, owned, max: u.max, cost: formatNumber(cost), affordable: s.shuffles.gte(cost) && (u.max === null || owned < u.max), effect: describeEffect(u.effect) };
      }),
      offline: this.offlineNotice,
      wonBanner: this.wonBanner,
      storageWarning: this.storageWarning,
      cut: {
        revealed: s.revealed.includes('cut') || s.prestige.cutsPerformed > 0,
        canCut: canCut(s, d) && !this.cutting,
        cutsOnCut: formatNumber(cutsOnCut(s, d)),
        progress: Math.min(1, cutPotential(s, d).toNumber()),
        potential: cutPotential(s, d).toFixed(2),
        runEarned: formatNumber(runEarned(s)),
        threshold: formatNumber(cutThreshold(s, d)),
        cuts: formatNumber(s.prestige.cuts),
        lifetimeCuts: formatNumber(s.prestige.lifetimeCuts),
        cutsPerformed: s.prestige.cutsPerformed,
        way: s.run.way,
        ways: WAYS.map((w) => ({ ...w, unlocked: s.prestige.waysUnlocked.includes(w.id) })),
        cutting: this.cutting
      },
      deck: s.cards.map((c, i) => ({ awake: c.awake, charge: c.charge, glyph: this.glyphFor(c.marks), selected: this.selectedCards.includes(i) })),
      marks: {
        slots: markSlots(s, d),
        used: usedSlots(s),
        available: availableMarks(s).map((m) => ({ id: m.id, name: m.name, glyph: m.glyph, rule: m.rule, arity: m.arity, kind: m.kind, placed: s.marks.placed.filter((p) => p.mark === m.id).length })),
        placed: s.marks.placed.map((p) => { const m = markDef(p.mark); return { id: p.mark, name: m?.name ?? p.mark, glyph: m?.glyph ?? '?', cards: [...p.cards] }; }),
        picking: this.pickingMark,
        canPlace: this.pickingMark !== null && canPlace(s, d, this.pickingMark, this.selectedCards)
      },
      reshuffle: {
        revealed: s.revealed.includes('reshuffle') || s.prestige.reshuffles > 0,
        can: canReshuffle(s, d) && !this.cutting,
        onReshuffle: formatNumber(permutationsOnReshuffle(s, d)),
        progress: Math.min(1, reshufflePotential(s, d).toNumber()),
        cycleCuts: formatNumber(cycleCuts(s)),
        threshold: formatNumber(reshuffleThreshold(s, d)),
        permutations: formatNumber(s.prestige.permutations),
        lifetimePermutations: formatNumber(s.prestige.lifetimePermutations),
        reshuffles: s.prestige.reshuffles
      },
      numbering: numberingOptions(s).map((o) => ({ id: o.id, name: o.name, blurb: o.blurb, cost: formatNumber(o.cost), unlocked: o.unlocked, selected: o.selected, affordable: o.affordable, values: [...o.values] })),
      odometer: formatBig(arrangementIndex(s)),
      constellation: visibleNodes(s).map((n) => ({
        id: n.id, name: n.name, blurb: n.blurb, branch: n.branch, level: nodeLevel(s, n.id), max: n.max,
        cost: formatNumber(nodeCost(s, n.id)), affordable: canBuyNode(s, n.id), effect: describeNode(n.effect)
      })),
      lastGesture: this.table ? `${this.table.lastGesture.kind}${this.table.lastGesture.target ? ' → ' + this.table.lastGesture.target : ''} · ${Math.round(this.table.lastGesture.speed)} px/s · held ${Math.round(this.table.lastGesture.held)} ms` : '',
      gameId: this.module.id,
      gameName: this.module.name,
      games: GAMES.map((g) => ({ id: g.id, name: g.name, blurb: g.blurb })),
      gameOptions: this.module.options.map((option) => ({ option: { ...option, values: option.values.map((v) => ({ ...v })) }, value: this.config()[option.id] ?? option.default })),
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
/** A bigint for the odometer: grouped digits up to 15 digits, then d.ddd×10^n. */
function formatBig(n: bigint): string {
  const str = n.toString();
  if (str.length <= 15) return str.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${str[0]}.${str.slice(1, 4)}e${str.length - 1}`;
}
void LOG10_FACT_52;

function describeNode(e: { kind: string; per?: number; add?: number; way?: string }): string {
  switch (e.kind) {
    case 'globalMult': return `+${Math.round((e.per ?? 0) * 100)}% to everything, forever, per level`;
    case 'keepAwake': return `${e.add ?? 0} more cards stay awake through a cut`;
    case 'startCharge': return `awake cards begin a run with +${e.add ?? 0} charge`;
    case 'offlineHours': return `+${e.add ?? 0} h of earning while away`;
    case 'cutYield': return `+${Math.round((e.per ?? 0) * 100)}% Cuts per cut`;
    case 'dealerUnlock': return `the dealer is always on staff`;
    case 'dealerSpeed': return `the dealer plays ${Math.round((e.per ?? 0) * 100)}% faster per level`;
    case 'burstMult': return `+${Math.round((e.per ?? 0) * 100)}% to the win burst`;
    case 'sparkMult': return `+${Math.round((e.per ?? 0) * 100)}% to sparks`;
    case 'wayUnlock': return `opens the Way of the ${e.way === 'gambler' ? 'Gambler' : 'Scholar'}`;
    case 'markSlots': return `+${e.add ?? 0} Mark slot (Marks arrive with M4)`;
    default: return '';
  }
}
function suitName(s?: string): string {
  return s === 'S' ? 'spades' : s === 'H' ? 'hearts' : s === 'D' ? 'diamonds' : s === 'C' ? 'clubs' : 'a suit';
}

export { SAVE_VERSION };
