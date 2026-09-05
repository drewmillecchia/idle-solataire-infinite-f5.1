<script lang="ts">
  // The window: stars fill in as the journey toward 52! progresses. Deterministic star field.
  let { journey }: { journey: number } = $props();
  // mulberry32 per star so consecutive stars are uncorrelated (an LCG here drew a diagonal line).
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const STARS = Array.from({ length: 140 }, (_, i) => {
    const r = rng(1000 + i * 7919);
    return { x: r() * 100, y: r() * 100, s: 0.6 + r() * 1.4, o: i / 140 };
  });
  const visible = $derived(STARS.filter((s) => s.o <= journey + 0.02));
</script>

<svg class="window" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f1a22" /><stop offset="1" stop-color="#16313a" />
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#sky)" />
  {#each visible as s (s.x + s.y)}
    <circle cx={s.x} cy={s.y} r={s.s * 0.5} fill="#dfe9ff" opacity={0.5 + s.s * 0.25} />
  {/each}
  <rect x="0.5" y="0.5" width="99" height="99" fill="none" stroke="#c9a45c" stroke-opacity="0.35" />
  <line x1="50" y1="0" x2="50" y2="100" stroke="#c9a45c" stroke-opacity="0.35" />
</svg>

<style>
  .window { width: 100%; height: 100%; display: block; border-radius: 4px; }
</style>
