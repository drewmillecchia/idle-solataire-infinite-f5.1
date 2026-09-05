<script lang="ts">
  import type { GameHost } from '../host.svelte';
  let { host }: { host: GameHost } = $props();
  const BRANCHES: { id: string; label: string }[] = [
    { id: 'trunk', label: 'The Trunk' }, { id: 'hand', label: 'The Hand' }, { id: 'dealer', label: 'The Dealer' },
    { id: 'gambler', label: 'The Gambler' }, { id: 'scholar', label: 'The Scholar' }
  ];
  const grouped = $derived(BRANCHES.map((b) => ({ ...b, nodes: host.view.constellation.filter((n) => n.branch === b.id) })).filter((b) => b.nodes.length));
</script>

<div class="stars">
  <p class="lede">Permanent. Bought with Cuts. Nothing here is ever undone.</p>
  <p class="held">Cuts held: <span class="num">{host.view.cut.cuts}</span></p>
  {#each grouped as b (b.id)}
    <h4>{b.label}</h4>
    <ul>
      {#each b.nodes as n (n.id)}
        <li class="node" class:maxed={n.level >= n.max} class:affordable={n.affordable}>
          <div class="row">
            <span class="name">{n.name}</span>
            <span class="num lvl">{n.level}<span class="dim">/{n.max}</span></span>
          </div>
          <p class="blurb">{n.blurb}</p>
          <p class="effect">{n.effect}</p>
          <div class="row">
            {#if n.level >= n.max}<span class="dim">Complete</span>{:else}<span class="num cost" class:ok={n.affordable}>{n.cost} {n.cost === '1' ? 'Cut' : 'Cuts'}</span>{/if}
            {#if n.level < n.max}<button class="buy" disabled={!n.affordable} onclick={() => host.buyNode(n.id)}>Light it</button>{/if}
          </div>
        </li>
      {/each}
    </ul>
  {/each}
</div>

<style>
  .stars { color: var(--paper-shade); font-size: 13px; }
  .lede { margin: 0 0 6px; color: var(--ink-soft); line-height: 1.5; }
  .held { margin: 0 0 8px; color: var(--brass); }
  h4 { margin: 12px 0 6px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brass-dim); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .node { background: rgba(244,234,216,0.06); border: 1px solid rgba(201,164,92,0.22); border-radius: var(--radius); padding: 8px 10px; }
  .node.affordable { border-color: var(--brass); }
  .node.maxed { border-color: rgba(223,233,255,0.35); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .name { font-family: var(--font-serif); font-weight: 600; color: var(--paper); }
  .lvl { color: var(--star); }
  .dim { color: var(--ink-soft); }
  .blurb { margin: 3px 0 0; font-size: 12px; color: var(--ink-soft); line-height: 1.4; }
  .effect { margin: 2px 0 6px; font-size: 12px; }
  .cost { color: var(--ink-soft); }
  .cost.ok { color: var(--brass); font-weight: 600; }
  .buy { padding: 5px 10px; border-radius: 6px; background: var(--brass); color: var(--ink); font-weight: 600; font-size: 12px; }
  .buy:disabled { background: rgba(201,164,92,0.2); color: var(--paper-shade); }
</style>
