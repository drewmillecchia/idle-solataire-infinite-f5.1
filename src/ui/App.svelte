<script lang="ts">
  import { onMount } from 'svelte';
  import { GameHost } from './host.svelte';
  import { Table } from '../table/Table';
  import Hud from './Hud.svelte';
  import Rail from './Rail.svelte';
  import Footer from './Footer.svelte';
  import Toasts from './Toasts.svelte';
  import A11y from './A11y.svelte';

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

<a class="skip-link" href="#a11y-card-table">Skip to card table controls</a>
<div class="app">
  <A11y {host} />
  <Hud {host} />
  <main class="stage">
    <div class="felt" bind:this={feltEl}></div>
    {#if host.view.offline}
      <div class="offline">
        <p class="num">While you were away, the deck counted {host.view.offline.earned} arrangements.</p>
        <button onclick={() => host.dismissOffline()}>Noted</button>
      </div>
    {/if}
    {#if host.view.storageWarning}
      <div class="offline warn"><p>This browser is not keeping the save. Export it from Settings to be safe.</p></div>
    {/if}
    {#if host.view.firstRun}
      <button class="note" onclick={() => host.dismissFirstRun()} aria-label="Dismiss the Keeper's note">
        <p class="note-body">Play a card home and it wakes.</p>
        <p class="note-body">A woken card counts arrangements for you from then on, awake or not.</p>
        <p class="note-sign">There are fifty-two. — K.</p>
      </button>
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
  /* Visually hidden until focused (Tab from page load lands here first), then visible top-left
     in Night Desk colours — the one visual change a keyboard user sees; a mouse/touch player
     never focuses it. See docs/09-art-direction.md for the palette. */
  .skip-link {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .skip-link:focus {
    position: fixed;
    top: 10px;
    left: 10px;
    width: auto;
    height: auto;
    margin: 0;
    padding: 10px 16px;
    clip: auto;
    overflow: visible;
    white-space: normal;
    z-index: 1000;
    background: var(--paper);
    color: var(--ink);
    border: 2px solid var(--brass);
    border-radius: var(--radius);
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    box-shadow: var(--shadow);
  }
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
  .warn { top: auto; bottom: 14px; background: var(--rouge); color: var(--paper); }
  .note {
    position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%) rotate(-0.6deg);
    background: var(--paper); color: var(--ink); padding: 14px 20px; border-radius: 3px;
    box-shadow: var(--shadow); max-width: 420px; text-align: left; cursor: pointer;
    font-family: var(--font-serif); border-left: 3px solid var(--brass);
    animation: settle 0.6s cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  .note-body { margin: 0 0 6px; font-size: 15px; line-height: 1.45; }
  .note-sign { margin: 8px 0 0; font-size: 13px; color: var(--ink-soft); font-style: italic; }
  @keyframes settle {
    from { opacity: 0; transform: translateX(-50%) rotate(-3deg) translateY(18px); }
    to { opacity: 1; transform: translateX(-50%) rotate(-0.6deg) translateY(0); }
  }
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
