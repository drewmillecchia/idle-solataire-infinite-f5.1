/**
 * THE contract a card game implements. The table renderer and the host seam know only this.
 * A new game = one file in rules/games/ + one line in registry.ts. Nothing under table/ or ui/ changes.
 * If it must, the contract is wrong — fix it here, never route around it.
 *
 * Rules are IMMUTABLE and PURE. A move returns a fresh board. The module owns clone() and hash().
 */
import type { CardId } from '$engine/types';

export type PileKind = 'stock' | 'waste' | 'foundation' | 'tableau' | 'cell' | 'peak' | 'discard';

/** Shared geometry: part of the rendering contract so layout and rules agree. */
export const CARD_ASPECT = 0.7; // width / height
export const FAN_UP = 0.28; // vertical offset between fanned face-up cards, in card heights
export const FAN_DOWN = 0.14; // between face-down cards
export const FAN_SIDE = 0.22; // horizontal offset for sideways fans (waste in draw-3), in card widths

export interface BoardCardView {
  /**
   * The card id — ALWAYS present, including for face-down cards, so the renderer can keep one stable
   * sprite per card through flips and deals. (The renderer shows the back when faceUp is false; this is
   * a single-player game and the view is not a security boundary.) `null` is tolerated for legacy
   * modules and rendered as an anonymous back.
   */
  id: CardId | null;
  faceUp: boolean;
}

export interface PileView {
  id: string;
  kind: PileKind;
  /** Position on a grid measured in card widths (x) and card heights (y). */
  x: number;
  y: number;
  fan: 'none' | 'down' | 'right' | 'down-tight';
  cards: BoardCardView[];
  /** Cards from this index onward are pickable (per rules); undefined = none. */
  pickableFrom?: number;
  /** Overlapping-pile hint for layouts like TriPeaks where a card is blocked by cards above it. */
  covered?: boolean;
  blocked?: boolean;
  /** Draw an empty-slot outline when the pile is empty. Defaults to true except for kind 'peak'. */
  slot?: boolean;
}

export interface BoardView {
  cols: number; // grid extent in card widths
  rows: number; // grid extent in card heights
  /**
   * Piles PAINT IN ARRAY ORDER: a later pile draws on top of an earlier one, and the topmost card under
   * the pointer wins hit-testing. Overlapping layouts (TriPeaks rows) rely on this — list lower rows later.
   */
  piles: PileView[];
}

export type RulesEvent =
  | { type: 'flip'; pile: string; index: number }
  | { type: 'recycle' }
  | { type: 'draw'; count: number };

export interface MoveResult<B> {
  board: B;
  /** Cards that reached "home" (foundation / removed) this move; the engine wakes or charges each. */
  homed: CardId[];
  changed: boolean;
  won: boolean;
  events: RulesEvent[];
}

export interface GameOption {
  id: string;
  label: string;
  kind: 'select';
  values: { value: string; label: string }[];
  default: string;
}
export type GameConfig = Record<string, string>;

/** Rule-twist Marks the module MAY consult. A module that ignores twists is still valid. */
export interface Twists {
  isWild(card: CardId): boolean;
  isMirror(card: CardId): boolean;
  dealtFaceUp(card: CardId): boolean;
}
export const NO_TWISTS: Twists = { isWild: () => false, isMirror: () => false, dealtFaceUp: () => false };

export interface GameModule<B = unknown> {
  id: string;
  name: string;
  blurb: string;
  options: GameOption[];
  /** Which twist kinds this game honours (for UI hints). */
  honours: ('wild' | 'mirror' | 'glass')[];

  deal(rng: () => number, config: GameConfig, twists: Twists): B;
  view(board: B): BoardView;

  canPickUp(board: B, pile: string, index: number, twists: Twists): boolean;
  legalTargets(board: B, pile: string, index: number, twists: Twists): string[];
  autoTarget(board: B, pile: string, index: number, twists: Twists): string | null;
  move(board: B, pile: string, index: number, toPile: string, twists: Twists): MoveResult<B>;
  /** Tap on the stock: draw / recycle. No-op result if the game has no stock. */
  draw(board: B, twists: Twists): MoveResult<B>;

  isWon(board: B): boolean;
  /** No legal move exists anywhere (including draws that could change anything). */
  isStuck(board: B, twists: Twists): boolean;
  /** Stable hash of the board for cycle detection in autoplay. */
  hash(board: B): string;
  clone(board: B): B;
}

export function noop<B>(board: B): MoveResult<B> {
  return { board, homed: [], changed: false, won: false, events: [] };
}

export function optionValue(module: GameModule, config: GameConfig | undefined, id: string): string {
  const opt = module.options.find((o) => o.id === id);
  const v = config?.[id];
  if (opt && v !== undefined && opt.values.some((x) => x.value === v)) return v;
  return opt?.default ?? '';
}
