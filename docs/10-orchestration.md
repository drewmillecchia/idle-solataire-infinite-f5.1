# How the dev team works

One orchestrator (Claude Fable 5.1 in Claude Desktop, WSL) plus subagents where a slice is well
specified and cost-effective. The user has handed off development; the orchestrator owns design,
architecture, review, validation, and commits.

## Who does what
| Work | Who | Why |
| --- | --- | --- |
| Design, ADRs, contracts (types/interfaces), the host seam, balance decisions | Orchestrator (Fable) | Judgement-heavy, cross-cutting |
| The table renderer + feel (Pixi) first pass | Orchestrator | Feel is the pillar; needs taste |
| Rules modules (Klondike, TriPeaks…) against the contract, with tests | Subagent (Opus or Sonnet) | Well-specified, testable in isolation |
| Engine slices with a written spec (numbers formatter, save/migrate, sim harness) | Subagent (Sonnet) | Mechanical once specified |
| Boilerplate, JSON content entry, doc formatting, test scaffolds | Subagent (Haiku) | Cheap |
| Review of every subagent PR-sized change | Orchestrator | Non-negotiable gate |
| Server (Hono + SQLite) | Subagent (Sonnet) from `07-backend.md` | Fully specified |

## Gates
1. `npm run check` (svelte-check + tsc) clean. 2. `npm test` green. 3. For table/host/rules changes:
`npm run test:browser` green — ten probes against a **production build**: gestures, cut-flow, marks-flow,
reshuffle-flow, cloud, ipad (real touch events), riffle, win-all (every game), dealer, scholar.
4. Balance changes: `npm run sim` within the pacing contract. 5. Orchestrator reads the diff.

Capture the gate's exit code directly (`npm run test:browser > log; echo $?`) — piping into `grep` and
reading `PIPESTATUS` after an intervening `echo` reports the echo's status, and a truncated run then
reads as a pass. A probe must never `import()` `/src/**.ts`: that path exists only on the dev server.

## Subagent brief template
Goal · files it may touch · the contract it implements (paste the interface) · tests it must add ·
what it must **not** do (touch other dirs, add deps, change contracts) · how to run checks · report
format (what changed, what's untested, open questions).

## Commits
Conventional-ish messages, one logical change each, milestone tags (`m0`, `m1`…). Push to `main`
after milestones or a solid working state. Never commit `old_idle-solitaire-infinite/`.

## Memory
- `memory/` in the repo: lessons learned, decisions that changed, tuning notes — human-readable.
- Claude project memory (outside the repo): environment quirks, user preferences, session pointers.
- `.claude/skills/`: repeatable workflows (screenshot the app, run the sim, brief a subagent).
