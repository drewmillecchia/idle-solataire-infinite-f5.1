# Games: the contract and the roster

## The `GameModule` contract

A game is **one file** in `src/rules/games/` implementing `GameModule<B>` plus one line in
`src/rules/registry.ts`. Rules are pure and immutable (a move returns a new board). The table
renderer consumes only `BoardView`; the host seam consumes only `MoveResult`. A contract test runs
against every registry entry.

```ts
interface GameModule<B> {
  id: string; name: string; blurb: string;
  options: GameOption[];                       // declared settings, rendered generically
  deal(rng, config, twists): B;                // twists = active rule-twist Marks
  view(board): BoardView;                      // piles on a grid measured in card units
  canPickUp(board, pile, index): boolean;
  legalTargets(board, pile, index): string[];  // for glow + throw catch
  autoTarget(board, pile, index): string|null; // tap-to-move
  move(board, pile, index, toPile): MoveResult<B>;
  draw(board): MoveResult<B>;                  // stock tap (or no-op)
  isWon(board): boolean; isStuck(board): boolean;
  hash(board): string;                         // for autoplay cycle detection
  clone(board): B;                             // module owns cloning
}
```

`MoveResult` carries `homed: CardId[]` (the engine wakes/charges these), `changed`, `won`, and
`events` (e.g. `flip`) so presenters can react without knowing the game.

Rule-twist Marks reach rules through a `Twists` object the module *may* consult: `isWild(card)`,
`isMirror(card)`, `dealtFaceUp(card)`. A module that ignores twists is still valid.

## Roster

| Order | Game | Why it's here | Notes |
| --- | --- | --- | --- |
| 1 | **Klondike** (draw 1 / draw 3, redeal limit option) | The solitaire. ~82 % winnable; the familiar hand. | Ships in M2. Solver for Scholar deals in a worker later. |
| 2 | **TriPeaks** | Fast, forgiving (~90 % winnable), chains → sparks feel great. Proves the contract with a totally different layout. | Mostly tap-driven; also proves tap-first games. |
| 3 | **Golf** | Very short hands (~1–2 min). Low win rate makes wins special. | Matching sequence game. |
| 4 | **Pyramid** | A *matching* game (pairs to 13). Different mental mode. | Two-card selection interaction. |
| 5 | **FreeCell** | Nearly always winnable; the puzzle-lover's game. Way of the Scholar's home. | All face-up; drag-heavy. |
| 6 | **Spider** (1/2/4 suits) | Long, meditative, 104 cards. Only after Ascension logic handles >52. | Two decks = two of every generator; design later. |

Each game declares which Marks' rule-twists it honours. Charge/wake semantics are game-agnostic: any
card landing on a foundation (or being *removed* in TriPeaks/Golf/Pyramid) counts as "home".

## Deal generation
- `rng` is a seeded PRNG (mulberry32) so a hand can be replayed and a bug report can carry a seed.
- Way of the Scholar requests a **winnable** deal: for Klondike/FreeCell a solver in a Web Worker
  filters seeds (Klondike: thoughtful DFS with transposition table, budgeted; FreeCell: standard).
  TriPeaks/Golf/Pyramid use cheaper heuristics.

## Undo
Immutable boards make undo a stack of boards. Undo is free and unlimited in Scholar; elsewhere it is
free but a hand with undos pays 70 % burst on win (a nudge, not a punishment; tunable).
