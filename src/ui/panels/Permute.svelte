<script lang="ts">
  import type { GameHost } from '../host.svelte';
  let { host }: { host: GameHost } = $props();
  const r = $derived(host.view.reshuffle);
</script>

<div class="permute">
  <p class="head">Reshuffle</p>
  <p class="lede">Trade every Cut of this cycle for Permutations. Cuts start again from a small seed; Permutations buy new shapes of value that no Cut ever could.</p>
  <div class="bar"><span class="fill" style:width={`${r.progress * 100}%`}></span></div>
  <div class="row small"><span>Cuts this cycle: <span class="num">{r.cycleCuts}</span></span><span>Worth one at: <span class="num">{r.threshold}</span></span></div>
  <div class="row">
    <div class="stat"><span class="k">On reshuffle</span><span class="num v" class:ok={r.can}>{r.onReshuffle}</span></div>
    <div class="stat"><span class="k">Permutations</span><span class="num v star">{r.permutations}</span></div>
    <div class="stat"><span class="k">Reshuffles</span><span class="num v">{r.reshuffles}</span></div>
  </div>
  <button class="go" disabled={!r.can} onclick={() => host.reshuffle()}>{r.can ? `Reshuffle for ${r.onReshuffle}` : 'Not yet worth a reshuffle'}</button>

  <p class="head">Numbering systems</p>
  <p class="lede">How much each rank is worth. Every system sums to the same deck total, so switching moves value around rather than adding it. Which one wins depends on which cards you have charged.</p>
  <ul class="ladder">
    {#each host.view.numbering as n (n.id)}
      <li class="rung" class:selected={n.selected} class:locked={!n.unlocked}>
        <div class="row">
          <span class="name">{n.name}</span>
          {#if n.selected}<span class="tag">In use</span>
          {:else if n.unlocked}<button class="link" onclick={() => host.selectNumbering(n.id)}>Use</button>
          {:else}<button class="buy" disabled={!n.affordable} onclick={() => host.unlockNumbering(n.id)}>{n.cost} ★</button>{/if}
        </div>
        <div class="shape" aria-hidden="true">
          {#each n.values as v, i (i)}
            {@const h = Math.max(2, Math.min(100, (v / 91) * 400))}
            <span class="bar-v" style:height={`${h}%`} title={`${['A','2','3','4','5','6','7','8','9','10','J','Q','K'][i]}: ${v.toFixed(2)}`}></span>
          {/each}
        </div>
        {#if n.blurb}<p class="blurb">{n.blurb}</p>{/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .permute { color: var(--paper-shade); font-size: 13px; display: flex; flex-direction: column; gap: 10px; }
  .head { margin: 6px 0 0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brass-dim); }
  .lede { margin: 0; line-height: 1.5; }
  .bar { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
  .fill { display: block; height: 100%; background: linear-gradient(to right, var(--violet), var(--star)); transition: width 0.4s ease; }
  .row { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
  .small { font-size: 11px; color: var(--ink-soft); }
  .stat { display: flex; flex-direction: column; }
  .k { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); }
  .v { font-size: 18px; color: var(--paper); }
  .v.ok { color: var(--star); }
  .v.star { color: var(--star); }
  .go { padding: 12px; border-radius: 10px; background: var(--violet); color: var(--paper); font-weight: 700; font-size: 14px; }
  .go:disabled { background: rgba(125,107,158,0.25); color: var(--paper-shade); }
  .ladder { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .rung { background: rgba(244,234,216,0.06); border: 1px solid rgba(201,164,92,0.22); border-radius: var(--radius); padding: 8px 10px; }
  .rung.selected { border-color: var(--star); }
  .rung.locked { opacity: 0.8; }
  .name { font-family: var(--font-serif); font-weight: 600; color: var(--paper); }
  .tag { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--star); }
  .link { color: var(--brass); font-weight: 600; font-size: 12px; }
  .buy { padding: 4px 10px; border-radius: 6px; background: var(--violet); color: var(--paper); font-weight: 600; font-size: 12px; }
  .buy:disabled { background: rgba(125,107,158,0.25); color: var(--paper-shade); }
  .shape { display: flex; align-items: flex-end; gap: 2px; height: 34px; margin: 6px 0 4px; }
  .bar-v { flex: 1; background: var(--star); opacity: 0.8; border-radius: 1px 1px 0 0; min-height: 1px; }
  .blurb { margin: 0; font-size: 11px; color: var(--ink-soft); line-height: 1.4; }
</style>
