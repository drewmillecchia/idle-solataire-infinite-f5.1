/**
 * The PixiJS card table. Game-agnostic: consumes a BoardView and a TableHost. Owns feel.
 * Nothing here knows what Klondike is.
 */
import { Application, Container, Graphics, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { BoardView } from '$rules/module';
import type { CardId } from '$engine/types';
import type { Feel } from '$content/index';
import { CardSprite } from './CardSprite';
import { buildCardTextures, destroyCardTextures, type CardTextures } from './cardFaces';
import { layoutBoard, rectContains, rectCenter, rectDistance, type Layout } from './layout';
import { clamp } from './spring';

/** Event time in ms. Uses the native event's timestamp (accurate even when a frame ran long) with a fallback. */
function stamp(e: FederatedPointerEvent): number {
  const t = (e.nativeEvent as Event | undefined)?.timeStamp;
  return typeof t === 'number' && t > 0 ? t : performance.now();
}

export interface TableHost {
  canPickUp(pile: string, index: number): boolean;
  legalTargets(pile: string, index: number): string[];
  /** Attempt the move; return true if the board changed. The host will push a new view. */
  tryMove(pile: string, index: number, to: string): boolean;
  /** Tap on a card: auto-move (or draw when the pile is the stock). */
  tap(pile: string, index: number): void;
  /** Tap on an empty pile slot (e.g. empty stock → recycle). */
  tapSlot(pile: string): void;
  /** Any pointer activity (resets the Auto-Dealer's patience). */
  activity(): void;
  /** Feedback hooks for presenters. velocity 0..1. */
  sound(name: string, velocity: number): void;
  haptic(name: string): void;
  generator(id: CardId): { awake: boolean; charge: number; glyph?: string | undefined };
}

interface Drag {
  pile: string;
  index: number;
  sprites: CardSprite[];
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  targets: string[];
  downAt: number;
  samples: { t: number; x: number; y: number }[];
  pointerId: number;
}

interface Throw {
  sprites: CardSprite[];
  vx: number;
  vy: number;
  pile: string;
  index: number;
  targets: string[];
  age: number;
}

export class Table {
  readonly app = new Application();
  private root = new Container();
  private slotLayer = new Container();
  private cardLayer = new Container();
  private dragLayer = new Container();
  private felt = new Sprite();
  private feltTex: Texture | null = null;
  private sprites = new Map<CardId, CardSprite>();
  private anon: CardSprite[] = []; // sprites for face-down cards without ids (legacy modules)
  private slots = new Map<string, Sprite>();
  private textures: CardTextures | null = null;
  private layout: Layout | null = null;
  private view: BoardView | null = null;
  private drag: Drag | null = null;
  private throwing: Throw | null = null;
  private width = 0;
  private height = 0;
  private dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  private ready = false;
  private lastTapAt = 0;
  private lastTapKey = '';
  private lampPhase = 0;
  private pendingView: BoardView | null = null;
  private texturesBuildingFor = 0;
  private dealing = false;
  private celebration: { sprites: { sp: CardSprite; vx: number; vy: number; bounces: number }[]; age: number } | null = null;
  private choreo = 0; // token: bumping it cancels pending choreography timers

  feel: Feel;
  host: TableHost;
  reducedMotion = false;
  /** What the last pointer release decided — shown in the Feel Lab and read by gesture tests. */
  lastGesture: { kind: 'tap' | 'place' | 'throw' | 'return' | 'none'; speed: number; held: number; moved: boolean; target?: string } =
    { kind: 'none', speed: 0, held: 0, moved: false };

  constructor(host: TableHost, feel: Feel) {
    this.host = host;
    this.feel = feel;
  }

  async mount(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: parent,
      antialias: true,
      backgroundAlpha: 0,
      resolution: this.dpr,
      autoDensity: true,
      preference: 'webgl',
      // Headless screenshots read the back buffer between frames; keeping it costs little and makes
      // captures deterministic. Only in test/dev builds.
      preserveDrawingBuffer: import.meta.env.DEV || location.search.includes('test')
    });
    parent.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';
    this.root.addChild(this.felt, this.slotLayer, this.cardLayer, this.dragLayer);
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = { contains: () => true };
    this.app.stage.on('pointerdown', this.onDown);
    this.app.stage.on('pointermove', this.onMove);
    this.app.stage.on('pointerup', this.onUp);
    this.app.stage.on('pointerupoutside', this.onUp);
    this.app.stage.on('pointercancel', this.onUp);
    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
    this.app.renderer.on('resize', () => this.onResize());
    this.onResize();
    this.ready = true;
    if (this.pendingView) {
      const v = this.pendingView;
      this.pendingView = null;
      this.setBoard(v, { instant: true });
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
    if (this.textures) destroyCardTextures(this.textures);
  }

  /** Screen-space point (CSS px, relative to the canvas) for a pile — used by gesture tests. */
  targetPoint(pile: string, mode: 'card' | 'slot' = 'card'): { x: number; y: number } | null {
    const pl = this.layout?.piles.get(pile);
    if (!pl) return null;
    if (mode === 'slot' || pl.pile.cards.length === 0) return { x: pl.x + this.layout!.cardW / 2, y: pl.y + this.layout!.cardH / 2 };
    const p = pl.cardPos(pl.pile.cards.length - 1);
    return { x: p.x + this.layout!.cardW / 2, y: p.y + this.layout!.cardH / 2 };
  }
  /** Screen point of a specific card index in a pile. */
  cardPoint(pile: string, index: number): { x: number; y: number } | null {
    const pl = this.layout?.piles.get(pile);
    if (!pl || !this.layout) return null;
    const p = pl.cardPos(index);
    return { x: p.x + this.layout.cardW / 2, y: p.y + this.layout.cardH * 0.25 };
  }

  private onResize(): void {
    // screen is in logical (CSS) pixels; autoDensity handles the DPR.
    this.width = this.app.screen.width;
    this.height = this.app.screen.height;
    this.drawFelt();
    if (this.view) this.setBoard(this.view, { instant: true, relayout: true });
  }

  /**
   * The felt, vignette and lamp pool are baked into ONE texture per resize (a 2D-canvas gradient), so
   * the background costs a single quad per frame instead of many large alpha fills. Matters on
   * software GL (headless tests) and on older iPads alike.
   */
  private drawFelt(): void {
    const w = Math.max(1, Math.round(this.width)), h = Math.max(1, Math.round(this.height));
    const scale = 0.5; // background is soft; half-res is invisible and 4× cheaper
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(scale, scale);
    g.fillStyle = '#1f3a34';
    g.fillRect(0, 0, w, h);
    // Lamp pool: warm radial glow, upper-left leaning.
    const lamp = g.createRadialGradient(w * 0.42, h * 0.36, 10, w * 0.42, h * 0.36, Math.max(w, h) * 0.7);
    lamp.addColorStop(0, 'rgba(255,217,160,0.10)');
    lamp.addColorStop(0.5, 'rgba(255,217,160,0.04)');
    lamp.addColorStop(1, 'rgba(255,217,160,0)');
    g.fillStyle = lamp;
    g.fillRect(0, 0, w, h);
    // Vignette.
    const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
    vig.addColorStop(0, 'rgba(22,41,37,0)');
    vig.addColorStop(1, 'rgba(22,41,37,0.75)');
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);
    const old = this.feltTex;
    this.feltTex = Texture.from(c);
    this.felt.texture = this.feltTex;
    this.felt.width = w;
    this.felt.height = h;
    if (old) old.destroy(true);
  }

  /** Push a new board. Sprites reconcile by card id and spring to their new places. */
  setBoard(view: BoardView, opts: { instant?: boolean; relayout?: boolean; deal?: boolean; shuffle?: 'riffle' | 'overhand' | 'none' } = {}): void {
    this.view = view;
    if (!this.ready) {
      this.pendingView = view;
      return;
    }
    if (opts.instant || opts.deal) this.cancelChoreography();
    if (opts.deal && opts.shuffle && opts.shuffle !== 'none') {
      // Choreograph: gather → shuffle → then the normal deal. The deal is scheduled after the shuffle.
      this.shuffleChoreography(view, opts.shuffle);
      return;
    }
    const layout = layoutBoard(view, this.width, this.height);
    this.layout = layout;
    this.ensureTextures(layout.cardW);
    if (!this.textures) return; // will re-run when textures land

    // Slots.
    for (const [id, s] of this.slots) if (!layout.piles.has(id)) { s.destroy(); this.slots.delete(id); }
    for (const [id, pl] of layout.piles) {
      const wantsSlot = pl.pile.slot ?? pl.pile.kind !== 'peak';
      if (!wantsSlot) { const old = this.slots.get(id); if (old) { old.destroy(); this.slots.delete(id); } continue; }
      let s = this.slots.get(id);
      if (!s) {
        s = new Sprite(this.textures.slot);
        s.eventMode = 'static';
        (s as unknown as { pileId: string }).pileId = id;
        this.slotLayer.addChild(s);
        this.slots.set(id, s);
      }
      s.width = layout.cardW;
      s.height = layout.cardH;
      s.position.set(pl.x, pl.y);
      s.alpha = pl.pile.blocked ? 0.35 : 1;
    }

    // Cards: reconcile.
    const seen = new Set<CardId>();
    let anonIdx = 0;
    const dragging = new Set(this.drag?.sprites.map((s) => s.id) ?? []);
    let z = 0;
    let dealDelay = 0;
    const dealBase = this.dealBaseDelay;
    this.dealBaseDelay = 0;
    for (const pl of layout.piles.values()) {
      const pile = pl.pile;
      pile.cards.forEach((c, i) => {
        let sp: CardSprite;
        if (c.id === null) {
          sp = this.anon[anonIdx] ?? this.makeSprite(-1 - anonIdx);
          this.anon[anonIdx] = sp;
          anonIdx++;
        } else {
          sp = this.sprites.get(c.id) ?? this.makeSprite(c.id);
          seen.add(c.id);
          const g = this.host.generator(c.id);
          sp.setGenerator(g.awake, g.charge, g.glyph ?? '');
        }
        sp.pile = pile.id;
        sp.index = i;
        sp.pickable = pile.pickableFrom !== undefined && i >= pile.pickableFrom;
        sp.resize(layout.cardW, layout.cardH);
        const p = pl.cardPos(i);
        const tx = p.x + layout.cardW / 2, ty = p.y + layout.cardH / 2;
        const wasUp = sp.faceUp;
        if (dragging.has(sp.id)) {
          // Leave the dragged sprite where the finger has it; it will settle after the drop resolves.
        } else if (opts.instant) {
          sp.snapTo(tx, ty);
          sp.setFaceUp(c.faceUp, true);
        } else if (opts.deal) {
          // Deal choreography: from the stock slot, staggered.
          const stock = layout.piles.get('stock');
          const sx = stock ? stock.x + layout.cardW / 2 : this.width / 2;
          const sy = stock ? stock.y + layout.cardH / 2 : -layout.cardH;
          const isStock = pile.id === 'stock';
          if (isStock) {
            sp.snapTo(sx, sy);
            sp.setFaceUp(false, true);
          } else {
            sp.snapTo(sx, sy);
            sp.setFaceUp(false, true);
            sp.pos.configure(this.r(this.feel.dealResponse), this.feel.dealDamping);
            const delay = dealBase + dealDelay++ * (this.feel.dealIntervalMs / 1000);
            this.later(delay, () => {
              sp.pos.setTarget(tx, ty);
              sp.rot.velocity = (Math.random() - 0.5) * 3;
              if (c.faceUp) this.later(0.12, () => sp.setFaceUp(true));
              this.host.sound('deal', 0.4 + Math.random() * 0.2);
            });
          }
        } else {
          sp.pos.configure(this.r(this.feel.placeResponse), this.feel.placeDamping);
          sp.pos.setTarget(tx, ty);
          if (c.faceUp !== wasUp) {
            sp.setFaceUp(c.faceUp);
            if (c.faceUp) this.host.sound('flip', 0.6);
          }
        }
        if (!dragging.has(sp.id)) {
          if (sp.parent !== this.cardLayer) this.cardLayer.addChild(sp);
          sp.zIndex = z++;
        }
      });
    }
    // Remove sprites for cards no longer on the board (e.g. after Ascension changes the deck).
    for (const [id, sp] of this.sprites) if (!seen.has(id) && !dragging.has(id)) { sp.destroy(); this.sprites.delete(id); }
    for (let i = anonIdx; i < this.anon.length; i++) this.anon[i]?.destroy();
    this.anon.length = anonIdx;
    this.cardLayer.sortableChildren = true;
    this.cardLayer.sortChildren();
  }

  private timers: { at: number; fn: () => void; token: number }[] = [];
  private clock = 0;
  private later(delay: number, fn: () => void): void {
    this.timers.push({ at: this.clock + delay, fn, token: this.choreo });
  }
  /** Drop every pending choreography step (a new hand interrupts a deal or a celebration). */
  private cancelChoreography(): void {
    this.choreo++;
    this.timers = [];
    if (this.celebration) {
      for (const c of this.celebration.sprites) { c.sp.alpha = 1; c.sp.rot.set(0); }
      this.celebration = null;
    }
  }

  private dealBaseDelay = 0;

  /**
   * Shuffle set piece (docs/05-feel.md). Every sprite gathers on the stock, splits into two packets,
   * riffles back together (alternating drops, jittered), squares up, and then the deal runs.
   */
  private shuffleChoreography(view: BoardView, style: 'riffle' | 'overhand'): void {
    if (!this.layout || !this.textures) { this.setBoard(view, { deal: true, shuffle: 'none' }); return; }
    const L = this.layout;
    // Shuffle in the dealer's hands — the middle of the felt — then slide the squared deck to the stock.
    const cx = this.width / 2;
    const cy = this.height * 0.45;
    const stock = L.piles.get('stock');
    const sx = (stock ? stock.x : L.offsetX) + L.cardW / 2;
    const sy = (stock ? stock.y : L.offsetY) + L.cardH / 2;
    const all = [...this.sprites.values()];
    if (all.length === 0) { this.setBoard(view, { deal: true, shuffle: 'none' }); return; }
    const gatherT = 0.28;
    all.forEach((sp, i) => {
      this.dragLayer.removeChild(sp);
      this.cardLayer.addChild(sp);
      sp.zIndex = i;
      sp.setFaceUp(false);
      sp.lift.target = 0; sp.scaleS.target = 1;
      sp.pos.configure(this.r(gatherT), 0.9);
      sp.pos.setTarget(cx + (Math.random() - 0.5) * 3, cy + (Math.random() - 0.5) * 3);
      sp.rot.target = (Math.random() - 0.5) * 0.06;
    });
    this.cardLayer.sortChildren();
    this.host.sound('slide', 0.5);
    const total = (style === 'riffle' ? this.feel.riffleDurationMs : this.feel.overhandDurationMs) / 1000;
    const split = L.cardW * 0.62;
    // Split into two packets.
    this.later(gatherT + 0.05, () => {
      all.forEach((sp, i) => {
        const left = i % 2 === 0;
        sp.pos.configure(this.r(0.16), 0.85);
        sp.pos.setTarget(cx + (left ? -split : split), cy + (left ? 6 : -6));
        sp.rot.target = left ? -0.09 : 0.09;
      });
      this.host.sound('square', 0.4);
    });
    // Interleave back to the centre.
    const riffleStart = gatherT + 0.32;
    const order = all.slice().sort(() => Math.random() - 0.5);
    order.forEach((sp, k) => {
      const t = riffleStart + (k / order.length) * total * 0.8 + (Math.random() - 0.5) * 0.02;
      this.later(t, () => {
        sp.pos.configure(this.r(0.12), 0.8);
        sp.pos.setTarget(cx + (Math.random() - 0.5) * 2, cy + (Math.random() - 0.5) * 2);
        sp.rot.target = (Math.random() - 0.5) * 0.03;
        sp.zIndex = 100 + k;
        this.cardLayer.sortChildren();
      });
    });
    this.later(riffleStart, () => this.host.sound('riffle', 0.7));
    // Square up, slide to the stock, then deal.
    const squareAt = riffleStart + total * 0.8 + 0.25;
    this.later(squareAt, () => {
      all.forEach((sp) => { sp.rot.target = 0; sp.pos.setTarget(cx, cy); });
    });
    this.later(squareAt + 0.2, () => {
      all.forEach((sp) => { sp.pos.configure(this.r(0.3), 0.9); sp.pos.setTarget(sx, sy); });
      this.host.sound('slide', 0.6);
    });
    this.later(squareAt + 0.55, () => {
      this.dealBaseDelay = 0;
      this.setBoard(view, { deal: true, shuffle: 'none' });
    });
  }

  /**
   * Cut the Deck ceremony: every card gathers, the lamp dims, the deck is cut in two and the halves
   * change places (a real cut), then a slow riffle. Calls `onDone` when the host may deal the new run.
   */
  cutCeremony(onDone: () => void): void {
    if (!this.layout) { onDone(); return; }
    this.cancelChoreography();
    const cx = this.width / 2, cy = this.height * 0.45;
    const all = [...this.sprites.values()];
    const cardH = this.layout.cardH;
    all.forEach((sp, i) => {
      this.cardLayer.addChild(sp);
      sp.zIndex = i;
      sp.setFaceUp(false);
      sp.lift.target = 0; sp.scaleS.target = 1; sp.alpha = 1;
      sp.pos.configure(this.r(0.45), 0.9);
      sp.pos.setTarget(cx + (Math.random() - 0.5) * 2, cy + (Math.random() - 0.5) * 2);
      sp.rot.target = (Math.random() - 0.5) * 0.04;
    });
    this.cardLayer.sortChildren();
    this.host.sound('slide', 0.5);
    // Lamp dims while the deck is in hand.
    this.lampDim = 0.35;
    // The cut: top half lifts and moves aside, bottom half slides under, halves swap.
    const half = Math.floor(all.length / 2);
    this.later(0.7, () => {
      all.forEach((sp, i) => {
        const top = i >= half;
        sp.pos.configure(this.r(0.3), 0.85);
        sp.pos.setTarget(cx + (top ? cardH * 0.55 : -cardH * 0.15), cy + (top ? -cardH * 0.35 : cardH * 0.1));
        if (top) sp.lift.target = 0.8;
      });
      this.host.sound('square', 0.5);
    });
    this.later(1.25, () => {
      all.forEach((sp, i) => {
        const top = i >= half;
        sp.zIndex = top ? i - half : i + half; // the halves swap
        sp.pos.setTarget(cx, cy);
        sp.lift.target = 0;
      });
      this.cardLayer.sortChildren();
      this.host.sound('place', 0.6);
      this.host.haptic('thud');
    });
    // A slow, ceremonial riffle.
    const riffleStart = 1.9;
    const total = (this.feel.riffleDurationMs / 1000) * 1.6;
    const split = this.layout.cardW * 0.62;
    this.later(riffleStart - 0.3, () => {
      all.forEach((sp, i) => {
        const left = i % 2 === 0;
        sp.pos.configure(this.r(0.2), 0.85);
        sp.pos.setTarget(cx + (left ? -split : split), cy + (left ? 6 : -6));
        sp.rot.target = left ? -0.09 : 0.09;
      });
    });
    const order = all.slice().sort(() => Math.random() - 0.5);
    order.forEach((sp, k) => {
      this.later(riffleStart + (k / order.length) * total * 0.8, () => {
        sp.pos.configure(this.r(0.14), 0.8);
        sp.pos.setTarget(cx, cy);
        sp.rot.target = (Math.random() - 0.5) * 0.03;
        sp.zIndex = 100 + k;
        this.cardLayer.sortChildren();
      });
    });
    this.later(riffleStart, () => this.host.sound('cut', 0.8));
    this.later(riffleStart + total * 0.8 + 0.3, () => {
      all.forEach((sp) => { sp.rot.target = 0; sp.pos.setTarget(cx, cy); });
      this.lampDim = 0;
      this.host.sound('chime', 0.7);
    });
    this.later(riffleStart + total * 0.8 + 0.9, () => onDone());
  }
  private lampDim = 0;

  /** Win celebration: foundation cards leap off and tumble across the felt, bouncing on the table edge. */
  celebrate(): void {
    if (!this.layout || !this.view) return;
    const tops: CardSprite[] = [];
    for (const pl of this.view.piles) {
      if (pl.kind !== 'foundation') continue;
      for (const c of pl.cards) if (c.id !== null) { const sp = this.sprites.get(c.id); if (sp) tops.push(sp); }
    }
    if (tops.length === 0) return;
    const parts = tops.map((sp, i) => ({ sp, vx: 0, vy: 0, bounces: 0, delay: i * 0.045 }));
    this.celebration = { sprites: [], age: 0 };
    parts.forEach((p) => {
      this.later(p.delay, () => {
        if (!this.celebration) return;
        p.sp.zIndex = 5000 + this.celebration.sprites.length;
        this.cardLayer.addChild(p.sp);
        this.cardLayer.sortChildren();
        p.vx = (Math.random() - 0.5) * 900;
        p.vy = -(500 + Math.random() * 400);
        p.sp.rot.velocity = (Math.random() - 0.5) * 6;
        this.celebration.sprites.push(p);
        this.host.sound('pick', 0.4);
      });
    });
  }

  private stepCelebration(dt: number): void {
    const c = this.celebration;
    if (!c || !this.layout) return;
    c.age += dt;
    const floor = this.height - this.layout.cardH / 2 - 8;
    const g = 2600;
    let alive = 0;
    for (const p of c.sprites) {
      if (p.sp.alpha <= 0.02) continue;
      alive++;
      p.vy += g * dt;
      let x = p.sp.pos.x.value + p.vx * dt, y = p.sp.pos.y.value + p.vy * dt;
      if (y > floor) {
        y = floor;
        p.vy = -p.vy * 0.55;
        p.vx *= 0.9;
        p.bounces++;
        this.host.sound('place', clamp(Math.abs(p.vy) / 1500, 0.2, 0.8));
        this.host.haptic('tick');
      }
      p.sp.snapTo(x, y);
      p.sp.rotation = p.sp.rot.value;
      if (p.bounces >= 3) p.sp.alpha = Math.max(0, p.sp.alpha - dt * 1.8);
      if (x < -this.layout.cardW || x > this.width + this.layout.cardW) p.sp.alpha = 0;
    }
    if (alive === 0 && c.age > 1) {
      this.celebration = null;
      for (const p of c.sprites) p.sp.alpha = 1;
      if (this.view) this.setBoard(this.view, { instant: true });
    }
  }

  private makeSprite(id: CardId): CardSprite {
    const t = this.textures!;
    const face = id >= 0 ? (t.faces.get(id) ?? t.back) : t.back;
    const sp = new CardSprite(id, face, t.back, this.feel);
    if (id >= 0) this.sprites.set(id, sp);
    this.cardLayer.addChild(sp);
    return sp;
  }

  private ensureTextures(cardW: number): void {
    const px = Math.round(cardW * this.dpr);
    if (this.textures && Math.abs(this.textures.pxWidth - px) / px < 0.25) return;
    if (this.texturesBuildingFor === px) return;
    this.texturesBuildingFor = px;
    const ids = this.view ? Array.from(new Set(this.view.piles.flatMap((p) => p.cards.map((c) => c.id)).filter((x): x is number => x !== null))) : [];
    void buildCardTextures(ids.length ? ids : Array.from({ length: 52 }, (_, i) => i), px).then((tex) => {
      if (this.texturesBuildingFor !== px) { destroyCardTextures(tex); return; }
      const old = this.textures;
      this.textures = tex;
      for (const [id, sp] of this.sprites) sp.setTextures(tex.faces.get(id) ?? tex.back, tex.back);
      for (const sp of this.anon) sp.setTextures(tex.back, tex.back);
      for (const s of this.slots.values()) s.texture = tex.slot;
      if (old) destroyCardTextures(old);
      if (this.view) this.setBoard(this.view, { instant: !old });
    });
  }

  /** Response scaled for reduced motion. */
  private r(response: number): number {
    return this.reducedMotion ? response * this.feel.reducedMotionResponseScale : response;
  }

  // ---------------------------------------------------------------- interaction

  private spriteAt(e: FederatedPointerEvent): CardSprite | null {
    let t: Container | null = e.target as Container;
    while (t && !(t instanceof CardSprite)) t = t.parent;
    return t instanceof CardSprite ? t : null;
  }

  /**
   * The Auto-Dealer telegraphs its next move: lift the source card slightly and glow the target for a
   * beat, so watching it play is something rather than nothing (docs/02-game-design.md §7).
   */
  hint(pile: string, index: number, to: string | null): void {
    this.clearHint();
    const sp = pile === 'stock' ? null : [...this.sprites.values()].find((s) => s.pile === pile && s.index === index) ?? null;
    if (sp) {
      sp.lift.target = 0.5;
      sp.scaleS.target = 1 + (this.feel.liftScale - 1) * 0.5;
      this.hinted.push(sp);
    }
    if (to) this.setTargetGlow([to], this.feel.targetGlowAlpha);
    this.hintTarget = to;
  }
  clearHint(): void {
    for (const sp of this.hinted) { sp.lift.target = 0; sp.scaleS.target = 1; }
    this.hinted = [];
    if (this.hintTarget) this.setTargetGlow([this.hintTarget], 0);
    this.hintTarget = null;
  }
  private hinted: CardSprite[] = [];
  private hintTarget: string | null = null;

  /** A tap during a shuffle or deal finishes it immediately (docs/05-feel.md: the deal is skippable). */
  skipChoreography(): void {
    if (this.timers.length === 0) return;
    for (let guard = 0; guard < 8 && this.timers.length; guard++) {
      const due = this.timers.slice().sort((a, b) => a.at - b.at);
      this.timers = [];
      for (const t of due) if (t.token === this.choreo) t.fn();
    }
    this.timers = [];
    if (this.view) this.setBoard(this.view, { instant: true });
  }

  private onDown = (e: FederatedPointerEvent): void => {
    this.host.activity();
    this.clearHint();
    if (this.timers.length > 0 && !this.celebration) { this.skipChoreography(); return; }
    if (this.drag || this.throwing) return;
    const sp = this.spriteAt(e);
    const { x, y } = e.global;
    if (!sp) {
      const slot = e.target as Sprite & { pileId?: string };
      if (slot?.pileId) this.host.tapSlot(slot.pileId);
      return;
    }
    if (sp.id < 0) return;
    const pickable = sp.pickable && this.host.canPickUp(sp.pile, sp.index);
    const run = pickable ? this.runFrom(sp) : [sp];
    this.drag = {
      pile: sp.pile,
      index: sp.index,
      sprites: run,
      startX: x,
      startY: y,
      offsetX: x - sp.pos.x.value,
      offsetY: y - sp.pos.y.value,
      moved: false,
      targets: pickable ? this.host.legalTargets(sp.pile, sp.index) : [],
      downAt: stamp(e),
      samples: [{ t: stamp(e), x, y }],
      pointerId: e.pointerId
    };
    if (pickable) {
      run.forEach((s, i) => {
        s.lift.target = 1;
        s.scaleS.target = this.feel.liftScale;
        s.lift.response = s.scaleS.response = this.r(this.feel.liftResponse);
        this.dragLayer.addChild(s);
        s.zIndex = 1000 + i;
      });
      this.setTargetGlow(this.drag.targets, this.feel.targetGlowAlpha);
      this.host.haptic('tick');
      this.host.sound('pick', 0.2);
    }
  };

  private runFrom(sp: CardSprite): CardSprite[] {
    const out: CardSprite[] = [];
    for (const s of this.sprites.values()) if (s.pile === sp.pile && s.index >= sp.index) out.push(s);
    out.sort((a, b) => a.index - b.index);
    return out;
  }

  private onMove = (e: FederatedPointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const { x, y } = e.global;
    if (!d.moved && Math.hypot(x - d.startX, y - d.startY) > this.feel.dragThresholdPx) d.moved = true;
    if (!d.moved || d.targets.length === 0 && !d.sprites[0]?.pickable) return;
    if (d.targets.length === 0) return; // not pickable: no drag
    const now = stamp(e);
    d.samples.push({ t: now, x, y });
    while (d.samples.length > 8 || (d.samples.length > 2 && now - d.samples[0]!.t > 90)) d.samples.shift();
    this.host.activity();
    const lag = this.feel.runLagMs / 1000;
    d.sprites.forEach((s, i) => {
      s.pos.configure(this.r(this.feel.followResponse) + i * lag, this.feel.followDamping);
      const fan = i * (this.layout ? this.layout.cardH * 0.28 : 0);
      s.pos.setTarget(x - d.offsetX, y - d.offsetY + fan);
      const vx = s.pos.vx;
      s.rot.target = clamp(vx * this.feel.tiltGain, -this.feel.tiltMaxRad, this.feel.tiltMaxRad);
      s.rot.response = this.feel.tiltResponse;
      s.rot.damping = this.feel.tiltDamping;
    });
    // Magnet: nearest valid target breathes.
    this.updateMagnet(x, y, d.targets);
  };

  private magnetPile = '';
  private updateMagnet(x: number, y: number, targets: string[]): void {
    const best = this.nearestTarget(x, y, targets, this.feel.magnetRadiusPx);
    if (best !== this.magnetPile) {
      const prev = this.slots.get(this.magnetPile);
      if (prev) prev.scale.set(prev.scale.x / this.feel.targetMagnetScale);
      this.magnetPile = best ?? '';
      const next = this.slots.get(this.magnetPile);
      if (next) next.scale.set(next.scale.x * this.feel.targetMagnetScale);
    }
  }

  private nearestTarget(x: number, y: number, targets: string[], radius: number): string | null {
    if (!this.layout) return null;
    let best: string | null = null, bestD = Infinity;
    for (const id of targets) {
      const pl = this.layout.piles.get(id);
      if (!pl) continue;
      const dist = rectDistance(pl.extent, x, y);
      if (dist <= radius && dist < bestD) { bestD = dist; best = id; }
    }
    return best;
  }

  private onUp = (e: FederatedPointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    this.updateMagnet(-1e9, -1e9, []);
    const { x, y } = e.global;
    const held = stamp(e) - d.downAt;
    const first = d.sprites[0];
    if (!first) return;

    const v0 = this.releaseVelocity(d.samples);
    const speed0 = Math.hypot(v0.x, v0.y);
    this.lastGesture = { kind: 'none', speed: speed0, held, moved: d.moved };
    if (!d.moved && held < this.feel.tapMaxMs) {
      this.lastGesture.kind = 'tap';
      // Tap (or double-tap — both do the same thing).
      this.settle(d.sprites);
      this.setTargetGlow(d.targets, 0);
      const key = `${d.pile}:${d.index}`;
      this.lastTapAt = performance.now();
      this.lastTapKey = key;
      this.host.tap(d.pile, d.index);
      return;
    }
    if (d.targets.length === 0) {
      this.lastGesture.kind = 'return';
      this.settle(d.sprites);
      return;
    }
    this.setTargetGlow(d.targets, 0);

    // Over a valid target?
    const over = this.nearestTarget(x, y, d.targets, 0) ?? this.nearestTarget(x, y, d.targets, this.feel.magnetRadiusPx * 0.6);
    if (over) {
      this.lastGesture.kind = 'place';
      this.lastGesture.target = over;
      this.place(d, over, 0.5);
      return;
    }
    // Throw?
    const v = v0;
    const speed = speed0;
    if (speed > this.feel.throwMinPxPerS) {
      this.lastGesture.kind = 'throw';
      // Clamp: a coalesced or synthetic burst can report absurd speeds; real flicks top out ~5000 px/s.
      const k = Math.min(1, this.feel.throwMaxPxPerS / speed);
      this.throwing = { sprites: d.sprites, vx: v.x * k, vy: v.y * k, pile: d.pile, index: d.index, targets: d.targets, age: 0 };
      d.sprites.forEach((s) => (s.rot.velocity += v.x * this.feel.throwSpinGain));
      this.host.sound('toss', clamp(speed / 3000, 0.3, 1));
      return;
    }
    // Return home with a shake if a drop was attempted near something.
    this.lastGesture.kind = 'return';
    this.returnHome(d.sprites, true);
  };

  private releaseVelocity(samples: { t: number; x: number; y: number }[]): { x: number; y: number } {
    if (samples.length < 2) return { x: 0, y: 0 };
    const a = samples[0]!, b = samples[samples.length - 1]!;
    const dt = Math.max(0.008, (b.t - a.t) / 1000);
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }

  private place(d: { pile: string; index: number; sprites: CardSprite[] }, to: string, velocity: number): void {
    const changed = this.host.tryMove(d.pile, d.index, to);
    if (changed) {
      d.sprites.forEach((s) => {
        s.pos.configure(this.r(this.feel.placeResponse), this.feel.placeDamping);
        s.lift.target = 0;
        s.scaleS.target = 1;
        s.rot.target = 0;
      });
      this.host.sound('place', clamp(velocity, 0.2, 1));
      this.host.haptic('soft');
      // The host has pushed a new view (setBoard) which set targets; move sprites back to the card layer.
      d.sprites.forEach((s) => { this.cardLayer.addChild(s); });
      this.cardLayer.sortChildren();
    } else {
      this.returnHome(d.sprites, true);
    }
  }

  private returnHome(sprites: CardSprite[], shake: boolean): void {
    if (!this.layout) return;
    sprites.forEach((s) => {
      const pl = this.layout!.piles.get(s.pile);
      const p = pl ? pl.cardPos(s.index) : { x: s.pos.x.value, y: s.pos.y.value };
      s.pos.configure(this.r(this.feel.returnResponse), this.feel.returnDamping);
      s.pos.setTarget(p.x + this.layout!.cardW / 2, p.y + this.layout!.cardH / 2);
      if (shake) s.pos.x.velocity += (Math.random() > 0.5 ? 1 : -1) * this.feel.illegalShakePx * 40;
      s.lift.target = 0;
      s.scaleS.target = 1;
      s.rot.target = 0;
      this.cardLayer.addChild(s);
    });
    this.cardLayer.sortChildren();
    this.host.sound('slideBack', 0.3);
  }

  private settle(sprites: CardSprite[]): void {
    sprites.forEach((s) => {
      s.lift.target = 0;
      s.scaleS.target = 1;
      s.rot.target = 0;
      this.cardLayer.addChild(s);
    });
    this.cardLayer.sortChildren();
  }

  private setTargetGlow(targets: string[], alpha: number): void {
    for (const id of targets) {
      const pl = this.layout?.piles.get(id);
      if (!pl) continue;
      const n = pl.pile.cards.length;
      if (n === 0) {
        const s = this.slots.get(id);
        if (s) s.alpha = alpha > 0 ? 1 : (pl.pile.blocked ? 0.35 : 1), s.tint = alpha > 0 ? 0xffd9a0 : 0xffffff;
      } else {
        const top = pl.pile.cards[n - 1];
        if (top && top.id !== null) this.sprites.get(top.id)?.setGlow(alpha);
      }
    }
  }

  // ---------------------------------------------------------------- frame

  private tick(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.clock += dt;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.clock);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.clock);
        due.forEach((t) => { if (t.token === this.choreo) t.fn(); });
      }
    }
    this.stepCelebration(dt);
    // Lamp breathes (very slowly).
    this.lampPhase += dt;
    const breathe = 1 - (Math.sin((this.lampPhase / 9) * Math.PI * 2) + 1) * 0.008;
    const dimTarget = breathe * (1 - this.lampDim);
    this.felt.alpha += (dimTarget - this.felt.alpha) * Math.min(1, dt * 3);

    for (const sp of this.sprites.values()) sp.step(dt, this.feel);
    for (const sp of this.anon) sp.step(dt, this.feel);

    const th = this.throwing;
    if (th && this.layout) {
      th.age += dt;
      const fr = Math.pow(this.feel.throwFriction, dt * 60);
      th.vx *= fr;
      th.vy *= fr;
      const lead = th.sprites[0]!;
      const x0 = lead.pos.x.value, y0 = lead.pos.y.value;
      const nx = x0 + th.vx * dt, ny = y0 + th.vy * dt;
      // Swept catch test: sample the segment so a fast card cannot jump over a target between frames.
      const segLen = Math.hypot(nx - x0, ny - y0);
      const samples = Math.max(1, Math.ceil(segLen / Math.max(20, this.feel.throwCatchRadiusPx * 0.6)));
      let catchId: string | null = null;
      let cx = nx, cy = ny;
      for (let i = 1; i <= samples && !catchId; i++) {
        const sx = x0 + ((nx - x0) * i) / samples, sy = y0 + ((ny - y0) * i) / samples;
        catchId = this.nearestTarget(sx, sy, th.targets, this.feel.throwCatchRadiusPx);
        if (catchId) { cx = sx; cy = sy; }
      }
      th.sprites.forEach((s, i) => s.snapTo(cx, cy + i * this.layout!.cardH * 0.28));
      const speed = Math.hypot(th.vx, th.vy);
      const off = cx < -this.layout.cardW || cx > this.width + this.layout.cardW || cy < -this.layout.cardH || cy > this.height + this.layout.cardH;
      if (catchId) {
        this.throwing = null;
        th.sprites.forEach((s) => s.pos.configure(this.r(this.feel.catchResponse), 0.8));
        this.place(th, catchId, clamp(speed / 2500, 0.5, 1));
      } else if (speed < 40 || off || th.age > 2.5) {
        this.throwing = null;
        this.returnHome(th.sprites, false);
      }
    }
  }
}
