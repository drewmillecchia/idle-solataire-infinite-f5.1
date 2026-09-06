/**
 * Procedural card faces in the Night Desk style: SVG → canvas → Pixi texture at device resolution.
 * Cream paper, ink pips, minimal courts. Everything is vector so it stays crisp at any card size.
 */
import { Texture } from 'pixi.js';
import { cardDef, type CardId, type CardRank, type CardSuit, type Rank } from '$engine/types';

export const PALETTE = {
  paper: '#f4ead8',
  paperShade: '#e6d9c2',
  ink: '#2a2320',
  rouge: '#a8362f',
  brass: '#c9a45c',
  felt: '#1f3a34',
  feltDeep: '#162925',
  lamp: '#ffd9a0'
};

/**
 * The suit registry: one entry per suit slot, holding the glyph drawn in a 100x100 box and the ink
 * it is drawn in. Ascension adds suits HERE and nowhere else (docs/12-ascension.md) — a new suit is
 * a path and a colour, not a change to any of the drawing code below.
 */
interface SuitFace {
  /** Markup for the glyph, centred in a 100x100 box, filled with `fill`. */
  glyph: (fill: string) => string;
  /** The card's ink when nothing else overrides it. */
  ink: string;
}

const path = (d: string) => (fill: string) => `<path d="${d}" fill="${fill}"/>`;

const SUIT_FACE: Record<CardSuit, SuitFace> = {
  // All glyphs drawn in a 100x100 box, centred.
  H: { ink: PALETTE.rouge, glyph: path('M50 88 C20 62 8 48 8 32 C8 18 19 10 30 10 C39 10 46 15 50 22 C54 15 61 10 70 10 C81 10 92 18 92 32 C92 48 80 62 50 88 Z') },
  D: { ink: PALETTE.rouge, glyph: path('M50 6 L86 50 L50 94 L14 50 Z') },
  S: { ink: PALETTE.ink, glyph: path('M50 8 C30 34 10 46 10 62 C10 74 20 82 30 82 C37 82 43 78 46 73 C45 82 41 88 34 93 L66 93 C59 88 55 82 54 73 C57 78 63 82 70 82 C80 82 90 74 90 62 C90 46 70 34 50 8 Z') },
  C: { ink: PALETTE.ink, glyph: path('M50 6 C39 6 31 14 31 24 C31 29 33 33 36 36 C33 34 29 33 25 33 C14 33 6 41 6 52 C6 63 14 71 25 71 C33 71 40 66 44 60 C43 70 39 84 32 93 L68 93 C61 84 57 70 56 60 C60 66 67 71 75 71 C86 71 94 63 94 52 C94 41 86 33 75 33 C71 33 67 34 64 36 C67 33 69 29 69 24 C69 14 61 6 50 6 Z') },
  // The Joker belongs to no suit, so its glyph is not a pip but a jester's cap — and it is the one
  // card drawn in brass, the colour this game reserves for things that were earned.
  J: {
    ink: PALETTE.brass,
    // Two floppy horns with bells, deliberately NOT the three points of the King's crown: at pip
    // size the only thing that separates them is the silhouette, so the cap droops and the crown
    // stands up.
    glyph: (fill) =>
      `<path d="M50 30 C38 12 16 10 12 26 C8 42 22 50 32 52 C24 62 22 74 24 86 L76 86 C78 74 76 62 68 52 C78 48 92 40 88 24 C84 10 62 12 50 30 Z" fill="${fill}"/>` +
      `<circle cx="10" cy="24" r="7" fill="${fill}"/><circle cx="90" cy="22" r="7" fill="${fill}"/>`
  }
};

const RANK_LABEL: Record<CardRank, string> = {
  // 0 is the rank of a card that has none. '?' rather than 'J', which is already the Jack: the
  // Joker's index should read "this card is whatever it needs to be" at a glance.
  0: '?',
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K'
};

/** Pip positions (in a 0..1 box of the face's pip area) per rank for 2..10. */
const PIP_LAYOUT: Record<number, [number, number, boolean?][]> = {
  2: [[0.5, 0.15], [0.5, 0.85, true]],
  3: [[0.5, 0.15], [0.5, 0.5], [0.5, 0.85, true]],
  4: [[0.25, 0.15], [0.75, 0.15], [0.25, 0.85, true], [0.75, 0.85, true]],
  5: [[0.25, 0.15], [0.75, 0.15], [0.5, 0.5], [0.25, 0.85, true], [0.75, 0.85, true]],
  6: [[0.25, 0.15], [0.75, 0.15], [0.25, 0.5], [0.75, 0.5], [0.25, 0.85, true], [0.75, 0.85, true]],
  7: [[0.25, 0.15], [0.75, 0.15], [0.5, 0.325], [0.25, 0.5], [0.75, 0.5], [0.25, 0.85, true], [0.75, 0.85, true]],
  8: [[0.25, 0.15], [0.75, 0.15], [0.5, 0.325], [0.25, 0.5], [0.75, 0.5], [0.5, 0.675, true], [0.25, 0.85, true], [0.75, 0.85, true]],
  9: [[0.25, 0.15], [0.75, 0.15], [0.25, 0.383], [0.75, 0.383], [0.5, 0.5], [0.25, 0.617, true], [0.75, 0.617, true], [0.25, 0.85, true], [0.75, 0.85, true]],
  10: [[0.25, 0.15], [0.75, 0.15], [0.5, 0.267], [0.25, 0.383], [0.75, 0.383], [0.25, 0.617, true], [0.75, 0.617, true], [0.5, 0.733, true], [0.25, 0.85, true], [0.75, 0.85, true]]
};

const W = 250; // design units; aspect 0.7
const H = Math.round(W / 0.7); // 357
const R = W * 0.06;

function inkOf(suit: CardSuit): string {
  return SUIT_FACE[suit].ink;
}

function pip(suit: CardSuit, cx: number, cy: number, size: number, flipped = false, color?: string): string {
  const fill = color ?? inkOf(suit);
  const s = size / 100;
  const rot = flipped ? ' rotate(180)' : '';
  return `<g transform="translate(${cx} ${cy})${rot} scale(${s}) translate(-50 -50)">${SUIT_FACE[suit].glyph(fill)}</g>`;
}

function courtFigure(rank: Rank, color: string): string {
  // Minimal ink-line figures: a crown, a circlet, a cap — the court as a glyph, not a portrait.
  const cx = W / 2, cy = H / 2;
  const s = W * 0.34;
  if (rank === 13) {
    return `<g stroke="${color}" stroke-width="5" fill="none" stroke-linejoin="round" stroke-linecap="round">
      <path d="M${cx - s} ${cy + s * 0.35} L${cx - s} ${cy - s * 0.25} L${cx - s * 0.5} ${cy + s * 0.05} L${cx} ${cy - s * 0.55} L${cx + s * 0.5} ${cy + s * 0.05} L${cx + s} ${cy - s * 0.25} L${cx + s} ${cy + s * 0.35} Z"/>
      <circle cx="${cx}" cy="${cy - s * 0.75}" r="${s * 0.09}" fill="${color}"/>
      <circle cx="${cx - s}" cy="${cy - s * 0.42}" r="${s * 0.07}" fill="${color}"/>
      <circle cx="${cx + s}" cy="${cy - s * 0.42}" r="${s * 0.07}" fill="${color}"/>
    </g>`;
  }
  if (rank === 12) {
    return `<g stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round">
      <path d="M${cx - s * 0.9} ${cy + s * 0.2} Q${cx} ${cy - s * 0.9} ${cx + s * 0.9} ${cy + s * 0.2}"/>
      <path d="M${cx - s * 0.9} ${cy + s * 0.2} L${cx + s * 0.9} ${cy + s * 0.2}"/>
      <circle cx="${cx}" cy="${cy - s * 0.35}" r="${s * 0.12}" fill="${color}"/>
      <path d="M${cx - s * 0.55} ${cy - s * 0.05} l0 ${s * 0.25} M${cx + s * 0.55} ${cy - s * 0.05} l0 ${s * 0.25}"/>
    </g>`;
  }
  return `<g stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${cx - s * 0.8} ${cy + s * 0.25} L${cx - s * 0.6} ${cy - s * 0.35} L${cx + s * 0.6} ${cy - s * 0.35} L${cx + s * 0.8} ${cy + s * 0.25} Z"/>
    <path d="M${cx - s * 0.6} ${cy - s * 0.35} Q${cx} ${cy - s * 0.95} ${cx + s * 0.6} ${cy - s * 0.35}"/>
    <path d="M${cx + s * 0.6} ${cy - s * 0.6} l${s * 0.3} -${s * 0.25} l${s * 0.05} ${s * 0.3}"/>
  </g>`;
}

export function cardFaceSvg(id: CardId): string {
  const { suit, rank } = cardDef(id);
  const color = inkOf(suit);
  const label = RANK_LABEL[rank];
  const idxSize = W * 0.17;
  const parts: string[] = [];
  parts.push(`<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="${R}" fill="${PALETTE.paper}" stroke="${PALETTE.paperShade}" stroke-width="3"/>`);
  // Paper grain: a few faint lines.
  parts.push(`<g opacity="0.05" stroke="${PALETTE.ink}" stroke-width="1">${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${20 + i * 38 + (i % 2) * 7} Q${W / 2} ${24 + i * 38} ${W} ${18 + i * 38}"/>`).join('')}</g>`);
  // Indices (top-left, and bottom-right rotated).
  const idx = (x: number, y: number, rot: boolean) =>
    `<g transform="translate(${x} ${y})${rot ? ' rotate(180)' : ''}"><text x="0" y="0" font-family="Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif" font-size="${idxSize}" font-weight="600" fill="${color}" text-anchor="middle" dominant-baseline="central">${label}</text>${pip(suit, 0, idxSize * 0.85, idxSize * 0.62)}</g>`;
  parts.push(idx(W * 0.13, H * 0.085, false));
  parts.push(idx(W * 0.87, H * 0.915, true));
  // Body.
  if (rank === 0) {
    // No rank, no pips: the cap alone, inside the court's frame, so it reads as a face card that
    // refuses to say which one.
    parts.push(`<rect x="${W * 0.2}" y="${H * 0.2}" width="${W * 0.6}" height="${H * 0.6}" rx="${R * 0.6}" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.55"/>`);
    parts.push(pip(suit, W / 2, H / 2, W * 0.5));
  } else if (rank === 1) {
    parts.push(pip(suit, W / 2, H / 2, W * 0.5));
  } else if (rank >= 11) {
    parts.push(`<rect x="${W * 0.2}" y="${H * 0.2}" width="${W * 0.6}" height="${H * 0.6}" rx="${R * 0.6}" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.55"/>`);
    parts.push(courtFigure(rank as Rank, color));
    parts.push(pip(suit, W * 0.5, H * 0.7, W * 0.12));
  } else {
    const layout = PIP_LAYOUT[rank] ?? [];
    const ax = W * 0.25, aw = W * 0.5, ay = H * 0.16, ah = H * 0.68;
    const size = rank <= 3 ? W * 0.24 : rank <= 6 ? W * 0.2 : W * 0.17;
    for (const [px, py, flip] of layout) parts.push(pip(suit, ax + px * aw, ay + py * ah, size, !!flip));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

export function cardBackSvg(): string {
  const lines: string[] = [];
  const step = 16;
  for (let i = -H; i < W + H; i += step) lines.push(`<path d="M${i} 0 L${i + H} ${H}"/>`);
  for (let i = -H; i < W + H; i += step) lines.push(`<path d="M${i + H} 0 L${i} ${H}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs><clipPath id="c"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="${R}"/></clipPath></defs>
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="${R}" fill="${PALETTE.paper}" stroke="${PALETTE.paperShade}" stroke-width="3"/>
    <rect x="${W * 0.08}" y="${W * 0.08}" width="${W * 0.84}" height="${H - W * 0.16}" rx="${R * 0.6}" fill="${PALETTE.felt}"/>
    <g clip-path="url(#c)" stroke="${PALETTE.brass}" stroke-width="1.1" opacity="0.55">
      <g transform="translate(0 0)">${lines.join('')}</g>
    </g>
    <rect x="${W * 0.08}" y="${W * 0.08}" width="${W * 0.84}" height="${H - W * 0.16}" rx="${R * 0.6}" fill="none" stroke="${PALETTE.brass}" stroke-width="2.5"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="${W * 0.11}" fill="${PALETTE.felt}" stroke="${PALETTE.brass}" stroke-width="2.5"/>
    <text x="${W / 2}" y="${H / 2}" font-family="Iowan Old Style, Palatino, Georgia, serif" font-size="${W * 0.14}" fill="${PALETTE.brass}" text-anchor="middle" dominant-baseline="central">∞</text>
  </svg>`;
}

export function slotSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="${R}" fill="rgba(0,0,0,0.12)" stroke="rgba(244,234,216,0.22)" stroke-width="3" stroke-dasharray="10 8"/>
  </svg>`;
}

async function svgToTexture(svg: string, pxWidth: number): Promise<Texture> {
  const pxHeight = Math.round(pxWidth / 0.7);
  const img = new Image();
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('svg decode failed'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0, pxWidth, pxHeight);
  return Texture.from(canvas);
}

export interface CardTextures {
  faces: Map<CardId, Texture>;
  back: Texture;
  slot: Texture;
  pxWidth: number;
}

/** Build every texture at `pxWidth` device pixels (card width × DPR). */
export async function buildCardTextures(ids: readonly CardId[], pxWidth: number): Promise<CardTextures> {
  const faces = new Map<CardId, Texture>();
  const jobs = ids.map(async (id) => faces.set(id, await svgToTexture(cardFaceSvg(id), pxWidth)));
  const [back, slot] = await Promise.all([svgToTexture(cardBackSvg(), pxWidth), svgToTexture(slotSvg(), pxWidth), ...jobs]);
  return { faces, back, slot, pxWidth };
}

export function destroyCardTextures(t: CardTextures): void {
  for (const tex of t.faces.values()) tex.destroy(true);
  t.back.destroy(true);
  t.slot.destroy(true);
}
