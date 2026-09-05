<script lang="ts">
  import type { GameHost } from '../host.svelte';
  let { host }: { host: GameHost } = $props();
</script>

<div class="ledger">
  <p class="head">The Keeper's ledger</p>
  {#if host.view.ledger.length === 0}
    <p class="entry quiet">Nothing yet. The lamp is warm.</p>
  {/if}
  {#each host.view.ledger as e (e.id)}
    <p class="entry">{e.text}</p>
  {/each}
  <div class="stats">
    <div><span class="k">Hands</span><span class="num v">{host.view.handsPlayed}</span></div>
    <div><span class="k">Won</span><span class="num v">{host.view.handsWon}</span></div>
    <div><span class="k">Cuts</span><span class="num v">{host.view.cutsPerformed}</span></div>
  </div>
</div>

<style>
  .ledger { background: var(--paper); color: var(--ink); border-radius: var(--radius); padding: 14px; font-family: var(--font-serif); }
  .head { margin: 0 0 10px; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brass-dim); font-family: var(--font-sans); }
  .entry { margin: 0 0 10px; line-height: 1.5; font-size: 14px; border-left: 2px solid var(--paper-shade); padding-left: 10px; }
  .quiet { color: var(--ink-soft); font-style: italic; }
  .stats { display: flex; gap: 14px; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--paper-shade); font-family: var(--font-sans); }
  .stats div { display: flex; flex-direction: column; }
  .k { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); }
  .v { font-size: 16px; }
</style>
