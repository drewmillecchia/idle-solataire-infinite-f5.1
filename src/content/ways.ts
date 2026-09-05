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
  { id: 'gambler', name: 'Way of the Gambler', mood: 'Variance', blurb: 'Every hand is a wager.', mechanics: 'Each deal rolls a multiplier between a half and three on sparks and the win burst. A win re-rolls and keeps the higher.' },
  { id: 'scholar', name: 'Way of the Scholar', mood: 'Puzzle', blurb: 'Every deal can be won.', mechanics: 'Every Klondike deal is proven winnable before it is dealt. Undo is free. Each charge is worth less, but every win charges the whole awake deck.' }
];
