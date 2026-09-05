import type { WayId } from '$engine/types';

/** The Ways a run can be played (docs/02-game-design.md §5). Copy lives here so the UI stays dumb. */
export interface WayDef {
  id: Exclude<WayId, 'none'>;
  name: string;
  mood: string;
  blurb: string;
  mechanics: string;
}

export const WAYS: WayDef[] = [
  { id: 'hand', name: 'Way of the Hand', mood: 'Active, sharp', blurb: 'You play. The deck listens.', mechanics: 'Sparks pay three times. Wins pay twice.' },
  { id: 'dealer', name: 'Way of the Dealer', mood: 'Idle, watchful', blurb: 'Someone else turns the cards.', mechanics: 'The dealer works from the first minute. The deck earns half again as much; your own sparks pay half.' },
  { id: 'gambler', name: 'Way of the Gambler', mood: 'Variance', blurb: 'Every hand is a wager.', mechanics: 'Coming later. Each deal rolls a multiplier; wins re-roll upward.' },
  { id: 'scholar', name: 'Way of the Scholar', mood: 'Puzzle', blurb: 'Every deal can be won.', mechanics: 'Coming later. Winnable deals only; unlimited undo; wins charge the whole deck.' }
];
