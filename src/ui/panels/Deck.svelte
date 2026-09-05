<script lang="ts">
  /** The deck spread: every card's generator state at a glance. Mark placement arrives with M4. */
  import type { GameHost } from '../host.svelte';
  import { SUITS, RANKS, cardId, isRed } from '$engine/types';
  let { host }: { host: GameHost } = $props();
  const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
</script>

<div class="deck">
  <p class="lede">{host.view.awake} of 52 awake. A card earns nothing until it has come home once; every time after adds a charge.</p>
  {#each SUITS as suit (suit)}
    <div class="suit">
      <span class="suitmark" class:red={isRed(suit)}>{SUIT_GLYPH[suit]}</span>
      <div class="cards">
        {#each RANKS as rank (rank)}
          {@const c = host.view.deck[cardId(suit, rank)]}
          <button class="card" class:awake={c?.awake} class:red={isRed(suit)} class:selected={host.view.deck[cardId(suit, rank)]?.selected}
            onclick={() => host.tapDeckCard(cardId(suit, rank))} title={`${RANK_LABEL[rank - 1]}${SUIT_GLYPH[suit]} · ${c?.awake ? `awake, charge ${c.charge}` : 'asleep'}`}>
            <span class="r">{RANK_LABEL[rank - 1]}</span>
            {#if c?.glyph}<span class="g">{c.glyph}</span>{/if}
            {#if c?.awake}<span class="ticks">{#each Array(Math.min(5, c.charge)) as _, i (i)}<i></i>{/each}{#if c.charge > 5}<b>{c.charge}</b>{/if}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .deck { color: var(--paper-shade); font-size: 12px; }
  .lede { margin: 0 0 8px; color: var(--ink-soft); line-height: 1.5; }
  .suit { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .suitmark { width: 14px; color: var(--paper); font-size: 14px; }
  .suitmark.red { color: #d9756c; }
  .cards { display: grid; grid-template-columns: repeat(13, 1fr); gap: 2px; flex: 1; }
  .card { position: relative; aspect-ratio: 0.7; border-radius: 3px; background: rgba(244,234,216,0.12); border: 1px solid rgba(244,234,216,0.15); color: var(--paper-shade); font-family: var(--font-serif); font-size: 10px; display: flex; align-items: flex-start; justify-content: flex-start; padding: 1px 2px; opacity: 0.55; }
  .card.awake { background: var(--paper); color: var(--ink); opacity: 1; border-color: var(--brass); }
  .card.awake.red { color: var(--rouge); }
  .card.selected { outline: 2px solid var(--lamp); }
  .r { line-height: 1; }
  .g { position: absolute; right: 1px; top: 0; font-size: 9px; color: var(--ink); }
  .ticks { position: absolute; left: 2px; right: 2px; bottom: 2px; display: flex; gap: 1px; align-items: flex-end; }
  .ticks i { flex: 1; height: 2px; background: var(--brass); border-radius: 1px; }
  .ticks b { font-size: 8px; color: var(--brass-dim); font-weight: 600; margin-left: 2px; }
</style>
