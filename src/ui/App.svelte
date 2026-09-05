<script lang="ts">
  import { onMount } from 'svelte';
  import { GameHost } from './host.svelte';
  import { Table } from '../table/Table';
  import Hud from './Hud.svelte';
  import Rail from './Rail.svelte';
  import Footer from './Footer.svelte';
  import Toasts from './Toasts.svelte';

  const host = new GameHost();
  let feltEl: HTMLDivElement;
  let table: Table | null = null;
  let booted = $state(false);

  onMount(() => {
    (async () => {
      await host.boot();
      table = new Table(host, $state.snapshot(host.feel));
      await table.mount(feltEl);
      host.attachTable(table);
      booted = true;
      if (import.meta.env.DEV || location.search.includes('test')) {
        (window as unknown as { __game: GameHost; __table: Table }).__game = host;
        (window as unknown as { __game: GameHost; __table: Table }).__table = table;
      }
    })();
    return () => { host.destroy(); table?.destroy(); };
  });
</script>

<div class="app">
  <Hud {host} />
  <main class="stage">
    <div class="felt" bind:this={feltEl}></div>
    {#if host.view.offline}
      <div class="offline">
        <p class="num">While you were away, the deck counted {host.view.offline.earned} arrangements.</p>
        <button onclick={() => host.dismissOffline()}>Noted</button>
      </div>
    {/if}
    {#if host.view.wonBanner}
      <div class="won">
        <p class="won-title">Hand won.</p>
        <p class="num won-burst">{host.view.wonBanner.burst} shuffles</p>
        <button onclick={() => host.newHand()}>Deal again</button>
      </div>
    {/if}
    <Toasts toasts={host.view.toasts} />
  </main>
  <Rail {host} />
  <Footer {host} />
</div>

<style>
  .app {
    height: 100%;
    display: grid;
    grid-template-columns: 1fr var(--rail-w);
    grid-template-rows: var(--hud-h) 1fr var(--footer-h);
    grid-template-areas: 'hud hud' 'stage rail' 'footer footer';
    padding: var(--sai-t) var(--sai-r) var(--sai-b) var(--sai-l);
    background: var(--felt-deep);
  }
  .stage { grid-area: stage; position: relative; min-width: 0; min-height: 0; }
  .felt { position: absolute; inset: 0; }
  .offline {
    position: absolute; left: 50%; top: 14px; transform: translateX(-50%);
    background: var(--paper); color: var(--ink); padding: 10px 14px; border-radius: var(--radius);
    display: flex; gap: 12px; align-items: center; box-shadow: var(--shadow); max-width: 80%;
  }
  .offline p { margin: 0; }
  .won {
    position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%);
    background: var(--paper); color: var(--ink); padding: 18px 26px; border-radius: var(--radius);
    box-shadow: var(--shadow); text-align: center; pointer-events: none; animation: rise 0.5s ease-out;
    border: 1px solid var(--brass);
  }
  .won button { pointer-events: auto; margin-top: 10px; padding: 8px 16px; border-radius: 8px; background: var(--brass); color: var(--ink); font-weight: 600; }
  .won-title { margin: 0; font-family: var(--font-serif); font-size: 22px; }
  .won-burst { margin: 4px 0 0; color: var(--brass-dim); font-size: 16px; }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, -40%); } to { opacity: 1; transform: translate(-50%, -50%); } }
  .offline button { color: var(--brass-dim); font-weight: 600; }
  @media (max-width: 1000px) {
    .app { grid-template-columns: 1fr 56px; }
  }
</style>
