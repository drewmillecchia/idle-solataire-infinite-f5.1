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

## 2026-09-05 — session 1 (M0 build)
- **Spring integrator diverged** at tiny `response` (0.02 s) with a fixed 8 ms sub-step: semi-implicit Euler needs ω·h ≲ 0.5. → Sub-step is `min(8 ms, response/12)`, capped at 400 steps. A test pins it (`tests/spring.test.ts`).
- **Pixi 8 sizing:** `renderer.width/height` are physical pixels; `app.screen` is logical (CSS) pixels. Dividing physical by DPR *again* drew the felt at a quarter size. → Always lay out from `app.screen`.
- **Buttons on paper panels** inherited the felt-shell's light text and vanished. → HoldButton reads `--btn-fg`/`--btn-bg` CSS vars so a paper container can recolour it.
- **Custom `.claude/agents/*` created mid-session are not loadable in that session.** → Use `general-purpose` with a `model` override and paste the agent's instructions into the brief.
- A stale Vite from the sibling v2 repo held port 3000 for 12 days. → Check `ss -ltnp | grep 3000` before assuming our server is the one answering.
