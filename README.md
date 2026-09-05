# Idle Solitaire Infinite

A quiet desk, a deck of cards, and 52! arrangements to witness.

Play a card home and it wakes. A woken card keeps counting arrangements for you forever, awake or not —
so the solitaire *is* the idle engine, not a minigame bolted onto one. There are fifty-two.

Built as a PWA for iPad in landscape, and equally for a desktop browser.

## What is in it

- **Five solitaires** through one contract: Klondike, TriPeaks, Golf, Pyramid, FreeCell.
- **Cards as generators.** Waking, charging, suits, and seven numbering systems that redistribute what a
  rank is worth without changing the deck's total.
- **Marks** — placed, combinable one-sentence rules (Twin, Kindling, Echo, Lantern, Wild…) that chain.
- **Ways** — how you play a run: the Hand, the Dealer, the Gambler, the Scholar (whose deals are proven
  winnable by a solver before they are dealt).
- **Three horizons** — run upgrades, Cut the Deck into a permanent Constellation, Reshuffle into
  Permutations that buy numbering systems.
- **Feel as a first-class system.** Every spring, threshold and curve lives in `src/content/feel.json` and is
  tunable live in the Feel Lab, with presets.
- **Synthesised sound.** No samples: paper, edge click and felt thud, mixed by velocity and pitched per card.
- Offline earnings, an opt-in cloud save, and a keyboard/screen-reader layer beside the canvas table.

## Run it

```bash
nvm use            # Node 22
npm install
npm run dev        # http://localhost:3000, reachable on the LAN for an iPad
npm run server     # optional: the cloud-save API on 3001, proxied at /api
```

| Command | What it does |
| --- | --- |
| `npm run check` | svelte-check + tsc |
| `npm test` | engine, rules, content and balance tests |
| `npm run test:browser` | real-gesture and real-touch tests against a production build |
| `npm run sim -- 2 engaged` | headless balance simulator on the real engine |
| `npm run shot` | screenshot the running app |

## Where things are

- **Design and decisions:** [`docs/`](docs/00-index.md) — start with the vision and the game design.
- **Working handbook** for humans and AI agents: [`CLAUDE.md`](CLAUDE.md).
- **What to try and report** after a session: [`docs/11-playtest-guide.md`](docs/11-playtest-guide.md).
- **Ideas:** [`brainstorming/`](brainstorming/README.md). **Lessons:** [`memory/`](memory/lessons.md).

`old_idle-solitaire-infinite/` is the previous implementation, kept locally as a design reference and not
committed.
