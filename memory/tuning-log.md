# Tuning log

| Date | Area | Change | Why | Device |
| --- | --- | --- | --- | --- |
| 2026-09-05 | feel | initial `feel.json` defaults from docs/05-feel.md | starting point | headless |
| 2026-09-05 | economy (M3) | `CUT_BASE = 1e6`, `CUT_EXPONENT = 0.5` | swept CUT_BASE 4e4/2e5/5e5/1e6/3e6 → first cut at 6m34/10m39/16m08/18m47/18m47 (seed 1). 1e6 puts the first cut at a 17m20 median over seeds 1..5, all five inside the 12–30 min window, deck fully awake first on 4/5 | headless sim, 4 Hz |
| 2026-09-05 | economy (M3) | Constellation node costs are `ceil(cost × growth^level)` | Cuts are whole numbers, and `Decimal.pow(2,3) = 7.999999999999999` was making an exactly-affordable node unaffordable | headless |
| 2026-09-05 | economy (M3) | cuts/hour in hours 2–4 measured at 2–3 events (docs/02 §9 says 3–6); NOT widened, flagged in tests/balance.test.ts | the sim's `cutsOnCut ≥ 0.3 × lifetimeCuts` bar grows exponentially while `cutPotential` is deliberately scale-free (invariant #4), so runs must lengthen. Sweeping CUT_EXPONENT 0.5→1.25 and strengthening Kept Flame both left it at 2–3 | headless sim, 6 h engaged |
