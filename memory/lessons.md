# Lessons learned

Newest first. One entry per lesson: **what happened → what we do now.**

## 2026-09-05 — inherited from prior codebases (see docs/04-research.md §9)
- Absolute prestige gain diverges → threshold scales with the full current multiplier; multiplier reads lifetime cuts.
- Two rate computations drifted → one derivation pass.
- Offline formula drifted from live → offline reuses `step`, with a test.
- Structured-clone on reactive proxies threw silently → modules own cloning; no bare `catch`.
- Drop targets on the origin card missed fanned columns → targets span the pile's extent.
- Fixed design canvas was wrong on every device but one → fit a card-unit grid to the felt.
- Greedy autoplay cycled forever with unlimited redeals → hash boards, detect cycles.
- Unit tests never saw the engine/host seam → real-gesture browser tests.
- Plugin contracts leaked `if (gameId)` into shared code → the contract is the only surface; fix it, don't route around it.

## 2026-09-05 — session 3 (M5–M7)
- **`pkill -f <pattern>` kills the shell running it** when the pattern appears in that shell's own command line (exit 144). → `pgrep -f "[v]ite preview" | xargs -r kill` (the bracket trick), or kill by port.
- **Killing an `npx` spawn leaves the real server on the port.** → Spawn `node_modules/.bin/<tool>` directly, `detached: true`, and kill the process group.
- **`vite preview` needs its own `preview.proxy`** — the dev `server.proxy` does not apply, so browser probes against a preview build silently 404 on `/api`.
- **Tests that mutate engine state directly must flag the view's list cache** (`host.markSlow()`) now that lists rebuild on events or every 500 ms; a probe that reads `view.*` right after poking `state.*` is otherwise racy.

## 2026-09-05 — session 3 review (20 confirmed findings from a read-only Opus pass)
- **Pixi 8 never dispatches `pointercancel`** — the stage listener was dead code; a system gesture mid-drag stranded the drag forever. → Listen on the canvas element itself, plus a 3 s drag watchdog.
- **Defensive deserialize hid import failures**: `importString` returned a blank state instead of throwing, so "Import" wiped the save with a success message. → Validate the payload before adopting it; never persist on failure. A function that never throws needs a caller that checks.
- **Any DOM button can interrupt a canvas choreography** (New hand during the cut ceremony dropped `performCut` and left `cutting` stuck). → Guard host actions on `cutting`; `cancelChoreography` aborts throws; long-lived callbacks verify the board they act on.
- **Unit tests could not see the Klondike foundation round-trip farm** because autoplay refuses foundation pickups. → A card pays once per hand; read the *player's* affordances, not the sim's.
- **Sub-threshold offline gaps forfeited earnings** (only `gone > 30` applied offline). → Always apply; threshold only the notice.
- Review-worthy pattern: ask a reviewer for *concrete failure scenarios* and to separate confirmed from plausible; it produced 20 confirmed items with file:line in one pass.

## 2026-09-05 — session 3 (M3, M4)
- **A `cmd | tail -1 && git commit` chain committed on a failing gate** — the pipe's exit code is `tail`'s. → Gate chains use `set -o pipefail` or check the script's own exit; browser tools exit non-zero on failure for exactly this reason.
- While a background agent edits `src/engine`, the dev server hot-reloads half-written files and browser probes can fail transiently. → Rerun once before chasing; check `svelte-check` output for files you own.
- **"One mark per card" made the canonical Twin + Kindling combo impossible** — found by the browser flow test, not the unit tests, which tested the rule as specified. → Twin is the wire: it may share a card with one other mark. Write the *combo* you want first, then the constraint.
- A Twin pair rings once (A→B→A at depth 2) before the cap, so a twinned card gains roughly double charge. Intended "surprising combination" feel; balance later, don't remove.
- Cuts/hour came out 2–3 not 3–6 because the potential is scale-free by design and the sim's cut policy is proportional to lifetime cuts. → Restated the target (2–4) in the doc *before* touching the test.

## 2026-09-05 — session 2 (M2 completion, TriPeaks)
- **Headless WebGL screenshots can capture a half-drawn frame** (felt yes, cards no) even though the scene graph is fine. → `preserveDrawingBuffer: true` in DEV/test builds; probe the scene graph before chasing a "rendering bug".
- **Software GL in headless Chromium runs ~15 fps**, so any `await` inside a synthetic flick turns it into a slow drag. → Dispatch the flick's pointer events synchronously; the table clamps speed to `throwMaxPxPerS`.
- **Paint order was load-bearing but undocumented** — TriPeaks' overlapping rows only worked because the renderer assigned z in pile order. → Documented on `BoardView`; contract findings from a new game go straight into `docs/06-games.md`.
- **Shuffling at the stock slot pushed the left packet off the felt.** → Shuffle in the dealer's hands (felt centre), then slide the squared deck to the stock.

## 2026-09-05 — session 1 (M0 build)
- **Spring integrator diverged** at tiny `response` (0.02 s) with a fixed 8 ms sub-step: semi-implicit Euler needs ω·h ≲ 0.5. → Sub-step is `min(8 ms, response/12)`, capped at 400 steps. A test pins it (`tests/spring.test.ts`).
- **Pixi 8 sizing:** `renderer.width/height` are physical pixels; `app.screen` is logical (CSS) pixels. Dividing physical by DPR *again* drew the felt at a quarter size. → Always lay out from `app.screen`.
- **Buttons on paper panels** inherited the felt-shell's light text and vanished. → HoldButton reads `--btn-fg`/`--btn-bg` CSS vars so a paper container can recolour it.
- **Custom `.claude/agents/*` created mid-session are not loadable in that session.** → Use `general-purpose` with a `model` override and paste the agent's instructions into the brief.
- A stale Vite from the sibling v2 repo held port 3000 for 12 days. → Check `ss -ltnp | grep 3000` before assuming our server is the one answering.
