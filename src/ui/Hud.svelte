<script lang="ts">
  import type { GameHost } from './host.svelte';
  import Sky from './Sky.svelte';
  let { host }: { host: GameHost } = $props();
</script>

<header class="hud">
  <div class="stat">
    <span class="label">Shuffles</span>
    <span class="num value">{host.view.shuffles}</span>
  </div>
  <div class="stat">
    <span class="label">Rate</span>
    <span class="num value moss">{host.view.rate}</span>
  </div>
  <div class="stat">
    <span class="label">Awake</span>
    <span class="num value">{host.view.awake}<span class="dim">/{host.view.deck.length}</span></span>
  </div>
  {#if host.view.cut.revealed}
    <div class="stat">
      <span class="label">Cuts</span>
      <span class="num value violet">{host.view.cut.cuts}</span>
    </div>
  {/if}
  <div class="sky"><Sky journey={host.view.journey} flash={host.view.milestoneFlash} /></div>
  <div class="stat right">
    <span class="label">{host.view.nextMilestoneLabel}</span>
    <span class="bar"><span class="fill" style:width={`${host.view.nextMilestoneProgress * 100}%`}></span></span>
  </div>
</header>

<style>
  .hud {
    grid-area: hud; display: flex; align-items: center; gap: 22px; padding: 0 18px;
    background: linear-gradient(to bottom, #182d29, var(--felt-deep)); border-bottom: 1px solid rgba(201,164,92,0.18);
  }
  .stat { display: flex; flex-direction: column; min-width: 90px; }
  .label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--brass-dim); }
  .value { font-size: 22px; color: var(--brass); line-height: 1.1; }
  .moss { color: var(--moss); }
  .violet { color: #b3a3d6; }
  .dim { color: var(--ink-soft); font-size: 14px; }
  .sky { flex: 1; height: 100%; min-width: 120px; }
  .right { min-width: 200px; align-items: flex-end; }
  .bar { width: 200px; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; margin-top: 6px; }
  .fill { display: block; height: 100%; background: var(--brass); transition: width 0.4s ease; }
</style>
