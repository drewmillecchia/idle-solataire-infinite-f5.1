/**
 * Save (de)serialization. Defensive: a bad field falls back to the initial-state default, an
 * unparsable payload becomes a fresh state, and this never throws (CLAUDE.md invariant #10).
 */
/// <reference types="node" />
// Only a type reference (erased at compile time, no runtime import): `Buffer` below is a
// browser-safe fallback path, guarded by `typeof Buffer`, and must never force bundlers to
// resolve a Node built-in for the browser bundle.
import Decimal from 'break_eternity.js';
import { deckShape, deckSize, STANDARD_52 } from '../deck';
import { createInitialState, SAVE_VERSION } from '../state';
import type {
  GameRecord,
  GameState,
  HandState,
  MarksState,
  PlacedMark,
  PrestigeState,
  RunState,
  SettingsState,
  StatsState
} from '../state';
import { markDef, syncMarkCache } from '../marks/placement';
import { ROLL_MAX, ROLL_MIN } from '../economy/hand';
import { NUMBERING_ORDER } from '../numbering';
import type { CardState, NumberingId, WayId } from '../types';
import { migrateToCurrent } from './migrate';
import type { RawSave } from './migrate';

const WAY_IDS: readonly WayId[] = ['none', 'hand', 'dealer', 'gambler', 'scholar'];
const SHUFFLE_STYLES = ['riffle', 'overhand', 'random'] as const;

interface DecimalBox {
  $d: string;
}

function isDecimalBox(value: unknown): value is DecimalBox {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$d' in value &&
    typeof (value as Record<string, unknown>).$d === 'string'
  );
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Decimal) {
    return { $d: value.toString() } satisfies DecimalBox;
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (isDecimalBox(value)) {
    try {
      return new Decimal(value.$d);
    } catch {
      return new Decimal(0);
    }
  }
  return value;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state, replacer);
}

// ---- defensive field readers -------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toStr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toDecimal(value: unknown, fallback: Decimal): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    try {
      const d = new Decimal(value);
      if (!Decimal.isNaN(d)) return d;
    } catch {
      /* fall through to fallback */
    }
  }
  return fallback;
}

function toNumOrNull(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((v): v is string => typeof v === 'string');
}

function toStringNumberRecord(value: unknown, fallback: Record<string, number>): Record<string, number> {
  if (!isRecord(value)) return fallback;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * Repairs the card array to exactly `size` entries: too few are padded with fresh asleep cards,
 * too many are truncated (invariant #10: repair, never throw). `size` comes from the save's
 * (repaired) `deck` shape, not a hardcoded 52.
 */
function repairCards(value: unknown, size: number): CardState[] {
  const arr = Array.isArray(value) ? value : [];
  const out: CardState[] = [];
  for (let i = 0; i < size; i++) {
    const c = arr[i];
    if (isRecord(c)) {
      out.push({
        awake: toBool(c.awake, false),
        charge: Math.max(0, Math.floor(toNum(c.charge, 0))),
        marks: toStringArray(c.marks, [])
      });
    } else {
      out.push({ awake: false, charge: 0, marks: [] });
    }
  }
  return out;
}

/** Repairs the deck shape id: an unknown or missing id falls back to the standard 52. */
function repairDeckId(value: unknown): string {
  const raw = typeof value === 'string' ? value : STANDARD_52.id;
  return deckShape(raw).id;
}

function repairNumbering(value: unknown, fallback: NumberingId): NumberingId {
  return typeof value === 'string' && (NUMBERING_ORDER as readonly string[]).includes(value)
    ? (value as NumberingId)
    : fallback;
}

function repairNumberingList(value: unknown, fallback: NumberingId[]): NumberingId[] {
  if (!Array.isArray(value)) return fallback;
  const filtered = value.filter((v): v is NumberingId =>
    typeof v === 'string' && (NUMBERING_ORDER as readonly string[]).includes(v)
  );
  return filtered.length > 0 ? filtered : fallback;
}

/**
 * Per-hand Mark scratch. Ranks outside 1..13 and non-integer card ids are dropped, the
 * Gambler's wager is clamped into [ROLL_MIN, ROLL_MAX] so a hand-edited save cannot mint a x1e9
 * burst, `seed` falls back to 0 (the next `dealHand` overwrites it anyway), and `fizzleSeq` is a
 * non-negative integer (invariant #10: repair, never throw).
 */
function repairHand(value: unknown, fallback: HandState): HandState {
  if (!isRecord(value)) {
    return {
      echoRanks: [...fallback.echoRanks],
      homedThisHand: [...fallback.homedThisHand],
      roll: fallback.roll,
      seed: fallback.seed,
      fizzleSeq: fallback.fizzleSeq
    };
  }
  const ranks = Array.isArray(value.echoRanks) ? value.echoRanks : [];
  const homed = Array.isArray(value.homedThisHand) ? value.homedThisHand : [];
  const rawRoll = toNum(value.roll, fallback.roll);
  return {
    echoRanks: ranks.filter((r): r is number => typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 13),
    homedThisHand: homed.filter((c): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < 52),
    roll: Math.min(ROLL_MAX, Math.max(ROLL_MIN, rawRoll)),
    seed: toNum(value.seed, fallback.seed),
    fizzleSeq: Math.max(0, Math.floor(toNum(value.fizzleSeq, fallback.fizzleSeq)))
  };
}

/**
 * Placed marks, the source of truth for the whole Mark system, so this is the strictest repair in
 * the file: an unknown mark id, the wrong number of cards for its arity, a card id off the deck, a
 * repeated card inside a Twin, or a card already carrying a mark it cannot share with (a card holds
 * one mark, plus at most one Twin) all drop the placement rather than the save (invariant #10).
 */
function repairMarks(value: unknown): MarksState {
  if (!isRecord(value)) return { placed: [] };
  const raw = Array.isArray(value.placed) ? value.placed : [];
  const out: PlacedMark[] = [];
  const takenTwin = new Set<number>();
  const takenOther = new Set<number>();
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const def = typeof entry.mark === 'string' ? markDef(entry.mark) : undefined;
    if (!def) continue;
    const cardsRaw = Array.isArray(entry.cards) ? entry.cards : [];
    const cards = cardsRaw.filter(
      (c): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < 52
    );
    if (cards.length !== def.arity) continue;
    if (new Set(cards).size !== cards.length) continue;
    const bucket = def.id === 'twin' ? takenTwin : takenOther;
    if (cards.some((c) => bucket.has(c))) continue;
    for (const c of cards) bucket.add(c);
    out.push({ mark: def.id, cards });
  }
  return { placed: out };
}

function repairRun(value: unknown, fallback: RunState): RunState {
  if (!isRecord(value)) return fallback;
  const way = typeof value.way === 'string' && (WAY_IDS as readonly string[]).includes(value.way)
    ? (value.way as WayId)
    : fallback.way;
  return {
    way,
    startedAt: toNum(value.startedAt, fallback.startedAt),
    earnedAtStart: toDecimal(value.earnedAtStart, fallback.earnedAtStart),
    cutAvailableSeenAt: toNumOrNull(value.cutAvailableSeenAt, fallback.cutAvailableSeenAt),
    upgrades: toStringNumberRecord(value.upgrades, {}),
    handsPlayed: Math.max(0, Math.floor(toNum(value.handsPlayed, fallback.handsPlayed))),
    handsWon: Math.max(0, Math.floor(toNum(value.handsWon, fallback.handsWon))),
    homedThisRun: Math.max(0, Math.floor(toNum(value.homedThisRun, fallback.homedThisRun))),
    undosThisHand: Math.max(0, Math.floor(toNum(value.undosThisHand, fallback.undosThisHand))),
    hand: repairHand(value.hand, fallback.hand)
  };
}

function repairWays(value: unknown, fallback: WayId[]): WayId[] {
  if (!Array.isArray(value)) return fallback;
  const filtered = value.filter((v): v is WayId =>
    typeof v === 'string' && (WAY_IDS as readonly string[]).includes(v)
  );
  return filtered.length > 0 ? filtered : fallback;
}

function repairPrestige(value: unknown, fallback: PrestigeState): PrestigeState {
  if (!isRecord(value)) return fallback;
  return {
    cuts: toDecimal(value.cuts, fallback.cuts),
    lifetimeCuts: toDecimal(value.lifetimeCuts, fallback.lifetimeCuts),
    // Clamped into [0, lifetimeCuts]: a cycle start beyond the lifetime would make `cycleCuts`
    // negative, and a negative one would mint Permutations from nothing.
    cutsAtCycleStart: clampCycleStart(
      toDecimal(value.cutsAtCycleStart, fallback.cutsAtCycleStart),
      toDecimal(value.lifetimeCuts, fallback.lifetimeCuts)
    ),
    cutsPerformed: Math.max(0, Math.floor(toNum(value.cutsPerformed, fallback.cutsPerformed))),
    permutations: toDecimal(value.permutations, fallback.permutations),
    lifetimePermutations: toDecimal(value.lifetimePermutations, fallback.lifetimePermutations),
    reshuffles: Math.max(0, Math.floor(toNum(value.reshuffles, fallback.reshuffles))),
    constellation: toStringNumberRecord(value.constellation, {}),
    waysUnlocked: repairWays(value.waysUnlocked, fallback.waysUnlocked)
  };
}

/** A cycle start is meaningful only inside [0, lifetimeCuts]. */
function clampCycleStart(start: Decimal, lifetimeCuts: Decimal): Decimal {
  if (Decimal.isNaN(start) || start.lt(0)) return new Decimal(0);
  return start.gt(lifetimeCuts) ? lifetimeCuts : start;
}

function repairSettings(value: unknown, fallback: SettingsState): SettingsState {
  if (!isRecord(value)) return fallback;
  const style = typeof value.shuffleStyle === 'string' &&
    (SHUFFLE_STYLES as readonly string[]).includes(value.shuffleStyle)
    ? (value.shuffleStyle as SettingsState['shuffleStyle'])
    : fallback.shuffleStyle;
  return {
    sound: toBool(value.sound, fallback.sound),
    haptics: toBool(value.haptics, fallback.haptics),
    reducedMotion: toBool(value.reducedMotion, fallback.reducedMotion),
    autoDealerDelaySeconds: toNum(value.autoDealerDelaySeconds, fallback.autoDealerDelaySeconds),
    shuffleStyle: style,
    cloud: toBool(value.cloud, fallback.cloud),
    volume: Math.max(0, Math.min(1, toNum(value.volume, fallback.volume)))
  };
}

function repairStats(value: unknown, fallback: StatsState): StatsState {
  if (!isRecord(value)) return fallback;
  return {
    totalHomed: Math.max(0, Math.floor(toNum(value.totalHomed, fallback.totalHomed))),
    totalHands: Math.max(0, Math.floor(toNum(value.totalHands, fallback.totalHands))),
    totalWins: Math.max(0, Math.floor(toNum(value.totalWins, fallback.totalWins))),
    bestRate: toDecimal(value.bestRate, fallback.bestRate),
    playSeconds: Math.max(0, toNum(value.playSeconds, fallback.playSeconds)),
    fastestCutSeconds: toNumOrNull(value.fastestCutSeconds, fallback.fastestCutSeconds),
    totalCuts: Math.max(0, Math.floor(toNum(value.totalCuts, fallback.totalCuts))),
    perGame: repairPerGame(value.perGame)
  };
}

/** Per-game records: an entry with a bad shape is dropped rather than dragging the save down. */
function repairPerGame(value: unknown): Record<string, GameRecord> {
  if (!isRecord(value)) return {};
  const out: Record<string, GameRecord> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    out[id] = {
      hands: Math.max(0, Math.floor(toNum(entry.hands, 0))),
      wins: Math.max(0, Math.floor(toNum(entry.wins, 0))),
      bestSeconds: toNumOrNull(entry.bestSeconds, null)
    };
  }
  return out;
}

function repairGameConfig(value: unknown): Record<string, Record<string, string>> {
  if (!isRecord(value)) return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [game, cfg] of Object.entries(value)) {
    if (!isRecord(cfg)) continue;
    const inner: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === 'string') inner[k] = v;
    }
    out[game] = inner;
  }
  return out;
}

function repair(raw: RawSave, now: number): GameState {
  const initial = createInitialState(now);
  const deckId = repairDeckId(raw.deck);
  const cardCount = deckSize(deckShape(deckId));
  const state: GameState = {
    version: SAVE_VERSION,
    createdAt: toNum(raw.createdAt, initial.createdAt),
    lastSeenAt: toNum(raw.lastSeenAt, now),
    shuffles: toDecimal(raw.shuffles, initial.shuffles),
    lifetimeShuffles: toDecimal(raw.lifetimeShuffles, initial.lifetimeShuffles),
    cards: repairCards(raw.cards, cardCount),
    deck: deckId,
    numbering: repairNumbering(raw.numbering, initial.numbering),
    unlockedNumberings: repairNumberingList(raw.unlockedNumberings, initial.unlockedNumberings),
    run: repairRun(raw.run, initial.run),
    prestige: repairPrestige(raw.prestige, initial.prestige),
    marks: repairMarks(raw.marks),
    revealed: toStringArray(raw.revealed, []),
    milestones: toStringArray(raw.milestones, []),
    settings: repairSettings(raw.settings, initial.settings),
    stats: repairStats(raw.stats, initial.stats),
    activeGame: toStr(raw.activeGame, initial.activeGame),
    gameConfig: repairGameConfig(raw.gameConfig)
  };
  // `cards[i].marks` is a cache: rebuild it from the placements rather than trusting the file.
  syncMarkCache(state);
  return state;
}

/** Parses and repairs a save. Never throws: bad input becomes a fresh initial state. */
export function deserialize(json: string): GameState {
  const now = Date.now();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json, reviver);
  } catch (err) {
    console.warn('[save] could not parse save data; starting fresh', err);
    return createInitialState(now);
  }
  if (!isRecord(parsed)) {
    console.warn('[save] save data was not an object; starting fresh');
    return createInitialState(now);
  }
  const migrated = migrateToCurrent(parsed);
  return repair(migrated, now);
}

// ---- export/import strings (base64 of `serialize`) ----------------------------------------
// `btoa`/`atob` come from the DOM lib (browser/PWA); Node lacks them, hence the Buffer fallback.

function toBase64(json: string): string {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(json)));
  }
  return Buffer.from(json, 'utf-8').toString('base64');
}

function fromBase64(b64: string): string {
  if (typeof atob === 'function') {
    return decodeURIComponent(escape(atob(b64)));
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}

export function exportString(state: GameState): string {
  return toBase64(serialize(state));
}

export function importString(s: string): GameState {
  let json: string;
  try {
    json = fromBase64(s);
  } catch (err) {
    console.warn('[save] could not decode export string; starting fresh', err);
    return createInitialState(Date.now());
  }
  return deserialize(json);
}
