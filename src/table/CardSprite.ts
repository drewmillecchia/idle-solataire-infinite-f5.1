import { Container, Sprite, Texture, Graphics, Text } from 'pixi.js';
import { Spring, Spring2, clamp } from './spring';
import type { Feel } from '$content/index';
import type { CardId } from '$engine/types';

/**
 * One card on the table. Owns its springs (position, scale, rotation, lift/shadow, flip) and knows
 * nothing about rules. The Table sets targets; the sprite settles.
 */
export class CardSprite extends Container {
  readonly id: CardId;
  readonly pos: Spring2;
  readonly scaleS: Spring;
  readonly rot: Spring;
  readonly lift: Spring; // 0..1, drives shadow offset and a touch of extra scale
  readonly flip: Spring; // 0 = face down, 1 = face up

  private face: Sprite;
  private back: Sprite;
  private shadow: Graphics;
  private glow: Graphics;
  private awakeMark: Graphics;
  private chargeTicks: Graphics;
  private markText: Text | null = null;
  private markGlyph = '';
  private w = 0;
  private h = 0;
  faceUp = false;
  awake = false;
  charge = 0;
  /** Pile/index this sprite currently represents (set by the Table). */
  pile = '';
  index = 0;
  pickable = false;

  constructor(id: CardId, face: Texture, back: Texture, feel: Feel) {
    super();
    this.id = id;
    this.pos = new Spring2(0, 0, feel.placeResponse, feel.placeDamping);
    this.scaleS = new Spring(1, feel.liftResponse, feel.liftDamping);
    this.rot = new Spring(0, feel.tiltResponse, feel.tiltDamping);
    this.lift = new Spring(0, feel.liftResponse, feel.liftDamping);
    this.flip = new Spring(0, feel.flipResponse, 1);

    this.shadow = new Graphics();
    this.glow = new Graphics();
    this.face = new Sprite(face);
    this.back = new Sprite(back);
    this.awakeMark = new Graphics();
    this.chargeTicks = new Graphics();
    this.face.anchor.set(0.5);
    this.back.anchor.set(0.5);
    this.addChild(this.shadow, this.glow, this.back, this.face, this.awakeMark, this.chargeTicks);
    this.eventMode = 'static';
    this.cursor = 'pointer';
  }

  setTextures(face: Texture, back: Texture): void {
    this.face.texture = face;
    this.back.texture = back;
    this.resize(this.w, this.h);
  }

  resize(w: number, h: number): void {
    // Called for all 52 cards on every board push. Rebuilding four Graphics and re-rasterising the
    // mark text each time cost more than the rest of the frame put together.
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.face.width = w;
    this.face.height = h;
    this.back.width = w;
    this.back.height = h;
    const r = w * 0.06;
    this.shadow.clear().roundRect(-w / 2, -h / 2, w, h, r).fill({ color: 0x000000, alpha: 1 });
    this.glow.clear().roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, r + 3).fill({ color: 0xffd9a0, alpha: 1 });
    this.glow.alpha = 0;
    this.awakeMark.clear().star(w * 0.36, -h * 0.42, 5, w * 0.035, w * 0.016).fill({ color: 0xc9a45c });
    this.redrawCharge();
    this.layoutMark();
    this.hitArea = { contains: (x: number, y: number) => Math.abs(x) <= w / 2 && Math.abs(y) <= h / 2 };
  }

  private redrawCharge(): void {
    const g = this.chargeTicks.clear();
    if (this.charge <= 0) return;
    const n = Math.min(this.charge, 5);
    const tw = this.w * 0.05, th = this.w * 0.018, gap = tw * 0.5;
    const total = n * tw + (n - 1) * gap;
    for (let i = 0; i < n; i++) g.roundRect(-total / 2 + i * (tw + gap), this.h / 2 - th * 2.4, tw, th, th / 2).fill({ color: 0xc9a45c, alpha: 0.9 });
  }

  setGenerator(awake: boolean, charge: number, glyph = ''): void {
    if (glyph !== this.markGlyph) this.setMarkGlyph(glyph);
    if (awake === this.awake && charge === this.charge) return;
    this.awake = awake;
    this.charge = charge;
    this.redrawCharge();
  }

  /** A Mark's single ink glyph in the top-right corner (docs/09-art-direction.md). */
  private setMarkGlyph(glyph: string): void {
    this.markGlyph = glyph;
    if (!glyph) { this.markText?.destroy(); this.markText = null; return; }
    if (!this.markText) {
      this.markText = new Text({ text: glyph, style: { fontFamily: 'Iowan Old Style, Palatino, Georgia, serif', fontSize: 24, fill: 0x2a2320 } });
      this.markText.anchor.set(0.5);
      this.addChild(this.markText);
    } else this.markText.text = glyph;
    this.layoutMark();
  }
  private layoutMark(): void {
    if (!this.markText) return;
    this.markText.style.fontSize = Math.max(10, this.w * 0.16);
    this.markText.position.set(this.w * 0.36, -this.h * 0.3);
  }

  /** Immediately snap to a position (deal start, initial layout). */
  snapTo(x: number, y: number): void {
    this.pos.set(x, y);
    this.position.set(x, y);
  }

  setFaceUp(up: boolean, instant = false): void {
    this.faceUp = up;
    this.flip.target = up ? 1 : 0;
    if (instant) this.flip.set(up ? 1 : 0);
  }

  setGlow(alpha: number): void {
    this.glowTarget = alpha;
  }
  private glowTarget = 0;

  /** Advance springs. Returns true while anything is still moving. */
  step(dt: number, feel: Feel): boolean {
    let moving = this.pos.step(dt);
    moving = this.scaleS.step(dt) || moving;
    moving = this.rot.step(dt) || moving;
    moving = this.lift.step(dt) || moving;
    moving = this.flip.step(dt) || moving;

    this.position.set(this.pos.x.value, this.pos.y.value);
    const f = clamp(this.flip.value, 0, 1);
    // Flip: scale.x through zero; lift slightly at the midpoint.
    const sx = Math.abs(f * 2 - 1);
    const midLift = 1 + (1 - sx) * (feel.flipLift - 1);
    const s = this.scaleS.value * midLift;
    this.scale.set(s * Math.max(0.02, sx), s);
    this.face.visible = f >= 0.5;
    this.back.visible = f < 0.5;
    // An awake card glows faintly from behind when face-down: you can see the deck's warmth in the stock.
    this.back.tint = this.awake ? 0xffe9c4 : 0xffffff;
    this.awakeMark.visible = this.awake && f >= 0.5;
    this.chargeTicks.visible = this.charge > 0 && f >= 0.5;
    if (this.markText) this.markText.visible = f >= 0.5;
    this.rotation = this.rot.value;

    const lift = clamp(this.lift.value, 0, 1.5);
    const sh = feel.shadowLiftPx * lift;
    this.shadow.position.set(sh * 0.35, sh);
    this.shadow.alpha = feel.shadowBaseAlpha * (0.35 + lift * 0.65);
    this.shadow.scale.set(1 + lift * 0.06);

    if (Math.abs(this.glow.alpha - this.glowTarget) > 0.005) {
      this.glow.alpha += (this.glowTarget - this.glow.alpha) * Math.min(1, dt * 12);
      moving = true;
    }
    return moving;
  }
}
