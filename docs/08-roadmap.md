# Roadmap

Vertical slices. Each milestone is playable, survives a reload, and has tests where the seam is
non-obvious. Status is kept here and in `CLAUDE.md`.

## M0 — Foundation ✅ (2026-09-05)
- Repo docs, brainstorming, memory, CLAUDE.md, agents, skills.
- Vite 8 + Svelte 5 + TS strict + PixiJS 8 + PWA scaffold; `npm run dev` on 0.0.0.0:3000.
- Night Desk tokens; app shell (HUD, felt, rail); Pixi table boots with a deck on the felt.
- **Exit:** loads on desktop and at 1180×820; a card can be dragged with the spring/tilt feel;
  Feel Lab panel edits `feel.json` live.

## M1 — Pure engine ✅ (2026-09-05)
- `Decimal` wiring; `numbers.ts` formatter (short scale → scientific → layered).
- Cards-as-generators (`awake`, `charge`), Natural numbering with normalisation machinery.
- One-pass `derive`; 20 Hz `step`; `applyOffline` reusing `step`; milestone cascade.
- State + save v1 (IndexedDB + localStorage + export) with defensive load + migrations.
- **Exit:** headless: a woken card raises rate; N s offline ≡ N s live; save round-trips.

## M2 — Klondike you can play ✅ (2026-09-05; riffle choreography, win cascade, tap-to-skip)
- `GameModule` contract + registry; immutable Klondike rules; seeded deals; undo.
- Table renders `BoardView`; tap-to-move, drag, throw-catch, flip, deal choreography.
- Home play wakes/charges; win → burst + non-modal cascade. Auto-Dealer (greedy + cycle detect).
- Real-gesture browser test drives pointer events at the canvas and asserts engine state.
- **Exit:** a full hand can be cleared by gestures alone; win pays exactly `deckRate × 60 × burstMult`.

## M3 — Run economy + first prestige ✅ (2026-09-05; Gambler/Scholar rules effects deferred to M5)
- Run upgrades (JSON + Zod): suit mults, charge mults, burst, awake/devotion effects.
- Cut the Deck + Constellation trunk; Ways of the Hand and the Dealer at the first cut.
- Headless sim; pacing tests (first cut 12–30 min; ≤ 3 reveals/min 1; no divergence in 24 h).
- **Exit:** sim passes; cut ceremony (riffle + lamp flicker) plays; Way choice changes a run.

## M4 — Marks
- Mark interpreter over the event bus (depth-capped chains); first six Marks; placement UI on the
  deck spread; rule-twist hook in Klondike (Wild, Mirror, Glass).
- **Exit:** Twin + Kindling chain observable in a test and on screen; a Wild card is placeable anywhere.

## M5 — The long game
- Reshuffle → Permutations; Numbering Systems ladder + selection; Mark slots from Permutations.
- The 52! odometer (bigint Lehmer) + the sky filling in the window; milestone ledger entries.
- Ways of the Gambler and the Scholar (with a Klondike solver worker for winnable deals).
- **Exit:** multi-hour sim finite; reshuffle strictly worth entering; sky renders 0→52!.

## M6 — Sound, haptics, second game
- Synth `SoundPresenter` (pick/slide/place/flip/riffle…); `HapticPresenter`; settings.
- TriPeaks as the contract proof; game browser.
- **Exit:** no edits under `table/` were needed for TriPeaks; sounds scale with velocity.

## M7 — Cloud save
- `server/` Hono + SQLite; session, GET/PUT with 409, history; client cloud tier with backoff.
- **Exit:** two browsers converge on the further-along save; killing the server changes nothing visible.

## M8 — Platform polish
- Real-iPad pass (drag feel, safe areas, standalone); Lighthouse PWA; reduced-motion; a11y layer.
- Golf, Pyramid; Idle Riffle toy; more shuffle styles.

## Later
Ascension (Joker → Stars ★), FreeCell, Spider, real auth, leaderboards-that-matter, DynamoDB.

## Build discipline
- Engine before UI: every economy rule is a pure function with a test before a component reads it.
- Nothing merges without its exit check. Commit at each milestone; push to main (personal repo).
- Real-gesture tests after touching the table, the host seam, or a game module.
