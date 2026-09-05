<script lang="ts">
  import type { GameHost } from './host.svelte';
  import HoldButton from './HoldButton.svelte';
  let { host }: { host: GameHost } = $props();
  let picking = $state(false);
  function choose(id: string): void {
    picking = false;
    if (id !== host.view.gameId) host.switchGame(id);
  }
</script>

<footer class="footer">
  <div class="left">
    <div class="picker">
      <button class="game" onclick={() => (picking = !picking)} aria-expanded={picking} aria-haspopup="listbox">
        {host.view.gameName}<span class="caret">▾</span>
      </button>
      {#if picking}
        <ul class="menu" role="listbox" aria-label="Choose a game">
          {#each host.view.games as g (g.id)}
            <li>
              <button class:current={g.id === host.view.gameId} role="option" aria-selected={g.id === host.view.gameId} onclick={() => choose(g.id)}>
                <span class="gname">{g.name}</span>
                <span class="gblurb">{g.blurb}</span>
                {#if g.hands > 0}
                  <span class="num grec">{g.wins} won of {g.hands}{#if g.best}{' · best ' + g.best}{/if}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <span class="label">Arrangement</span>
    <span class="num" title="Your position among the 52! orderings of the deck">{host.view.odometer}</span>
    <span class="dim">of 8.07e67</span>
  </div>
  <div class="mid">
    {#if host.view.scholarThinking}<span class="dim">The Scholar is choosing a deal that can be won.</span>
    {:else if host.view.won}<span class="won">Hand won.</span>
    {:else if host.view.stuck}<span class="dim">Nothing moves.</span>{/if}
    {#if host.view.dealerUnlocked}
      <span class="dealer" class:active={host.view.dealerActive}>
        {host.view.dealerActive ? 'The dealer is playing' : `Dealer in ${Math.ceil(host.view.dealerCountdown)}s`}
      </span>
    {/if}
  </div>
  <div class="right">
    <HoldButton label="Hint" disabled={host.view.won} feel={host.feel} onpress={() => host.hint()} />
    <HoldButton label="Undo" disabled={!host.view.canUndo} feel={host.feel} onpress={() => host.undo()} />
    <HoldButton label="New hand" primary disabled={host.view.cut.cutting} feel={host.feel} onpress={() => host.newHand()} />
  </div>
</footer>

<style>
  .footer { grid-area: footer; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; gap: 12px; border-top: 1px solid rgba(201,164,92,0.18); background: var(--felt-deep); }
  .left { display: flex; gap: 10px; align-items: baseline; color: var(--brass); }
  .label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--brass-dim); }
  .dim { color: var(--ink-soft); font-size: 12px; }
  .mid { display: flex; gap: 14px; color: var(--paper-shade); font-size: 13px; }
  .won { color: var(--lamp); }
  .dealer { color: var(--ink-soft); }
  .dealer.active { color: var(--moss); }
  .right { display: flex; gap: 10px; }

  .picker { position: relative; }
  .game { font-family: var(--font-serif); font-size: 14px; color: var(--paper); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(201,164,92,0.3); }
  .caret { color: var(--brass-dim); margin-left: 6px; font-size: 10px; }
  .menu {
    position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 30; margin: 0; padding: 6px;
    list-style: none; width: 280px; background: var(--paper); color: var(--ink);
    border-radius: var(--radius); box-shadow: var(--shadow);
  }
  .menu button { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 7px 9px; border-radius: 6px; }
  .menu button:hover, .menu button:focus-visible { background: var(--paper-shade); }
  .menu button.current { box-shadow: inset 0 0 0 1px var(--brass); }
  .gname { font-family: var(--font-serif); font-weight: 600; font-size: 14px; }
  .gblurb { font-size: 11px; color: var(--ink-soft); line-height: 1.35; }
  .grec { font-size: 11px; color: var(--brass-dim); margin-top: 2px; }
</style>
