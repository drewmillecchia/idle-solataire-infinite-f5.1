# Idle Solitaire Infinite — f5.1 rebuild

An idle/incremental solitaire game. Your score is the count of deck arrangements witnessed on the
way to **52! ≈ 8.07×10⁶⁷**; the 52 cards are generators that wake when first played home and charge
each time after. PWA, iPad landscape first, desktop equal. **Design and decisions live in
[`docs/`](docs/00-index.md) — read `01-vision` and `02-game-design` before changing game behaviour.**
This file is the working handbook.

## Environment (WSL, Claude Desktop)

`node` is **not** on the non-interactive PATH (the default `npm` is Windows'). Prefix every node/npm
command:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
```

| Command | Does |
| --- | --- |
| `npm run dev` | Vite on `0.0.0.0:3000` (strict port) — reachable from the iPad on the LAN |
| `npm run check` | `svelte-check` + `tsc --noEmit` — must be clean before committing |
| `npm test` | Vitest (engine, rules, contract, balance) |
| `npm run test:browser` | Real-gesture tests against a `vite preview` build (playwright-core + chrome-headless-shell) |
| `npm run sim -- <hours> [profile]` | Headless balance sim on the real engine |
| `npm run shot` | Screenshot the running dev server at 1180×820 → `tools/out/` |
| `npm run build` | Type-check + production PWA build |
| `npm run server` | Hono save API on 3001 (M7+) |

Headless Chromium: `~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`
(installed by a sibling repo; `tools/` scripts point at it). LAN address of this WSL box changes; the
user reaches Vite via the Windows host's IP with port 3000 forwarded.

## Stack (why: `docs/03-decisions.md`)
Vite 8 · TypeScript 5.9 strict · **Svelte 5 runes** (UI shell only) · **PixiJS 8** (the table) ·
break_eternity.js `Decimal` (economy) · `bigint` (52! odometer) · Zod (content) · Vitest ·
vite-plugin-pwa · Hono + SQLite→DynamoDB (server, later).

## Layout
```
src/
  engine/     PURE TS. Economy, cards, marks, prestige, tick, save. No DOM/Svelte/Pixi. Runs in Node.
  rules/      PURE TS. GameModule contract, registry, games/<name>.ts, autoplay, solver.
  table/      PixiJS renderer + interaction (feel). Consumes BoardView; knows no game.
  ui/         Svelte 5. host.svelte.ts is the ONE place engine meets framework. Panels, HUD.
  content/    JSON: upgrades, marks, constellation, milestones, feel.json. Zod schemas beside them.
  audio/      SoundPresenter (synth), HapticPresenter.
  platform/   storage (IDB + localStorage + export), pwa, cloud tier.
sim/          Headless balance simulator driving the real engine.
tests/        Vitest. tools/  playwright scripts (shot, gestures). server/  Hono API (M7).
docs/  brainstorming/  memory/  .claude/{agents,skills}
```

## Non-negotiable invariants
1. `engine/` and `rules/` import nothing from `ui/`, `table/`, `platform/`, `audio/`, Svelte, Pixi, or the DOM.
2. **One derivation pass**: every multiplier is assembled in `engine/economy/derive.ts`. Nowhere else.
3. **Offline reuses the live `step`**; `step` never clamps its delta (the host loop does).
4. **Prestige**: threshold scales with the *full* current multiplier; multiplier reads *lifetime* Cuts, never the balance.
5. **`lifetimeShuffles` is monotonic** through every reset. It is the odometer and the cloud-save conflict key.
6. Logic emits **events** (`card-home`, `hand-won`, `milestone`…); presenters decide visuals/sound/haptics. Rules and economy never mention animation.
7. A **game module owns cloning** its board; rules are immutable; no generic structured-clone.
8. **Drop targets span a pile's whole occupied extent.**
9. **Feel constants live in `content/feel.json`**, never inline. If you're typing a spring constant into a `.ts` file, stop.
10. Save loading is **defensive** — a bad field falls back, never throws. Bump `SAVE_VERSION` + add a migration for any state shape change.
11. Content JSON is Zod-validated at load; a malformed entry fails loudly.
12. Adding a game touches `rules/games/<name>.ts` + `rules/registry.ts` only. If `table/` or the host needs edits, fix the contract.
13. The engine's mutable `state` is not a rune; UI reads the `$state` **view snapshot** pushed at ~10 Hz.

## Working agreements
- Engine before UI: a pure function with a test before a component reads it.
- Nothing merges without its milestone exit check (`docs/08-roadmap.md`). Gates: `check` → `test` →
  `test:browser` (for table/host/rules) → `sim` (for balance) → orchestrator reads the diff.
- After touching the table, host seam, or a game: run the real-gesture test. Unit tests can't see that seam.
- Balance windows in tests move deliberately, in `docs/02-game-design.md` first. Never widen silently.
- Commit per logical change; push to `main` after milestones or a solid working state.
  `old_idle-solitaire-infinite/` is gitignored reference — never commit it.
- Use subagents for well-specified slices (see `docs/10-orchestration.md`); the orchestrator reviews every diff.
- Log lessons in `memory/lessons.md`; log tuning sessions in `memory/tuning-log.md`.
- Tone in UI copy: dry, warm, short. No exclamation marks in the ledger. No emoji in code or UI.

## Status (2026-09-05, end of session 1)
- **M0 done** — docs, handbook, agents/skills, Vite 8 + Svelte 5 + Pixi 8 scaffold, Night Desk shell, Feel Lab.
- **M1 done** — pure engine: numbers, 7 numbering systems (normalised), cards-as-generators, one-pass
  `derive`, 20 Hz `step` + `applyOffline` (reuses step), save v1 (defensive, migrations), run upgrades +
  milestones as Zod-validated JSON. 56 tests.
- **M2 mostly done** — Klondike module + registry + greedy autoplay (22/60 wins); Pixi table with
  tap / drag / tilt / target glow / throw-catch / return-shake / flip / deal choreography; host seam with
  loop, Auto-Dealer, tiered save; synth sounds; real-gesture browser test green. **Open:** win celebration
  cascade, riffle choreography (sound exists, animation does not), real-iPad drag-feel pass.
- **M3 done** — Cut the Deck (`economy/prestige.ts`, scale-free potential, CUT_BASE 1e6, exponent 0.5),
  the Constellation (14 nodes, 5 branches), Ways (Hand/Dealer live; Gambler/Scholar unlock nodes only),
  save v2, `tests/balance.test.ts` asserts the pacing contract (first cut median 17 min). Cut/Stars
  panels reveal when a cut first becomes reachable; the cut runs the table's ceremony.
- **TriPeaks shipped** as the contract proof with zero renderer changes.
- **M4 done** — Marks: `content/marks.json` (ten, one-sentence rules, glyphs), `engine/marks/` (placement with
  slots, interpreter over the bus with `DEPTH_CAP` 3, `twistsFor(state)` feeding the rules' `Twists`), Lantern/
  Tithe in derive, Anchor in performCut, Heavy via the host's `card-moved` event, save v3. Placement UI lives in
  the Deck panel; glyphs render on the cards. 213 tests + `tools/marks-flow.mjs`.
- Next: M5 the long game (Reshuffle → Permutations, numbering ladder, 52! odometer + sky, Gambler/Scholar).
