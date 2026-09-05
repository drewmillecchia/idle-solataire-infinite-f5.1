# Idle Solitaire Infinite — docs

The decision log and design reference for the f5.1 rebuild (started 2026-09-05). Everything that is
*not* derivable from the code lives here. `CLAUDE.md` at the repo root is the working handbook; this
folder is the *why*.

| Doc | What's in it |
| --- | --- |
| [01-vision.md](01-vision.md) | What the game is, who it's for, the pillars, the tone. Read first. |
| [02-game-design.md](02-game-design.md) | The economy, cards-as-generators, Marks, Ways, prestige layers, Ascension, pacing contract. |
| [03-decisions.md](03-decisions.md) | Architecture Decision Records: stack and structure, with alternatives weighed. |
| [04-research.md](04-research.md) | 2026 research synthesis + hard-won lessons from the three prior codebases. |
| [05-feel.md](05-feel.md) | The interaction-feel specification: touch, drag, throw, buttons, hold-to-repeat, haptics, sound hooks. |
| [06-games.md](06-games.md) | The GameModule contract and the variant roster (rules, winnability, what each brings). |
| [07-backend.md](07-backend.md) | Cloud save design: API, conflict rule, SQLite→DynamoDB path, identity. |
| [08-roadmap.md](08-roadmap.md) | Milestones as vertical slices with exit checks. Status lives here. |
| [09-art-direction.md](09-art-direction.md) | "Night Desk" visual language: palette, cards, type, motion, the window. |
| [10-orchestration.md](10-orchestration.md) | How the AI dev team works: which model does what, review gates, commit policy. |
| [11-playtest-guide.md](11-playtest-guide.md) | What to try on the iPad after each session and what to report. |
| [12-ascension.md](12-ascension.md) | The endgame layer past 52!, and the deck-size refactor it needs first. |

The browser gate (`npm run test:browser`) runs `tools/{gestures,cut-flow,marks-flow,reshuffle-flow,cloud-probe,ipad-probe,riffle-probe}.mjs`
against a production build; `tools/{shot,game-shot,panel-shot,win-shot,arm-probe,dealer-probe,scholar-probe}.mjs`
are for looking at things by hand.

Ideas that are not decisions live in [`../brainstorming/`](../brainstorming/). Lessons learned live in
[`../memory/`](../memory/).

## Lineage

| Folder (under `~/GitHub/`) | What it was | What we take from it |
| --- | --- | --- |
| `old_idle-solitaire-infinite/` (in this repo, gitignored) | v1: vanilla JS + three.js, plugin system, prestige.json, workshop notes | The 52! theme, the workshop notes' modifier ideas, the S-curve prestige framing, lessons about plugin contracts that leak. |
| `idle-solataire-infinite/` | v2: Svelte 5 + PixiJS 8, 207 tests, headless sim | Cards-as-generators, one-pass derive, offline-reuses-step, real-gesture interaction tests, the backend sketch. |
| `idle-solataire-infinite-4.6/` | vanilla TS + DOM cards | Confirmation that DOM cards are *adequate* at 52 cards — and that "adequate" is not the bar for feel. |
| `idle-solataire-infinite-4.8/` | Svelte 5 + DOM cards, M0–M4 done | The tidiest ADR set; the Lehmer-code odometer; anti-divergence prestige invariants. |
