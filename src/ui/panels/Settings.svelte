<script lang="ts">
  import type { GameHost } from '../host.svelte';
  let { host }: { host: GameHost } = $props();
  let exported = $state('');
  let importText = $state('');
  let importMsg = $state('');
</script>

<div class="settings">
  <label class="row"><span>Game</span>
    <select value={host.view.gameId} onchange={(e) => host.switchGame((e.currentTarget as HTMLSelectElement).value)}>
      {#each host.view.games as g (g.id)}<option value={g.id}>{g.name}</option>{/each}
    </select>
  </label>
  {#each host.view.gameOptions as o (o.option.id)}
    <label class="row"><span>{o.option.label}</span>
      <select value={o.value} onchange={(e) => host.setGameOption(o.option.id, (e.currentTarget as HTMLSelectElement).value)}>
        {#each o.option.values as v (v.value)}<option value={v.value}>{v.label}</option>{/each}
      </select>
    </label>
  {/each}
  <p class="hint">Rule changes apply to the next hand.</p>
  <label class="row"><span>Shuffle</span>
    <select value={host.view.settings.shuffleStyle} onchange={(e) => host.setSetting('shuffleStyle', (e.currentTarget as HTMLSelectElement).value as 'riffle' | 'overhand' | 'random')}>
      <option value="riffle">Riffle</option><option value="overhand">Overhand</option><option value="random">Whatever the dealer feels like</option>
    </select>
  </label>
  <label class="row"><span>Sound</span><input type="checkbox" checked={host.view.settings.sound} onchange={(e) => host.setSetting('sound', (e.currentTarget as HTMLInputElement).checked)} /></label>
  <label class="row"><span>Haptics</span><input type="checkbox" checked={host.view.settings.haptics} onchange={(e) => host.setSetting('haptics', (e.currentTarget as HTMLInputElement).checked)} /></label>
  <label class="row"><span>Reduced motion</span><input type="checkbox" checked={host.view.settings.reducedMotion} onchange={(e) => host.setSetting('reducedMotion', (e.currentTarget as HTMLInputElement).checked)} /></label>
  <label class="row"><span>Dealer waits</span>
    <span class="num">{host.view.settings.autoDealerDelaySeconds}s</span>
    <input type="range" min="3" max="60" step="1" value={host.view.settings.autoDealerDelaySeconds} oninput={(e) => host.setSetting('autoDealerDelaySeconds', Number((e.currentTarget as HTMLInputElement).value))} />
  </label>

  <div class="block">
    <label class="row"><span>Cloud save</span><input type="checkbox" checked={host.view.cloud.enabled} onchange={(e) => host.setCloud((e.currentTarget as HTMLInputElement).checked)} /></label>
    <p class="hint">{host.view.cloud.enabled ? host.view.cloud.status : 'Keeps a copy on the save server and restores the further-along one. Local storage stays the truth.'}</p>
  </div>
  <div class="block">
    <button class="link" onclick={() => (exported = host.exportSave())}>Export save</button>
    {#if exported}<textarea readonly rows="3" value={exported}></textarea>{/if}
  </div>
  <div class="block">
    <textarea rows="3" placeholder="Paste a save string" bind:value={importText}></textarea>
    <button class="link" onclick={() => { importMsg = host.importSave(importText.trim()) ? 'Imported.' : 'That did not look like a save.'; }}>Import</button>
    {#if importMsg}<span class="msg">{importMsg}</span>{/if}
  </div>
  <div class="block danger">
    <button class="link" onclick={() => { if (confirm('Start over? The deck will forget everything.')) void host.hardReset(); }}>Start over</button>
  </div>
</div>

<style>
  .settings { display: flex; flex-direction: column; gap: 12px; color: var(--paper-shade); font-size: 13px; }
  .row { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
  .row input[type='range'] { flex: 1; }
  select { background: rgba(0,0,0,0.25); color: var(--paper); border: 1px solid rgba(201,164,92,0.3); border-radius: 6px; padding: 4px 6px; font: inherit; }
  .hint { margin: -6px 0 0; font-size: 11px; color: var(--ink-soft); }
  .block { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid rgba(201,164,92,0.18); }
  textarea { width: 100%; font: 11px ui-monospace, monospace; background: rgba(0,0,0,0.25); color: var(--paper); border: 1px solid rgba(201,164,92,0.3); border-radius: 6px; padding: 6px; resize: vertical; }
  .link { align-self: flex-start; color: var(--brass); font-weight: 600; }
  .danger .link { color: var(--rouge); }
  .msg { color: var(--moss); }
</style>
