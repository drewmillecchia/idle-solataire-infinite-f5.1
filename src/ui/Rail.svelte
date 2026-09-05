<script lang="ts">
  import type { GameHost } from './host.svelte';
  import Upgrades from './panels/Upgrades.svelte';
  import Ledger from './panels/Ledger.svelte';
  import Settings from './panels/Settings.svelte';
  import FeelLab from './panels/FeelLab.svelte';
  let { host }: { host: GameHost } = $props();
  type Tab = 'upgrades' | 'ledger' | 'settings' | 'feel';
  let tab: Tab = $state('upgrades');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'upgrades', label: 'Upgrades' },
    { id: 'ledger', label: 'Ledger' },
    { id: 'settings', label: 'Settings' },
    { id: 'feel', label: 'Feel' }
  ];
</script>

<aside class="rail">
  <nav class="tabs">
    {#each tabs as t (t.id)}
      <button class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
    {/each}
  </nav>
  <div class="panel">
    {#if tab === 'upgrades'}<Upgrades {host} />
    {:else if tab === 'ledger'}<Ledger {host} />
    {:else if tab === 'settings'}<Settings {host} />
    {:else}<FeelLab {host} />{/if}
  </div>
</aside>

<style>
  .rail { grid-area: rail; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid rgba(201,164,92,0.18); background: #182d29; }
  .tabs { display: flex; border-bottom: 1px solid rgba(201,164,92,0.18); }
  .tabs button { flex: 1; padding: 10px 4px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--brass-dim); }
  .tabs button.active { color: var(--brass); box-shadow: inset 0 -2px 0 var(--brass); }
  .panel { flex: 1; overflow-y: auto; padding: 12px; min-height: 0; }
</style>
