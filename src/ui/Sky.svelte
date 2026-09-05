<script lang="ts">
  /**
   * The window (docs/09-art-direction.md). Stars appear as the journey toward 52! advances; at
   * intervals a constellation draws itself between stars already out, and near the end the moon
   * rises. Deterministic, so the same sky comes back on every load.
   *
   * The strip is much wider than it is tall, so the SVG is drawn in *pixel* space (viewBox measured
   * from the element). A normalised 0..100 box with preserveAspectRatio="none" would stretch every
   * star into an oval and flatten the constellations into scratches.
   */
  let { journey }: { journey: number } = $props();

  let w = $state(600);
  let h = $state(64);

  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  interface Star { nx: number; ny: number; r: number; at: number }
  const COUNT = 150;
  const STARS: Star[] = Array.from({ length: COUNT }, (_, i) => {
    const r = rng(1000 + i * 7919);
    return { nx: r(), ny: r(), r: 0.5 + r() * 1.1, at: i / COUNT };
  });

  const px = (s: Star) => ({ x: s.nx * w, y: s.ny * h });
  const visibleStars = $derived(STARS.filter((s) => s.at <= journey + 0.006));

  /** Nine constellations, each joining nearby stars that are already out. Edges are capped so a
      constellation reads as a cluster rather than a line across the whole window. */
  const lines = $derived.by(() => {
    const maxEdge = Math.max(28, Math.min(w, h) * 1.6);
    const out: string[] = [];
    for (let c = 0; c < 9; c++) {
      const at = (c + 1) / 10;
      if (journey < at) continue;
      const pool = STARS.filter((s) => s.at <= at);
      if (pool.length < 4) continue;
      const r = rng(90210 + c * 104729);
      let cur = pool[Math.floor(r() * pool.length)]!;
      const used = new Set<Star>([cur]);
      const pts = [px(cur)];
      const len = 3 + Math.floor(r() * 3);
      for (let k = 0; k < len; k++) {
        const from = px(cur);
        let best: Star | null = null;
        let bestD = Infinity;
        for (const s of pool) {
          if (used.has(s)) continue;
          const p = px(s);
          const d = Math.hypot(p.x - from.x, p.y - from.y);
          if (d < bestD && d > 6 && d < maxEdge) { bestD = d; best = s; }
        }
        if (!best) break;
        used.add(best);
        cur = best;
        pts.push(px(best));
      }
      if (pts.length >= 3) out.push(pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
    }
    return out;
  });

  const moon = $derived(Math.max(0, Math.min(1, (journey - 0.9) / 0.1)));
  const label = $derived(journey >= 1 ? 'Every arrangement' : `${visibleStars.length} of ${COUNT} stars`);
</script>

<div class="frame" bind:clientWidth={w} bind:clientHeight={h}>
  <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`The window: ${label}`}>
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0b141b" />
        <stop offset="1" stop-color="#17323b" />
      </linearGradient>
      <radialGradient id="moonglow">
        <stop offset="0" stop-color="#dfe9ff" stop-opacity="0.4" />
        <stop offset="1" stop-color="#dfe9ff" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width={w} height={h} fill="url(#sky)" />

    {#if moon > 0}
      <g style:opacity={moon}>
        <circle cx={w * 0.86} cy={h * (0.7 - moon * 0.36)} r={h * 0.55} fill="url(#moonglow)" />
        <circle cx={w * 0.86} cy={h * (0.7 - moon * 0.36)} r={h * 0.16} fill="#e8eeff" opacity="0.92" />
      </g>
    {/if}

    {#each lines as pts, i (i)}
      <polyline points={pts} fill="none" stroke="#dfe9ff" stroke-opacity="0.3" stroke-width="0.7" stroke-linejoin="round" />
    {/each}

    {#each visibleStars as s (s.at)}
      {@const p = px(s)}
      <circle cx={p.x} cy={p.y} r={s.r} fill="#dfe9ff" opacity={0.4 + s.r * 0.35} />
    {/each}

    <line x1={w / 2} y1="0" x2={w / 2} y2={h} stroke="#c9a45c" stroke-opacity="0.3" stroke-width="1" />
    <rect x="0.5" y="0.5" width={Math.max(0, w - 1)} height={Math.max(0, h - 1)} fill="none" stroke="#c9a45c" stroke-opacity="0.35" stroke-width="1" />
  </svg>
</div>

<style>
  .frame { width: 100%; height: 100%; }
  svg { display: block; width: 100%; height: 100%; border-radius: 4px; }
</style>
