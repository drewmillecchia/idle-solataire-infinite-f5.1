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
