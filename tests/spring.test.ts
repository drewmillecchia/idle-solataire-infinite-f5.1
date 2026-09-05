import { describe, it, expect } from 'vitest';
import { Spring, Spring2 } from '../src/table/spring';

describe('Spring', () => {
  it('settles on its target and reports rest', () => {
    const s = new Spring(0, 0.2, 1);
    s.target = 100;
    let moving = true;
    for (let i = 0; i < 400 && moving; i++) moving = s.step(1 / 60);
    expect(moving).toBe(false);
    expect(s.value).toBeCloseTo(100, 3);
  });
  it('critically damped never overshoots; underdamped does', () => {
    const crit = new Spring(0, 0.2, 1);
    crit.target = 100;
    let maxCrit = 0;
    for (let i = 0; i < 200; i++) { crit.step(1 / 60); maxCrit = Math.max(maxCrit, crit.value); }
    expect(maxCrit).toBeLessThanOrEqual(100.5);
    const bouncy = new Spring(0, 0.2, 0.5);
    bouncy.target = 100;
    let maxB = 0;
    for (let i = 0; i < 200; i++) { bouncy.step(1 / 60); maxB = Math.max(maxB, bouncy.value); }
    expect(maxB).toBeGreaterThan(105);
  });
  it('is stable with tiny response and large dt', () => {
    const s = new Spring(0, 0.02, 1);
    s.target = 50;
    for (let i = 0; i < 30; i++) s.step(0.05);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(s.value).toBeCloseTo(50, 1);
  });
  it('Spring2 configures both axes', () => {
    const s = new Spring2(0, 0, 0.3, 1);
    s.configure(0.1, 0.8);
    expect(s.x.response).toBe(0.1);
    expect(s.y.damping).toBe(0.8);
    s.setTarget(10, 20);
    for (let i = 0; i < 300; i++) s.step(1 / 60);
    expect(s.x.value).toBeCloseTo(10, 2);
    expect(s.y.value).toBeCloseTo(20, 2);
  });
});
