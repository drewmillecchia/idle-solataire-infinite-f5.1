<script lang="ts">
  import type { GameHost } from '../host.svelte';
  import type { WayId } from '$engine/types';
  let { host }: { host: GameHost } = $props();
  let chosen: WayId = $state('hand');
  $effect(() => { if (!host.view.cut.ways.find((w) => w.id === chosen)?.unlocked) chosen = 'hand'; });
  const c = $derived(host.view.cut);
</script>

<div class="cut">
  <p class="head">Cut the Deck</p>
  <p class="lede">Trade this run for Cuts. The deck forgets its charge; you keep everything you have learned, and every card pays more from now on.</p>

  <div class="meter">
    <div class="bar"><span class="fill" style:width={`${c.progress * 100}%`}></span></div>
    <div class="row small">
      <span>This run: <span class="num">{c.runEarned}</span></span>
      <span>Worth a cut at: <span class="num">{c.threshold}</span></span>
    </div>
  </div>

  <div class="row">
    <div class="stat"><span class="k">On cut</span><span class="num v" class:ok={c.canCut}>{c.cutsOnCut}</span></div>
    <div class="stat"><span class="k">Cuts held</span><span class="num v">{c.cuts}</span></div>
    <div class="stat"><span class="k">Lifetime</span><span class="num v">{c.lifetimeCuts}</span></div>
  </div>

  <p class="head">How will you play the next run?</p>
  <div class="ways">
    {#each c.ways as w (w.id)}
      <button class="way" class:chosen={chosen === w.id} disabled={!w.unlocked} onclick={() => (chosen = w.id)}>
        <span class="wname">{w.name}</span>
        <span class="wmood">{w.mood}</span>
        <span class="wblurb">{w.blurb}</span>
        <span class="wmech">{w.unlocked ? w.mechanics : 'Found on the Constellation.'}</span>
      </button>
    {/each}
  </div>

  <button class="go" disabled={!c.canCut || c.cutting} onclick={() => host.cut(chosen)}>
    {c.cutting ? 'Cutting…' : c.canCut ? `Cut the deck for ${c.cutsOnCut}` : 'Not yet worth a cut'}
  </button>
  {#if c.way !== 'none'}<p class="small dim">This run: {c.ways.find((w) => w.id === c.way)?.name ?? c.way}.</p>{/if}
</div>

<style>
  .cut { color: var(--paper-shade); font-size: 13px; display: flex; flex-direction: column; gap: 10px; }
  .head { margin: 6px 0 0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brass-dim); }
  .lede { margin: 0; line-height: 1.5; color: var(--paper-shade); }
  .bar { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
  .fill { display: block; height: 100%; background: linear-gradient(to right, var(--brass-dim), var(--lamp)); transition: width 0.4s ease; }
  .row { display: flex; justify-content: space-between; gap: 10px; }
  .small { font-size: 11px; color: var(--ink-soft); margin-top: 4px; }
  .stat { display: flex; flex-direction: column; }
  .k { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); }
  .v { font-size: 18px; color: var(--paper); }
  .v.ok { color: var(--lamp); }
  .ways { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .way { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 8px 10px; border-radius: 8px; background: rgba(244,234,216,0.06); border: 1px solid rgba(201,164,92,0.25); color: var(--paper-shade); }
  .way.chosen { background: var(--paper); color: var(--ink); border-color: var(--brass); }
  .way:disabled { opacity: 0.45; }
  .wname { font-family: var(--font-serif); font-weight: 600; font-size: 13px; }
  .wmood { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; }
  .wblurb { font-style: italic; font-size: 12px; }
  .wmech { font-size: 11px; opacity: 0.85; line-height: 1.35; }
  .go { padding: 12px; border-radius: 10px; background: var(--brass); color: var(--ink); font-weight: 700; font-size: 14px; }
  .go:disabled { background: rgba(201,164,92,0.25); color: var(--paper-shade); }
  .dim { color: var(--ink-soft); margin: 0; }
</style>
