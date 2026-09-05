/**
 * Rule-twist Marks (Wild, Mirror, Glass) as the read-only view a GameModule consults. PURE.
 *
 * The shape below is deliberately a COPY of `Twists` in `src/rules/module.ts`: CLAUDE.md invariant
 * #1 forbids `engine/` importing from `rules/`, and TypeScript's structural typing means the object
 * `twistsFor` returns is assignable to `rules`' `Twists` without either side importing the other.
 * If that interface changes, this one changes with it (the contract test crosses the seam).
 */
import type { GameState } from '../state';
import type { CardId } from '../types';
import { hasMark } from './placement';

/** Structural twin of `Twists` in `$rules/module`. Keep the two in step. */
export interface EngineTwists {
  isWild(card: CardId): boolean;
  isMirror(card: CardId): boolean;
  dealtFaceUp(card: CardId): boolean;
}

/** No twists at all — the shape a game gets when nothing is marked. */
export const NO_ENGINE_TWISTS: EngineTwists = {
  isWild: () => false,
  isMirror: () => false,
  dealtFaceUp: () => false
};

/**
 * The twists the currently placed marks impose. Reads `state` live, so a mark placed between hands
 * is honoured by the next deal without the host rebuilding anything.
 */
export function twistsFor(state: GameState): EngineTwists {
  return {
    isWild: (card) => hasMark(state, card, 'wild'),
    isMirror: (card) => hasMark(state, card, 'mirror'),
    dealtFaceUp: (card) => hasMark(state, card, 'glass')
  };
}
