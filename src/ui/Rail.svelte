<script lang="ts">
  import type { GameHost } from './host.svelte';
  import Upgrades from './panels/Upgrades.svelte';
  import Ledger from './panels/Ledger.svelte';
  import Settings from './panels/Settings.svelte';
  import FeelLab from './panels/FeelLab.svelte';
  import Cut from './panels/Cut.svelte';
  import Constellation from './panels/Constellation.svelte';
  import Deck from './panels/Deck.svelte';
  let { host }: { host: GameHost } = $props();
  type Tab = 'upgrades' | 'deck' | 'cut' | 'stars' | 'ledger' | 'settings' | 'feel';
  let tab: Tab = $state('upgrades');
  const tabs = $derived.by((): { id: Tab; label: string; glow?: boolean }[] => {
    const t: { id: Tab; label: string; glow?: boolean }[] = [{ id: 'upgrades', label: 'Upgrades' }, { id: 'deck', label: 'Deck' }];
    if (host.view.cut.revealed) {
      t.push({ id: 'cut', label: 'Cut', glow: host.view.cut.canCut });
      t.push({ id: 'stars', label: 'Stars' });
    }
    t.push({ id: 'ledger', label: 'Ledger' }, { id: 'settings', label: 'Settings' }, { id: 'feel', label: 'Feel' });
    return t;
  });
</script>

<aside class="rail">
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
    {:else if tab === 'ledger'}<Ledger {host} />
    {:else if tab === 'settings'}<Settings {host} />
    {:else}<FeelLab {host} />{/if}
  </div>
</aside>

<style>
  .rail { grid-area: rail; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid rgba(201,164,92,0.18); background: #182d29; }
  .tabs { display: flex; flex-wrap: wrap; border-bottom: 1px solid rgba(201,164,92,0.18); }
  .tabs button { flex: 1 0 auto; min-width: 60px; padding: 10px 6px; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--brass-dim); }
  .tabs button.active { color: var(--brass); box-shadow: inset 0 -2px 0 var(--brass); }
  .tabs button.glow { color: var(--lamp); text-shadow: 0 0 8px rgba(255,217,160,0.6); }
  .panel { flex: 1; overflow-y: auto; padding: 12px; min-height: 0; }
</style>
