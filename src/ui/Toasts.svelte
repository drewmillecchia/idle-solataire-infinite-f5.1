<script lang="ts">
  let { toasts }: { toasts: { id: number; text: string }[] } = $props();
</script>

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast">{t.text}</div>
  {/each}
</div>

<style>
  .toasts { position: absolute; left: 16px; bottom: 12px; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
  .toast { background: rgba(244,234,216,0.92); color: var(--ink); padding: 6px 10px; border-radius: 6px; font-size: 13px; box-shadow: var(--shadow); animation: in 0.25s ease-out; }
  @keyframes in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
</style>
