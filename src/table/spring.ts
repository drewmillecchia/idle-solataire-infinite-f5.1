/**
 * Damped springs parametrised by `response` (seconds to settle, roughly) and `dampingRatio`
 * (1 = critically damped, < 1 bounces). Velocity-aware so gestures hand off cleanly.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  response: number;
  damping: number;

  constructor(value: number, response = 0.2, damping = 1) {
    this.value = value;
    this.target = value;
    this.response = response;
    this.damping = damping;
  }

  set(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  /** Advance by dt seconds. Returns true while still moving. */
  step(dt: number): boolean {
    if (dt <= 0) return this.isMoving();
    // Semi-implicit Euler is stable only while omega*h stays well under 2, so the sub-step shrinks
    // with the response (h <= response/12 => omega*h <= ~0.52).
    const response = Math.max(0.005, this.response);
    const maxH = Math.min(0.008, response / 12);
    const steps = Math.min(400, Math.max(1, Math.ceil(dt / maxH)));
    const h = dt / steps;
    const omega = (2 * Math.PI) / response;
    const k = omega * omega;
    const c = 2 * this.damping * omega;
    for (let i = 0; i < steps; i++) {
      const x = this.value - this.target;
      const a = -k * x - c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    if (!this.isMoving()) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }

  isMoving(eps = 0.001): boolean {
    return Math.abs(this.value - this.target) > eps || Math.abs(this.velocity) > eps * 10;
  }
}

export class Spring2 {
  x: Spring;
  y: Spring;
  constructor(x: number, y: number, response = 0.2, damping = 1) {
    this.x = new Spring(x, response, damping);
    this.y = new Spring(y, response, damping);
  }
  set(x: number, y: number): void {
    this.x.set(x);
    this.y.set(y);
  }
  setTarget(x: number, y: number): void {
    this.x.target = x;
    this.y.target = y;
  }
  configure(response: number, damping: number): void {
    this.x.response = this.y.response = response;
    this.x.damping = this.y.damping = damping;
  }
  step(dt: number): boolean {
    const a = this.x.step(dt);
    const b = this.y.step(dt);
    return a || b;
  }
  get vx(): number {
    return this.x.velocity;
  }
  get vy(): number {
    return this.y.velocity;
  }
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
