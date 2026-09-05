# Art direction — "Night Desk"

A quiet desk at night. Cream cards with ink pips on deep felt, a brass lamp's warm pool of light,
and behind it a window whose sky fills with stars as the odometer climbs toward 52!. Cozy, tactile,
slightly bookish. The cosmic scale creeps into a small warm room; it never shouts.

## Why this and not the Cosmic Observatory of prior rebuilds
The prior palette (navy / brass / cyan / violet) was handsome but *cold* and read as sci-fi. The
brief now stresses ASMR, relaxation, and endearment. Warm paper and lamplight fit a game you play
in bed. The cosmos is still here — it's in the window, growing.

## Palette (tokens in `src/ui/styles/tokens.css`)
| Token | Hex | Use |
| --- | --- | --- |
| `--felt` | `#1f3a34` | Table ground (deep green-teal; not casino green) |
| `--felt-deep` | `#16292500` → `#162925` | Vignette edge |
| `--paper` | `#f4ead8` | Card faces, panels |
| `--paper-shade` | `#e6d9c2` | Card edges, dividers |
| `--ink` | `#2a2320` | Black-suit pips, body text on paper |
| `--rouge` | `#a8362f` | Red-suit pips, warnings |
| `--brass` | `#c9a45c` | Earned things: currency, purchases, the deck, Cuts |
| `--lamp` | `#ffd9a0` | Warm light, glows, valid targets |
| `--night` | `#0f1a22` | Window sky, modals' scrim |
| `--star` | `#dfe9ff` | Stars, Permutations |
| `--moss` | `#7fa38a` | Live things: rates, the Auto-Dealer |
| `--violet` | `#7d6b9e` | Prestige accents (kept from lineage, muted) |

Dark-first; a lighter "Morning Desk" theme is a later cosmetic unlock (paper cards on oak).

## Cards
- Aspect 0.7 (63×88 mm). Corner radius 6 % of width. Cream face with a subtle paper grain (texture
  baked into the atlas, low contrast so it reads at any size).
- Indices top-left only (and bottom-right mirrored) in a humanist serif with **tabular figures**;
  pips are our own simplified vector shapes; courts are minimal ink-line figures (no gaudy royals).
- Back: felt-coloured with a fine brass line pattern; Ascension decks recolour the back.
- **Awake** cards carry a faint warm inner glow on the back and a small brass star in the index
  corner; **charge** shows as a tiny row of brass ticks along the bottom edge (up to 5, then a digit).
- **Marks** render as a single ink glyph in the top-right corner.
- States: face-up/down, awake/asleep, selected (lift + shadow), valid-target (lamp glow), dragging
  (tilt), blocked (desaturate 20 %).

## Type
UI: system stack for now (`ui-serif`/`Iowan Old Style`/`Georgia` for numerals and headers, `ui-sans-serif`
for labels), all numbers `font-variant-numeric: tabular-nums`. Self-hosted webfonts are a later
decision (PWA offline means bundling them).

## Motion
Springs (see 05-feel). Ambient: the lamp's light breathes very slowly (period ~9 s, ±3 % alpha);
dust motes drift in the lamp cone (a dozen particles). Celebrations: the card cascade on a win;
a lamp flicker + a new star on a Cut; a slow constellation line-draw on Reshuffle.

## The window
A panel in the top strip. Star count = f(log10 lifetimeShuffles); constellations are drawn between
stars at milestones; at 52! the moon rises. This is the progress bar. There is also a plain
numeric journey bar for people who want the number.

## Layout (iPad landscape 1180×820 first; desktop equal)
```
┌──────────────────────────────────────────────────────────────────┐
│ HUD: shuffles · rate · [window/sky] · cuts · menu                 │  ~64px
├────────────────────────────────────────────────┬─────────────────┤
│                                                │  rail (panels)  │
│                 felt / table (Pixi)            │  upgrades       │
│                                                │  deck & marks   │
│                                                │  constellation  │
│                                                │  ledger         │
├────────────────────────────────────────────────┴─────────────────┤
│ footer: odometer strip (52! position) · new hand · undo · dealer │  ~48px
└──────────────────────────────────────────────────────────────────┘
```
Under 1000 px the rail leaves the grid entirely and slides over the felt as a drawer, opened by a handle
on the right edge and dismissed by a scrim — a squeezed 56 px column was unreadable and made the page
scroll sideways. Safe-area insets are respected in standalone mode.
