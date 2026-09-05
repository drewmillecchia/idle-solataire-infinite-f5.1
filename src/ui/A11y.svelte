<script lang="ts">
  /**
   * Off-canvas semantic layer for the table (docs/03-decisions.md ADR-003: the table is a canvas,
   * so accessibility is a separate layer, not the renderer). Visually hidden (clip, not
   * display:none) so it stays reachable by keyboard and assistive tech, and inert for pointer
   * users — see CLAUDE.md invariant #6 (events vs presenters) and #13 (components read the
   * `$state` view snapshot; this component is no exception).
   */
  import { onDestroy, onMount } from 'svelte';
  import type { GameHost } from './host.svelte';
  import { describeBoard, describeCard, describePile, pileLabel } from './a11yModel';
  import type { PileView } from '$rules/module';

  let { host }: { host: GameHost } = $props();

  interface Selection { pile: string; index: number; cardId: number; }
  interface Playable { index: number; cardId: number; autoTarget: string | null; }
  interface PileRow { pile: PileView; heading: string; summary: string; playables: Playable[]; }

  let selection = $state<Selection | null>(null);
  let status = $state('');
  let showShortcuts = $state(false);
  let boardDesc = $state('');

  // The description updates with every view revision (~10 Hz) but is throttled to at most once a
  // second so the live region doesn't chatter at a screen reader.
  let lastUpdate = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function applyDescription(): void {
    boardDesc = describeBoard(host.boardView, host.view.gameName);
    lastUpdate = Date.now();
  }

  $effect(() => {
    void host.view.revision;
    const elapsed = Date.now() - lastUpdate;
    if (lastUpdate === 0 || elapsed >= 1000) {
      applyDescription();
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(() => { pendingTimer = null; applyDescription(); }, 1000 - elapsed);
    }
  });

  let pileRows = $derived.by((): PileRow[] => {
    void host.view.revision;
    const view = host.boardView;
    const rows: PileRow[] = [];
    for (const pile of view.piles) {
      const playables: Playable[] = [];
      for (let i = 0; i < pile.cards.length; i++) {
        const card = pile.cards[i];
        if (!card || card.id === null) continue;
        if (!host.canPickUp(pile.id, i)) continue;
        playables.push({ index: i, cardId: card.id, autoTarget: host.autoTargetFor(pile.id, i) });
      }
      if (playables.length > 0) rows.push({ pile, heading: pileLabel(view, pile.id), summary: describePile(pile), playables });
    }
    return rows;
  });

  let targetOptions = $derived.by((): { id: string; label: string }[] => {
    if (!selection) return [];
    void host.view.revision;
    const view = host.boardView;
    return host.legalTargets(selection.pile, selection.index).map((id) => ({ id, label: pileLabel(view, id) }));
  });

  function selectCard(pileId: string, index: number, cardId: number): void {
    selection = { pile: pileId, index, cardId };
  }
  function cancelSelection(): void {
    selection = null;
  }
  function moveTo(target: string): void {
    if (!selection) return;
    const cardName = describeCard(selection.cardId);
    const toLabel = pileLabel(host.boardView, target).toLowerCase();
    const ok = host.tryMove(selection.pile, selection.index, target);
    status = ok ? `Moved ${cardName} to ${toLabel}.` : 'That move is not legal.';
    selection = null;
  }
  function playHome(pileId: string, index: number, cardId: number): void {
    const cardName = describeCard(cardId);
    const ok = host.tap(pileId, index);
    status = ok ? `Played ${cardName} home.` : 'That move is not legal.';
  }
  function onDraw(): void {
    selection = null;
    const ok = host.tap('stock', 0);
    status = ok ? 'Drew from the stock.' : 'The stock has nothing to draw.';
  }
  function onUndo(): void {
    selection = null;
    if (!host.view.canUndo) { status = 'Nothing to undo.'; return; }
    host.undo();
    status = 'Move undone.';
  }
  function onNewHand(): void {
    selection = null;
    host.newHand();
    status = 'New hand dealt.';
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  /** Global shortcuts, but only when focus isn't in a field and no modifier is held — never
   *  compete with browser/OS chords, and never touch keys we don't explicitly bind. */
  function onWindowKeydown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    switch (e.key) {
      case 'n': case 'N': onNewHand(); break;
      case 'u': case 'U': onUndo(); break;
      case 'd': case 'D': onDraw(); break;
      case ' ': onDraw(); e.preventDefault(); break;
      case '?': showShortcuts = !showShortcuts; break;
      case 'Escape': if (selection) { cancelSelection(); e.preventDefault(); } break;
      default: return;
    }
  }

  function onRegionKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && selection) { cancelSelection(); e.preventDefault(); }
  }

  onMount(() => {
    window.addEventListener('keydown', onWindowKeydown);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onWindowKeydown);
    if (pendingTimer) clearTimeout(pendingTimer);
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- The region itself isn't interactive; this only catches Escape bubbling up from its buttons
     to cancel a selected move, same as a dialog's Escape-to-close. -->
<div class="sr-only" role="region" aria-label="Card table controls" onkeydown={onRegionKeydown}>
  <h2 id="a11y-card-table" tabindex="-1">Card table</h2>

  <div class="controls">
    <button type="button" onclick={onDraw}>Draw from stock</button>
    <button type="button" onclick={onUndo} disabled={!host.view.canUndo}>Undo</button>
    <button type="button" onclick={onNewHand}>New hand</button>
    <button type="button" aria-pressed={showShortcuts} onclick={() => (showShortcuts = !showShortcuts)}>
      {showShortcuts ? 'Hide keyboard shortcuts' : 'Show keyboard shortcuts'}
    </button>
  </div>

  {#if showShortcuts}
    <ul>
      <li>N — new hand</li>
      <li>U — undo</li>
      <li>D or Space — draw from stock</li>
      <li>? — toggle this list</li>
      <li>Escape — cancel a selected move</li>
    </ul>
  {/if}

  <p aria-live="polite">{boardDesc}</p>
  <p aria-live="polite">{status}</p>

  {#if selection}
    <p>Selected: {describeCard(selection.cardId)} from {pileLabel(host.boardView, selection.pile)}.</p>
    <ul>
      {#each targetOptions as t (t.id)}
        <li><button type="button" onclick={() => moveTo(t.id)}>Move to {t.label.toLowerCase()}</button></li>
      {/each}
    </ul>
    <button type="button" onclick={cancelSelection}>Cancel</button>
  {:else}
    <ul>
      {#each pileRows as row (row.pile.id)}
        <li>
          <h3>{row.heading}</h3>
          <p>{row.summary}</p>
          <ul>
            {#each row.playables as pc (pc.index)}
              <li>
                <button type="button" onclick={() => selectCard(row.pile.id, pc.index, pc.cardId)}>
                  Move {describeCard(pc.cardId)} from {row.heading.toLowerCase()}
                </button>
                {#if pc.autoTarget}
                  <button type="button" onclick={() => playHome(row.pile.id, pc.index, pc.cardId)}>
                    Play {describeCard(pc.cardId)} home
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Reachable by keyboard and assistive tech, invisible and inert to pointer users: clip, not
     display:none. See docs/09-art-direction.md — this layer introduces no visual change of its
     own; the skip link (App.svelte) is the only thing that becomes visible, on focus. */
  .sr-only {
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
</style>
