---
name: gesture-test
description: Run the real-gesture browser test that drives pointer events at the Pixi table and asserts engine state. Required after touching src/table, src/ui/host.svelte.ts, or any rules module.
---
# Real-gesture test

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null; npm run test:browser
```
This builds, serves `vite preview` on 5200, runs `tools/gestures.mjs`, and exits non-zero on any failed
assertion or page error. The script uses `window.__game` (DEV/preview only) to pin a seed, read the
board, and ask the table for pile screen-points (`window.__table.targetPoint`). Assert on *state*,
never on "no error thrown". If a gesture can't reach a pile, the table's hit-testing is the bug.
