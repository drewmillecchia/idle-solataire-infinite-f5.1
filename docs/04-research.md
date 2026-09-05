# Research synthesis (September 2026)

What we learned and how it changed the build. Not a link dump; sources at the end of each section.

## 1. Incremental design, current consensus

- **Three pillars**: a satisfying growth loop, *meaningful* upgrade decisions (scarcity makes choice
  real), and well-paced *revealed layers* — a new system opens just as the last is mastered.
  → Reveal ladder; Marks/Ways/Systems arrive singly on behavioural triggers.
- **The opening minutes lose more players than anything else.** Competence fast, one variable at a
  time. → First awake card < 90 s; ≤ 3 reveals in minute one; no welcome modal.
- **~60/40 idle/active.** Idle should reward checking in; active must matter. → Awake cards earn
  always; playing hands charges cards, wins pay bursts, and Way of the Hand tilts the ratio for
  people who want it.
- **Prestige timing heuristic**: reset when progress slows to 10–20 % of peak. → The Cut button shows
  projected Cuts and a "velocity" hint; Way of the Dealer's Constellation branch has auto-cut.
- **Always a next goal, close enough to reach.** → Milestone ledger with real magnitudes; the
  "wake the whole deck" ladder; constellation nodes priced in view.
- A 2026 trend is games that adapt to observed play. We do a gentle version: which panels a player
  opens and whether they use the Auto-Dealer nudges *which* reveal comes next, never *whether*.

Sources: [Bugnet — How to design an idle game](https://bugnet.io/blog/how-to-design-an-idle-or-incremental-game),
[DesignTheGame — idle genre deep dive](https://www.designthegame.com/learning/courses/course/designing-mobile-idle-genre/a-deep-dive-idle-genre-game-design),
[GridInc — idle best practices](https://gridinc.co.za/blog/idle-games-best-practices),
[Missions Zanx — idle systems & progression](https://missionszanx.com/guides/idle-game-design-systems-mechanics-and-progression),
[Noob Incremental — when to reset](https://robolibrary.org/wikis/noob-incremental/prestige-and-layers).

## 2. Synergy without a shop

Antimatter Dimensions' producer tiers and NGU's layered systems show that *interaction* between
cheap and expensive producers is what keeps early purchases relevant. Balatro's lesson (jokers) is
that legible one-sentence rules with visible glyphs create emergent joy — but its *acquisition* is a
random shop, which we reject. → Marks: one-sentence rules, placed deterministically, limited slots,
firing over a shared event bus so chains emerge (Twin is the wire; Kindling and Echo are engines).

Sources: [TV Tropes — Idle Game](https://tvtropes.org/pmwiki/pmwiki.php/Main/IdleGame),
[Missions Zanx — best browser incrementals](https://missionszanx.com/guides/best-incremental-idle-games-you-can-play-in-your-browser).

## 3. Rendering: PixiJS 8 in 2026

PixiJS 8.20 (Sep 2026): WebGPU renderer with WebGL fallback, Safari WGSL fallback fixes, an
experimental canvas fallback (8.16+), federated pointer events, huge batching gains over v7. Filters
are per-object render passes — use on a *few* highlighted cards, not the whole table. Text is
rasterised; we pre-render card faces from SVG to a texture atlas at device DPR so they stay crisp and
themeable. Cross-device benchmarks put DOM animation stable to ~100 objects; that is enough for 52
static cards but not for 52 cards in a riffle plus particles plus shadows — the reason for ADR-003.

Sources: [PixiJS 8.16 release](https://pixijs.com/blog/8.16.0), [PixiJS releases](https://github.com/pixijs/pixijs/releases),
[PixiJS in production 2026](https://appscale.blog/en/blog/pixijs-high-performance-2d-web-graphics-2026).

## 4. Feel: springs, momentum, latency

- Springs, not durations: springs stay velocity-aware mid-gesture; parametrise by *response*
  (seconds to settle) and *damping ratio* (1 = no bounce). Add bounce (~0.8) only when the gesture
  carried momentum — overshoot on a flicked card feels right; on a fade-in it feels wrong.
- Feedback continuous during the gesture: the card follows the finger 1:1 (or with a tiny lag that
  reads as weight), never on a timer.
- Audit every latency on the input path: no 300 ms tap delay (`touch-action: none` on the canvas),
  no debounce on pointerdown, haptics fired on the *down* not the *up*.
- Momentum on release → friction → overdamped spring at the boundary. This is the throw model.

→ [05-feel.md](05-feel.md) and ADR-011. Sources: [Emil Kowalski — apple-design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md),
[Nathan Gitter — Building fluid interfaces](https://medium.com/@nathangitter/building-fluid-interfaces-ios-swift-9732bb934bf5),
[iamralpht — physics for interactions](https://iamralpht.github.io/physics/), [GSAP Draggable](https://gsap.com/docs/v3/Plugins/Draggable/).

## 5. iOS PWA storage (Safari 17+)

Home-screen web apps get the browser's quotas (origin up to 60 % of disk). Eviction is LRU under
pressure *and* for origins "not interacted with for some time" (ITP-related; the folk number is 7
days). `navigator.storage.persist()` is granted heuristically — being installed to the Home Screen
helps. → ADR-009: request persistence, store twice, export string, cloud tier.

Sources: [WebKit — storage policy updates](https://webkit.org/blog/14403/updates-to-storage-policy/),
[MagicBell — PWA iOS limitations 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide),
[MobiLoud — PWAs on iOS 2026](https://www.mobiloud.com/blog/progressive-web-apps-ios/).

## 6. Solitaire winnability (for variant choice and "Scholar" deals)

| Variant | Winnable (perfect info) | Typical human win |
| --- | --- | --- |
| Klondike (draw 1/3) | ~82 % (Solvitaire, thoughtful) | 11–33 % |
| FreeCell | ~99 % | high |
| Spider 1/2/4 suits | 52 / 17 / 6 % (reported) | lower |
| TriPeaks | ~90 % | 20–30 % |
| Golf | ~16 % | low |
| Pyramid | < 5 % raw | very low |

Solvitaire (Blake & Gent, 2019) is the reference solver architecture; a Klondike DFS with
transposition table over the *thoughtful* variant is feasible in a worker for "always winnable" deals
(Way of the Scholar), and a greedy-with-lookahead player suffices for the Auto-Dealer.

Sources: [The Winnability of Klondike (arXiv 1906.12314)](https://arxiv.org/html/1906.12314v6),
[solitaire.com — odds by variant](https://solitaire.com/blog/the-odds-of-winning-solitaire-backed-with-data/),
[Solitaire Association — TriPeaks](https://www.solitaireassociation.com/games/tri-peaks).

## 7. Sound

Card sounds are "micro-transient textures" — a riffle is a controlled waterfall of paper clicks.
Web Audio synthesis (noise burst → band-pass → short envelope, randomised per card) gives velocity-
and pitch-varied slides, places, flips and riffles with no assets and no licensing, which suits a
first pass; samples can layer in later. iOS needs a user gesture before `AudioContext` resumes.

Sources: [Sonoport — synthesising sounds with Web Audio](https://sonoport.github.io/synthesising-sounds-webaudio.html),
[MDN — Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API),
[Morphic — riffle shuffle sound anatomy](https://morphic.com/resources/sounds/card-shuffle-sound-effects).

## 8. Backend

Hono is the 2026 default for Lambda-portable Node APIs (AWS re:Invent 2025 session; official
`hono/aws-lambda` adapter). DynamoDB conditional writes give optimistic concurrency natively.
→ ADR-012.

Sources: [Hono — AWS Lambda](https://hono.dev/docs/getting-started/aws-lambda),
[AWS re:Post — Hono on Lambda](https://repost.aws/articles/ARD142VhkOQd2U_iCZPbsTNA/re-invent-2025-supercharge-lambda-with-hono-the-lightweight-web-framework),
[OneUpTime — DynamoDB with Lambda](https://oneuptime.com/blog/post/2026-02-02-dynamodb-lambda/view).

## 9. Hard-won lessons from the prior codebases (not from the web)

- Prestige gain measured absolutely **diverges** (1e3838 in four sim-hours). Threshold scales with
  the full current multiplier; multiplier reads *lifetime* cuts, never the balance.
- **One derivation pass** — a build displayed one rate and applied another.
- **Offline must reuse `step`**, with a test asserting agreement.
- **Structured-clone throws on reactive proxies** — modules clone their own boards; never a bare `catch`.
- **Drop targets span a pile's whole occupied height**, or drops miss on fanned columns.
- **Fixed design canvases** (transform-scale letterbox) were pixel-perfect on one iPad and wrong
  everywhere else; fit the board to the felt from a grid measured in card units.
- **Auto-play "is stuck?" ≠ "is this deal going anywhere?"** — a greedy player with unlimited redeals
  cycles the waste forever; cycle-detect on board hash.
- A plugin base class with lifecycle hooks *still* leaked `if (gameId === ...)` into shared render
  code (v1). The contract must be the only surface.
- Unit tests could not see the engine/host seam, where every interaction bug lived → real-gesture
  browser tests are not optional.
- The **first** rebuild's win: "give winning a deal the moment it deserves" — non-modal, cascade
  behind, never blocking.
- Waiting for the Auto-Dealer must not cost throughput or politeness becomes a tax on playing.
