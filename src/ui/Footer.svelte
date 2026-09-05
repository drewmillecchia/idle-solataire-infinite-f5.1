<script lang="ts">
  import type { GameHost } from './host.svelte';
  import HoldButton from './HoldButton.svelte';
  let { host }: { host: GameHost } = $props();
</script>

<footer class="footer">
  <div class="left">
    <span class="label">Witnessed</span>
    <span class="num">{host.view.lifetime}</span>
    <span class="dim">of 8.07e67</span>
  </div>
  <div class="mid">
    {#if host.view.won}<span class="won">Hand won.</span>{:else if host.view.stuck}<span class="dim">Nothing moves.</span>{/if}
    {#if host.view.dealerUnlocked}
      <span class="dealer" class:active={host.view.dealerActive}>
        {host.view.dealerActive ? 'The dealer is playing' : `Dealer in ${Math.ceil(host.view.dealerCountdown)}s`}
      </span>
    {/if}
  </div>
  <div class="right">
    <HoldButton label="Undo" disabled={!host.view.canUndo} feel={host.feel} onpress={() => host.undo()} />
    <HoldButton label="New hand" primary feel={host.feel} onpress={() => host.newHand()} />
  </div>
</footer>

<style>
  .footer { grid-area: footer; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; gap: 12px; border-top: 1px solid rgba(201,164,92,0.18); background: var(--felt-deep); }
  .left { display: flex; gap: 8px; align-items: baseline; color: var(--brass); }
  .label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--brass-dim); }
  .dim { color: var(--ink-soft); font-size: 12px; }
  .mid { display: flex; gap: 14px; color: var(--paper-shade); font-size: 13px; }
  .won { color: var(--lamp); }
  .dealer { color: var(--ink-soft); }
  .dealer.active { color: var(--moss); }
  .right { display: flex; gap: 10px; }
</style>
