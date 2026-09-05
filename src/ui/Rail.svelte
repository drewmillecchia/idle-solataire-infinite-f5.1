<script lang="ts">
  import type { GameHost } from './host.svelte';
  import Upgrades from './panels/Upgrades.svelte';
  import Ledger from './panels/Ledger.svelte';
  import Settings from './panels/Settings.svelte';
  import FeelLab from './panels/FeelLab.svelte';
  import Cut from './panels/Cut.svelte';
  import Constellation from './panels/Constellation.svelte';
  import Deck from './panels/Deck.svelte';
  import Permute from './panels/Permute.svelte';
  let { host }: { host: GameHost } = $props();
  type Tab = 'upgrades' | 'deck' | 'cut' | 'stars' | 'permute' | 'ledger' | 'settings' | 'feel';
  let tab: Tab = $state('upgrades');
  let winW = $state(1200);
  let open = $state(false);
  /** Below this the rail cannot be a column and still be readable, so it slides over the felt. */
  const narrow = $derived(winW < 1000);
  const tabs = $derived.by((): { id: Tab; label: string; glow?: boolean }[] => {
    const t: { id: Tab; label: string; glow?: boolean }[] = [{ id: 'upgrades', label: 'Upgrades' }, { id: 'deck', label: 'Deck' }];
    if (host.view.cut.revealed) {
      t.push({ id: 'cut', label: 'Cut', glow: host.view.cut.canCut });
      t.push({ id: 'stars', label: 'Stars' });
    }
    if (host.view.reshuffle.revealed) t.push({ id: 'permute', label: 'Permute', glow: host.view.reshuffle.can });
    t.push({ id: 'ledger', label: 'Ledger' }, { id: 'settings', label: 'Settings' }, { id: 'feel', label: 'Feel' });
    return t;
  });
</script>

<svelte:window bind:innerWidth={winW} />

{#if narrow}
  <button class="handle" class:open onclick={() => (open = !open)} aria-expanded={open} aria-controls="rail">
    <span class="handle-mark">{open ? '›' : '‹'}</span>
  </button>
  {#if open}
    <button class="scrim" aria-label="Close the panel" onclick={() => (open = false)}></button>
  {/if}
{/if}

<aside class="rail" id="rail" class:narrow class:open>
  <nav class="tabs">
    {#each tabs as t (t.id)}
      <button class:active={tab === t.id} class:glow={t.glow} onclick={() => (tab = t.id)}>{t.label}</button>
    {/each}
  </nav>
  <div class="panel">
    {#if tab === 'upgrades'}<Upgrades {host} />
    {:else if tab === 'deck'}<Deck {host} />
    {:else if tab === 'cut'}<Cut {host} />
    {:else if tab === 'stars'}<Constellation {host} />
    {:else if tab === 'permute'}<Permute {host} />
    {:else if tab === 'ledger'}<Ledger {host} />
    {:else if tab === 'settings'}<Settings {host} />
    {:else}<FeelLab {host} />{/if}
  </div>
</aside>

<style>
  .rail { grid-area: rail; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid rgba(201,164,92,0.18); background: #182d29; }

  /* Narrow: the rail leaves the grid and slides in over the felt. */
  .rail.narrow {
    position: fixed; z-index: 40;
    top: calc(var(--hud-h) + var(--sai-t)); bottom: calc(var(--footer-h) + var(--sai-b));
    right: 0; width: min(320px, 86vw);
    transform: translateX(100%);
    transition: transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
    box-shadow: -12px 0 32px rgba(0, 0, 0, 0.45);
  }
  .rail.narrow.open { transform: translateX(0); }

  .handle {
    position: fixed; z-index: 41; right: 0; top: 50%; transform: translateY(-50%);
    width: 26px; height: 84px; border-radius: 8px 0 0 8px;
    background: #182d29; border: 1px solid rgba(201,164,92,0.35); border-right: 0;
    color: var(--brass); font-size: 16px; line-height: 1;
    transition: right 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  .handle.open { right: min(320px, 86vw); }
  .handle-mark { display: block; }
  .scrim { position: fixed; z-index: 39; inset: 0; background: rgba(15, 26, 34, 0.4); border: 0; }
  .tabs { display: flex; flex-wrap: wrap; border-bottom: 1px solid rgba(201,164,92,0.18); }
  /* Four per row, so the row stays stable as Cut, Stars and Permute reveal themselves. */
  .tabs button { flex: 1 0 25%; padding: 9px 2px; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--brass-dim); }
  .tabs button.active { color: var(--brass); box-shadow: inset 0 -2px 0 var(--brass); }
  .tabs button.glow { color: var(--lamp); text-shadow: 0 0 8px rgba(255,217,160,0.6); }
  .panel { flex: 1; overflow-y: auto; padding: 12px; min-height: 0; }
</style>
