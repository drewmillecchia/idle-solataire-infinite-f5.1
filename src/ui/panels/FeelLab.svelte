<script lang="ts">
  /** Live tuning of feel.json (ADR-011). Numbers only; haptics patterns are edited in the file. */
  import type { GameHost } from '../host.svelte';
  import type { Feel } from '$content/index';
  let { host }: { host: GameHost } = $props();
  const groups: { title: string; keys: (keyof Feel)[] }[] = [
    { title: 'Tap & drag', keys: ['tapMaxMs', 'dragThresholdPx', 'liftScale', 'liftResponse', 'shadowLiftPx', 'runLagMs', 'followResponse', 'followDamping'] },
    { title: 'Tilt', keys: ['tiltGain', 'tiltMaxRad', 'tiltResponse', 'tiltDamping'] },
    { title: 'Drop & return', keys: ['placeResponse', 'placeDamping', 'returnResponse', 'returnDamping', 'illegalShakePx', 'magnetRadiusPx', 'targetGlowAlpha'] },
    { title: 'Throw', keys: ['throwMinPxPerS', 'throwMaxPxPerS', 'throwFriction', 'throwCatchRadiusPx', 'catchResponse', 'throwSpinGain'] },
    { title: 'Flip & deal', keys: ['flipResponse', 'flipLift', 'dealIntervalMs', 'dealResponse', 'dealDamping'] },
    { title: 'Buttons', keys: ['btnPressScale', 'btnPressResponse', 'holdInitialMs', 'holdStartHz', 'holdMaxHz', 'holdRampMs'] }
  ];
  const ranges: Partial<Record<keyof Feel, [number, number, number]>> = {
    tapMaxMs: [80, 500, 10], dragThresholdPx: [1, 30, 1], liftScale: [1, 1.3, 0.005], liftResponse: [0.03, 0.6, 0.005], shadowLiftPx: [0, 40, 1], runLagMs: [0, 80, 1],
    followResponse: [0.01, 0.4, 0.005], followDamping: [0.3, 1.5, 0.05], tiltGain: [0, 0.004, 0.0001], tiltMaxRad: [0, 0.6, 0.01], tiltResponse: [0.03, 0.6, 0.01], tiltDamping: [0.3, 1.5, 0.05],
    placeResponse: [0.05, 0.6, 0.01], placeDamping: [0.3, 1.5, 0.02], returnResponse: [0.05, 0.8, 0.01], returnDamping: [0.3, 1.5, 0.02], illegalShakePx: [0, 20, 1], magnetRadiusPx: [0, 160, 2], targetGlowAlpha: [0, 1, 0.02],
    throwMinPxPerS: [200, 3000, 50], throwMaxPxPerS: [1000, 12000, 100], throwFriction: [0.9, 0.999, 0.001], throwCatchRadiusPx: [0, 200, 2], catchResponse: [0.05, 0.6, 0.01], throwSpinGain: [0, 0.002, 0.0001],
    flipResponse: [0.05, 0.5, 0.01], flipLift: [1, 1.2, 0.005], dealIntervalMs: [0, 120, 2], dealResponse: [0.05, 0.6, 0.01], dealDamping: [0.3, 1.5, 0.02],
    btnPressScale: [0.8, 1, 0.005], btnPressResponse: [0.02, 0.3, 0.005], holdInitialMs: [100, 1000, 10], holdStartHz: [1, 10, 0.5], holdMaxHz: [5, 40, 1], holdRampMs: [300, 5000, 50]
  };
  let copied = $state(false);
  async function copy(): Promise<void> {
    try { await navigator.clipboard.writeText(host.feelJson()); copied = true; setTimeout(() => (copied = false), 1500); } catch { /* ignore */ }
  }
</script>

<div class="lab">
  <p class="hint">Drag cards while you tune. Export, then paste into <code>src/content/feel.json</code>.</p>
  <p class="last num">Last release: {host.view.lastGesture || '—'}</p>
  <div class="actions">
    <button class="link" onclick={copy}>{copied ? 'Copied' : 'Copy JSON'}</button>
    <button class="link" onclick={() => host.resetFeel()}>Reset</button>
  </div>
  {#each groups as g (g.title)}
    <h4>{g.title}</h4>
    {#each g.keys as k (k)}
      {@const r = ranges[k] ?? [0, 1, 0.01]}
      <label class="row">
        <span class="k">{k}</span>
        <span class="num v">{Number(host.feel[k]).toFixed(r[2] < 0.01 ? 4 : r[2] < 1 ? 3 : 0)}</span>
        <input type="range" min={r[0]} max={r[1]} step={r[2]} value={host.feel[k] as number}
          oninput={(e) => host.setFeel(k, Number((e.currentTarget as HTMLInputElement).value) as Feel[typeof k])} />
      </label>
    {/each}
  {/each}
</div>

<style>
  .lab { color: var(--paper-shade); font-size: 12px; }
  .hint { color: var(--ink-soft); line-height: 1.5; margin: 0 0 8px; }
  .last { color: var(--moss); margin: 0 0 8px; font-size: 12px; }
  code { color: var(--brass); }
  .actions { display: flex; gap: 14px; margin-bottom: 6px; }
  .link { color: var(--brass); font-weight: 600; }
  h4 { margin: 12px 0 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--brass-dim); }
  .row { display: grid; grid-template-columns: 1fr 52px; gap: 4px 8px; align-items: center; margin: 4px 0; }
  .row input { grid-column: 1 / -1; width: 100%; }
  .k { color: var(--paper-shade); }
  .v { text-align: right; color: var(--brass); }
</style>
