<script lang="ts">
  import type { GameHost } from '../host.svelte';
  import HoldButton from '../HoldButton.svelte';
  let { host }: { host: GameHost } = $props();
</script>

{#if host.view.upgrades.length === 0}
  <p class="quiet">Play a card home and the deck will start to earn. Upgrades follow.</p>
{/if}
<ul class="list">
  {#each host.view.upgrades as u (u.id)}
    <li class="card" class:affordable={u.affordable}>
      <div class="row">
        <span class="name">{u.name}</span>
        <span class="num owned">{u.owned}{#if u.max !== null}<span class="dim">/{u.max}</span>{/if}</span>
      </div>
      <p class="blurb">{u.blurb}</p>
      <p class="effect">{u.effect}</p>
      <div class="row">
        <span class="num cost" class:ok={u.affordable}>{u.cost}</span>
        <HoldButton label="Buy" primary={u.affordable} disabled={!u.affordable} feel={host.feel} repeat
          onpress={() => host.buy(u.id)} onrepeat={() => host.buy(u.id)} />
      </div>
    </li>
  {/each}
</ul>

<style>
  .quiet { color: var(--ink-soft); font-style: italic; line-height: 1.5; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .card { --btn-fg: var(--ink); --btn-bg: rgba(42,35,32,0.06); background: var(--paper); color: var(--ink); border-radius: var(--radius); padding: 10px 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.25); opacity: 0.85; transition: opacity 0.2s; }
  .card.affordable { opacity: 1; box-shadow: 0 0 0 1px var(--brass), 0 2px 8px rgba(0,0,0,0.3); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .name { font-family: var(--font-serif); font-size: 15px; font-weight: 600; }
  .owned { color: var(--brass-dim); }
  .dim { color: var(--ink-soft); }
  .blurb { margin: 4px 0 0; font-size: 12px; color: var(--ink-soft); line-height: 1.4; }
  .effect { margin: 2px 0 8px; font-size: 12px; color: var(--ink); }
  .cost { color: var(--ink-soft); }
  .cost.ok { color: var(--brass-dim); font-weight: 600; }
</style>
