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
  {#if host.view.marks.available.length}
    {@const m = host.view.marks}
    <div class="marks">
      <p class="head">Marks <span class="num slots">{m.used}/{m.slots} slots</span></p>
      <p class="hint">{m.picking ? (m.available.find((x) => x.id === m.picking)?.arity === 2 ? 'Pick two cards below, then place.' : 'Pick a card below, then place.') : 'Choose a Mark, then the card that will carry it. Free to move between hands.'}</p>
      <div class="list">
        {#each m.available as mk (mk.id)}
          <button class="mark" class:picking={m.picking === mk.id} onclick={() => host.pickMark(mk.id)} title={mk.rule}>
            <span class="glyph">{mk.glyph}</span>
            <span class="mname">{mk.name}</span>
            {#if mk.placed}<span class="num count">×{mk.placed}</span>{/if}
          </button>
        {/each}
      </div>
      {#if m.picking}
        <p class="rule">{m.available.find((x) => x.id === m.picking)?.rule}</p>
        <div class="row">
          <button class="place" disabled={!m.canPlace} onclick={() => host.placePickedMark()}>Place</button>
          <button class="link" onclick={() => host.pickMark(null)}>Cancel</button>
        </div>
      {/if}
      {#if m.placed.length}
        <ul class="placed">
          {#each m.placed as p, i (i)}
            <li><span class="glyph">{p.glyph}</span> {p.name} on {p.cards.map((c) => (RANK_LABEL[c % 13] ?? '') + (SUIT_GLYPH[SUITS[Math.floor(c / 13)] ?? 'S'] ?? '')).join(' & ')}
              <button class="link" onclick={() => host.unplaceMark(p.id, p.cards[0] ?? 0)}>remove</button></li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
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
  .marks { background: rgba(244,234,216,0.06); border: 1px solid rgba(201,164,92,0.22); border-radius: var(--radius); padding: 8px 10px; margin-bottom: 10px; }
  .head { margin: 0 0 4px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brass-dim); display: flex; justify-content: space-between; }
  .slots { color: var(--brass); letter-spacing: 0; text-transform: none; }
  .hint { margin: 0 0 6px; font-size: 11px; color: var(--ink-soft); line-height: 1.4; }
  .list { display: flex; flex-wrap: wrap; gap: 4px; }
  .mark { display: flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 14px; background: rgba(244,234,216,0.08); border: 1px solid rgba(201,164,92,0.3); color: var(--paper-shade); font-size: 11px; }
  .mark.picking { background: var(--paper); color: var(--ink); border-color: var(--brass); }
  .glyph { font-family: var(--font-serif); font-size: 14px; line-height: 1; }
  .count { color: var(--brass-dim); }
  .rule { margin: 8px 0 6px; font-size: 12px; line-height: 1.4; color: var(--paper); font-style: italic; }
  .row { display: flex; gap: 12px; align-items: center; }
  .place { padding: 5px 12px; border-radius: 6px; background: var(--brass); color: var(--ink); font-weight: 600; font-size: 12px; }
  .place:disabled { background: rgba(201,164,92,0.2); color: var(--paper-shade); }
  .link { color: var(--brass); font-size: 11px; }
  .placed { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
  .placed li { display: flex; gap: 6px; align-items: center; }
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
