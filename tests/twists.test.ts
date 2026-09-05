import { describe, expect, it } from 'vitest';
import { EventBus } from '$engine/events';
import { createInitialState, type GameState } from '$engine/state';
import { cardId } from '$engine/types';
import { derive } from '$engine/economy/derive';
import { placeMark, removeMark } from '$engine/marks/placement';
import { NO_ENGINE_TWISTS, twistsFor, type EngineTwists } from '$engine/marks/twists';
import { D } from '$engine/numbers';
import { NO_TWISTS, type Twists } from '$rules/module';

/** 10 lifetime Cuts unlocks Wild, Mirror and Glass; the slot nodes give room for all three. */
function twistState(): GameState {
  const state = createInitialState(0);
  state.prestige.lifetimeCuts = D(10);
  state.prestige.constellation['first-mark'] = 3;
  return state;
}

const WILD = cardId('S', 1);
const MIRROR = cardId('H', 7);
const GLASS = cardId('C', 12);
const PLAIN = cardId('D', 4);

describe('twistsFor', () => {
  it('reflects exactly the placed rule-twist marks', () => {
    const state = twistState();
    const bus = new EventBus();
    const d = derive(state);
    expect(placeMark(state, bus, d, 'wild', [WILD])).toBe(true);
    expect(placeMark(state, bus, derive(state), 'mirror', [MIRROR])).toBe(true);
    expect(placeMark(state, bus, derive(state), 'glass', [GLASS])).toBe(true);

    const twists = twistsFor(state);
    expect(twists.isWild(WILD)).toBe(true);
    expect(twists.isMirror(MIRROR)).toBe(true);
    expect(twists.dealtFaceUp(GLASS)).toBe(true);

    // Each twist is its own: a Wild card is not a Mirror.
    expect(twists.isMirror(WILD)).toBe(false);
    expect(twists.isWild(MIRROR)).toBe(false);
    expect(twists.dealtFaceUp(WILD)).toBe(false);
    expect(twists.isWild(PLAIN)).toBe(false);
    expect(twists.isMirror(PLAIN)).toBe(false);
    expect(twists.dealtFaceUp(PLAIN)).toBe(false);
  });

  it('reads the state live, so removing a mark removes the twist', () => {
    const state = twistState();
    const bus = new EventBus();
    placeMark(state, bus, derive(state), 'wild', [WILD]);
    const twists = twistsFor(state);
    expect(twists.isWild(WILD)).toBe(true);

    removeMark(state, 'wild');
    expect(twists.isWild(WILD)).toBe(false);
  });

  it('an unmarked deck twists nothing', () => {
    const twists = twistsFor(createInitialState(0));
    for (let id = 0; id < 52; id++) {
      expect(twists.isWild(id)).toBe(false);
      expect(twists.isMirror(id)).toBe(false);
      expect(twists.dealtFaceUp(id)).toBe(false);
    }
    expect(NO_ENGINE_TWISTS.isWild(0)).toBe(false);
    expect(NO_ENGINE_TWISTS.isMirror(0)).toBe(false);
    expect(NO_ENGINE_TWISTS.dealtFaceUp(0)).toBe(false);
  });
});

describe('the engine/rules seam', () => {
  it('the engine shape is assignable to the rules contract, both ways, without either importing the other', () => {
    // `engine/` must not import `rules/` (CLAUDE.md invariant #1), so `EngineTwists` is a copy of
    // `Twists`. This test is the thing that notices if the two ever drift apart.
    const state = twistState();
    placeMark(state, new EventBus(), derive(state), 'wild', [WILD]);

    const asRulesTwists: Twists = twistsFor(state);
    expect(asRulesTwists.isWild(WILD)).toBe(true);

    const asEngineTwists: EngineTwists = NO_TWISTS;
    expect(asEngineTwists.isWild(WILD)).toBe(false);
  });
});
