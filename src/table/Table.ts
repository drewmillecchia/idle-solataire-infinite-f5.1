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
  generator(id: CardId): { awake: boolean; charge: number };
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
  private felt = new Graphics();
  private lamp = new Graphics();
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

  feel: Feel;
  host: TableHost;
  reducedMotion = false;

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
      preference: 'webgl'
    });
    parent.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';
    this.root.addChild(this.felt, this.lamp, this.slotLayer, this.cardLayer, this.dragLayer);
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

  private drawFelt(): void {
    const w = this.width, h = this.height;
    this.felt.clear().rect(0, 0, w, h).fill({ color: 0x1f3a34 });
    // Vignette edges.
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const inset = i * Math.min(w, h) * 0.012;
      this.felt.roundRect(inset, inset, w - inset * 2, h - inset * 2, 24).stroke({ color: 0x162925, alpha: 0.10 + i * 0.03, width: Math.min(w, h) * 0.02 });
    }
    // Lamp pool: soft warm ellipse, upper-left leaning.
    this.lamp.clear();
    const cx = w * 0.42, cy = h * 0.38;
    for (let i = 8; i >= 1; i--) {
      const r = (Math.max(w, h) * 0.75 * i) / 8;
      this.lamp.ellipse(cx, cy, r, r * 0.72).fill({ color: 0xffd9a0, alpha: 0.012 });
    }
  }

  /** Push a new board. Sprites reconcile by card id and spring to their new places. */
  setBoard(view: BoardView, opts: { instant?: boolean; relayout?: boolean; deal?: boolean } = {}): void {
    this.view = view;
    if (!this.ready) {
      this.pendingView = view;
      return;
    }
    const layout = layoutBoard(view, this.width, this.height);
    this.layout = layout;
    this.ensureTextures(layout.cardW);
    if (!this.textures) return; // will re-run when textures land

    // Slots.
    for (const [id, s] of this.slots) if (!layout.piles.has(id)) { s.destroy(); this.slots.delete(id); }
    for (const [id, pl] of layout.piles) {
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
          sp.setGenerator(g.awake, g.charge);
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
            const delay = dealDelay++ * (this.feel.dealIntervalMs / 1000);
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

  private timers: { at: number; fn: () => void }[] = [];
  private clock = 0;
  private later(delay: number, fn: () => void): void {
    this.timers.push({ at: this.clock + delay, fn });
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

  private onDown = (e: FederatedPointerEvent): void => {
    this.host.activity();
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
      downAt: performance.now(),
      samples: [{ t: performance.now(), x, y }],
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
    const now = performance.now();
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
    const held = performance.now() - d.downAt;
    const first = d.sprites[0];
    if (!first) return;

    if (!d.moved && held < this.feel.tapMaxMs) {
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
      this.settle(d.sprites);
      return;
    }
    this.setTargetGlow(d.targets, 0);

    // Over a valid target?
    const over = this.nearestTarget(x, y, d.targets, 0) ?? this.nearestTarget(x, y, d.targets, this.feel.magnetRadiusPx * 0.6);
    if (over) {
      this.place(d, over, 0.5);
      return;
    }
    // Throw?
    const v = this.releaseVelocity(d.samples);
    const speed = Math.hypot(v.x, v.y);
    if (speed > this.feel.throwMinPxPerS) {
      this.throwing = { sprites: d.sprites, vx: v.x, vy: v.y, pile: d.pile, index: d.index, targets: d.targets, age: 0 };
      d.sprites.forEach((s) => (s.rot.velocity += v.x * this.feel.throwSpinGain));
      this.host.sound('toss', clamp(speed / 3000, 0.3, 1));
      return;
    }
    // Return home with a shake if a drop was attempted near something.
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
        due.forEach((t) => t.fn());
      }
    }
    // Lamp breathes.
    this.lampPhase += dt;
    this.lamp.alpha = 1 + Math.sin((this.lampPhase / 9) * Math.PI * 2) * 0.03;

    for (const sp of this.sprites.values()) sp.step(dt, this.feel);
    for (const sp of this.anon) sp.step(dt, this.feel);

    const th = this.throwing;
    if (th && this.layout) {
      th.age += dt;
      const fr = Math.pow(this.feel.throwFriction, dt * 60);
      th.vx *= fr;
      th.vy *= fr;
      const lead = th.sprites[0]!;
      const nx = lead.pos.x.value + th.vx * dt, ny = lead.pos.y.value + th.vy * dt;
      th.sprites.forEach((s, i) => s.snapTo(nx, ny + i * this.layout!.cardH * 0.28));
      // Caught by a valid target?
      const catchId = this.nearestTarget(nx, ny, th.targets, this.feel.throwCatchRadiusPx);
      const speed = Math.hypot(th.vx, th.vy);
      const off = nx < -this.layout.cardW || nx > this.width + this.layout.cardW || ny < -this.layout.cardH || ny > this.height + this.layout.cardH;
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
