# Architecture Decision Records

Short. Decision, alternatives, why. Dated 2026-09-05 unless noted.

## ADR-001 — Vite 8 + TypeScript 5.9 strict, single root package
Vite for HMR, LAN-exposed dev on port 3000, trivial PWA build. TS strict because the economy is
numbers and a silent `undefined` is the worst class of bug. TypeScript 7 (native) exists but
`svelte-check` peers on `^5 || ^6`; stay on 5.9 until the Svelte toolchain moves.

## ADR-002 — Svelte 5 (runes) for the UI shell only
HUD, panels, settings, Constellation, ledger. Fine-grained compile-away reactivity suits dozens of
numbers ticking 10×/s. **The engine imports nothing from Svelte.** One file (`ui/host.svelte.ts`)
is where the engine meets the framework; components read a `$state` snapshot pushed at ~10 Hz.

## ADR-003 — PixiJS 8 renders the table (cards, piles, shuffles, FX)
**Alternatives:** DOM/CSS cards (4.6, 4.8), three.js (v1), canvas 2D by hand.
**Why Pixi:** feel is pillar #2. Throw physics, riffle/overhand/faro shuffle animations with all 52
cards in flight, card bend (mesh deformation), soft shadows that follow lift, glow on valid targets,
particles — all in **one scene graph with one hit-testing model** at a steady 60 fps on iPad. DOM
cards proved *adequate* in 4.6/4.8 but shadows/filters on moving elements repaint, 3D flips have iOS
quirks, and particles need a second canvas with a second coordinate space anyway. three.js was
overkill (v1). Pixi 8.20: WebGPU with WebGL fallback (and an experimental canvas fallback), federated
pointer events, ~450 KB — acceptable for a PWA that caches once.
**Cost:** text/card faces are textures. We render card faces from our own SVG to a texture atlas at
device DPR on load (crisp, themeable). Accessibility for the table is provided by an off-canvas
semantic layer (pile list + move buttons) rather than by the renderer.
**Rule:** the renderer consumes a game-agnostic `BoardView`. It knows no game.

## ADR-004 — break_eternity.js `Decimal` for the economy; `bigint` for the odometer
Economy compounds toward tetration (Numbering: Tetration; Ascension). break_eternity is the
incremental-genre standard (Antimatter Dimensions lineage), fast, with `tetrate/slog`. The 52!
odometer position is an *exact* integer (Lehmer code) and stays `bigint`, isolated from the rate
economy. (Odometer is flavour + milestone driver; it never feeds the multiplier chain.)

## ADR-005 — Pure engine, one derivation pass, events out
`src/engine` and `src/rules` import nothing from `ui`, `table`, `platform`, Svelte, or Pixi; they run
in plain Node (tests, sim). **Every multiplier is assembled in `engine/economy/derive.ts`** and
nowhere else — a prior build displayed one rate and applied another. Logic emits *what happened*
(`card-home`, `hand-won`, `milestone`); presenters (table FX, sound, haptics, toasts) decide how to
show it. Adding a visual or a sound never touches rules or economy.

## ADR-006 — Marks are data-driven rules over the event bus
A Mark is `{ trigger, condition, effect }` validated by Zod, interpreted by `engine/marks/`. Effects
may emit further events (chains) with a per-tick depth cap. Adding a Mark = a JSON entry + (rarely)
a new effect kind in the interpreter and `derive`. Rule-twist Marks expose a `rulesHook` the
GameModule consults (`canStack(a, b)`, `isFaceUpOnDeal(card)`).

## ADR-007 — Offline reuses the live `step`; `step` never clamps
`applyOffline` slices time and calls `step`. A test asserts live ≡ offline. The clamp for a restored
tab lives in the host loop, which routes long gaps to `applyOffline`.

## ADR-008 — Balance in JSON, Zod-validated, sim-asserted
Upgrades, Marks, Constellation nodes, milestones, feel tunables: JSON under `src/content/`. A malformed
entry fails loudly at load. `sim/` drives the real engine headlessly; pacing targets are tests.

## ADR-009 — Save: IndexedDB + localStorage mirror + export string; versioned migrations; cloud later
iOS can evict script-writable storage for origins not interacted with; standalone PWAs get memory
discarded on app-switch with no unload event. So: save on `visibilitychange` + 5 s autosave, store
twice, request `navigator.storage.persist()`, offer export/import. Cloud save (ADR-012) is a third
tier behind the same interface; the network is an optimisation, local is truth.

## ADR-010 — A game is one module implementing `GameModule`; rules are immutable
One file + one registry line. Rules return fresh boards (undo is free; no generic deep-clone, which
throws on reactive proxies). A contract test runs against every registry entry. If a new variant needs
edits under `table/` or the host, the contract is wrong and is fixed, not worked around.

## ADR-011 — Feel is configuration
All interaction constants live in `src/content/feel.json` (spring stiffness/damping, lift scale, tilt
gain, tap/drag thresholds, throw gain, hold-to-repeat curve, haptic patterns, sound gains). A dev
**Feel Lab** panel edits them live and exports JSON. Iterating feel must never mean editing code.

## ADR-012 — Backend: Hono + storage adapter; SQLite now, DynamoDB later
Hono runs identically on Node (`@hono/node-server`) and on Lambda (`hono/aws-lambda`). Handlers know
neither SQL nor the AWS SDK; a `SaveStore` interface has a SQLite implementation now and a DynamoDB
one later. Opaque blob + monotonic `progress` field + optimistic concurrency (409 with server state).
Anonymous device identity first; real auth is a separate decision. Details: [07-backend.md](07-backend.md).

## ADR-013 — Sound is synthesised first, sampled later
Card sounds (slide, place, flip, toss-land, riffle) start as Web Audio synthesis (filtered noise
bursts + envelopes) so they are parametric — velocity-scaled, pitch-varied per card, zero assets.
Recorded samples can layer in later behind the same `SoundPresenter` interface. Sound is off until
the first user gesture (iOS autoplay policy) and respects a master toggle.

## ADR-014 — Testing pyramid
Vitest unit tests for engine/rules (fast, many). Contract tests over the registry. Headless balance
sim as tests. **Real-gesture browser tests** (playwright-core + chrome-headless-shell, already present
on this machine) that drive pointer events at the Pixi canvas and assert on engine state — every
interaction bug in prior builds lived at the engine/host seam. Screenshot checks at 1180×820 (iPad
landscape) and 1440×900.
