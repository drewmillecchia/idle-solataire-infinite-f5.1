# Idle Solitaire Infinite

A quiet desk, a deck of cards, and 52! arrangements to witness. An idle/incremental solitaire game
for iPad (landscape, as a PWA) and desktop browsers.

- **Design & decisions:** [`docs/`](docs/00-index.md) — start with the vision and the game design.
- **Working handbook (for humans and AI agents):** [`CLAUDE.md`](CLAUDE.md).
- **Ideas:** [`brainstorming/`](brainstorming/README.md). **Lessons:** [`memory/`](memory/README.md).

## Run it

```bash
nvm use            # Node 22
npm install
npm run dev        # http://localhost:3000, also reachable on the LAN
npm test           # engine + rules tests
npm run test:browser  # real-gesture tests in headless Chromium
```

The previous implementation (`old_idle-solitaire-infinite/`) is kept locally as a design reference and is not committed.
