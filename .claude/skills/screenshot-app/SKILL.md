---
name: screenshot-app
description: Screenshot the running Vite dev server (or preview) at iPad-landscape and desktop sizes using the local headless Chromium. Use to visually verify UI/table changes.
---
# Screenshot the app

1. Ensure the dev server is running (`npm run dev` in background, port 3000) or `vite preview --port 5200`.
2. Run, with the nvm prefix:
   ```bash
   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null; node tools/shot.mjs http://127.0.0.1:3000/ tools/out/shot.png
   ```
   Optional third arg: `1440x900` (default `1180x820`). The script waits for `window.__game` when present.
3. Read the PNG with the Read tool and judge it against `docs/09-art-direction.md`.
4. Page errors are printed by the script; treat any as a failure.
