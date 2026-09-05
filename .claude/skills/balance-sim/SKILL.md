---
name: balance-sim
description: Run the headless balance simulator on the real engine and compare against the pacing contract in docs/02-game-design.md. Use after any economy/content change.
---
# Balance sim

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null; npm run sim -- 2 engaged
```
Profiles: `engaged` (perfect greedy buyer, plays hands continuously), `relaxer` (3 hands, then idle
until next day), `idle` (never plays after the first hand). Output: first-cut time, cuts/hour, awake
count over time, rate curve, divergence check. Compare to the table in `docs/02-game-design.md §9`.
If a target must move: edit the doc first, then the test window, and log it in `memory/tuning-log.md`.
