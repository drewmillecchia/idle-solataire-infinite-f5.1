<script lang="ts">
  /**
   * A button with feel: press scale spring, and optional hold-to-repeat that ramps from holdStartHz to
   * holdMaxHz over holdRampMs (docs/05-feel.md). Every constant comes from feel.
   */
  import type { Feel } from '$content/index';
  import { sound, haptic } from '../audio/presenters';
  let { label, onpress, onrepeat, disabled = false, primary = false, feel, repeat = false }:
    { label: string; onpress: () => void; onrepeat?: (rate: number) => void; disabled?: boolean; primary?: boolean; feel: Feel; repeat?: boolean } = $props();

  let pressed = $state(false);
  let holdTimer: number | null = null;
  let holdStart = 0;
  let fired = false;

  function schedule(): void {
    const elapsed = performance.now() - holdStart - feel.holdInitialMs;
    const t = Math.max(0, Math.min(1, elapsed / feel.holdRampMs));
    const eased = t * t * (3 - 2 * t);
    const hz = feel.holdStartHz + (feel.holdMaxHz - feel.holdStartHz) * eased;
    holdTimer = window.setTimeout(() => {
      fired = true;
      onrepeat?.(hz);
      sound('tick', 0.3 + eased * 0.6);
      if (eased < 0.7) haptic('tick');
      schedule();
    }, 1000 / hz);
  }

  function down(e: PointerEvent): void {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pressed = true;
    fired = false;
    haptic('tick');
    sound('tick', 0.4);
    if (repeat) {
      holdStart = performance.now();
      holdTimer = window.setTimeout(() => { fired = true; onrepeat?.(feel.holdStartHz); schedule(); }, feel.holdInitialMs);
    }
  }
  function up(e: PointerEvent): void {
    if (!pressed) return;
    pressed = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    const inside = (e.currentTarget as HTMLElement).contains(document.elementFromPoint(e.clientX, e.clientY));
    if (!fired && inside && !disabled) onpress();
    if (fired) haptic('soft');
  }
</script>

<button
  class="hold" class:primary class:pressed
  {disabled}
  style:--press-scale={feel.btnPressScale}
  style:--press-ms={`${feel.btnPressResponse * 1000}ms`}
  onpointerdown={down} onpointerup={up} onpointercancel={up} onlostpointercapture={up}
>{label}</button>

<style>
  .hold {
    padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.02em;
    color: var(--btn-fg, var(--paper)); background: var(--btn-bg, rgba(244,234,216,0.08)); border: 1px solid rgba(201,164,92,0.35);
    transition: transform var(--press-ms) ease-out, background 0.15s;
    transform: scale(1);
  }
  .hold.primary { background: var(--brass); color: var(--ink); border-color: transparent; }
  .hold.pressed { transform: scale(var(--press-scale)); }
  .hold:disabled { opacity: 0.4; cursor: default; }
</style>
