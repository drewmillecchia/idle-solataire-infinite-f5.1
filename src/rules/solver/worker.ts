/// <reference lib="webworker" />
/**
 * Web Worker entry for the Klondike solver: the Scholar's "always winnable" deal, off the main
 * thread. Dependency-free and DOM-free — it only talks in messages.
 *
 * Post `{ id, seed, config?, opts? }`; get back `{ id, seed, tries, nodes, ms, line }` where `seed`
 * is null when no winnable deal was proven inside the budget (the caller should fall back to the
 * plain seeded deal rather than block the player).
 *
 * The scope is typed with a hand-written minimal interface rather than `DedicatedWorkerGlobalScope`:
 * the root tsconfig ships lib DOM, and pulling in lib.webworker alongside it collides on hundreds of
 * shared globals. `self` is declared at module scope, which shadows DOM's `Window` binding here only.
 */
import { findWinnableSeed, type SolverMove } from './klondike';
import type { GameConfig } from '../module';

export interface SolverRequest {
  id: number;
  seed: number;
  config?: GameConfig;
  opts?: { maxTries?: number; budgetNodes?: number; maxDepth?: number };
}

export interface SolverResponse {
  id: number;
  /** The proven-winnable seed, or null when none was found inside the budget. */
  seed: number | null;
  tries: number;
  nodes: number;
  ms: number;
  line: SolverMove[];
}

interface SolverWorkerScope {
  onmessage: ((event: { data: SolverRequest }) => void) | null;
  postMessage(message: SolverResponse): void;
}
declare const self: SolverWorkerScope;

/** Exported so a test can drive the handler without a real worker. */
export function handle(req: SolverRequest): SolverResponse {
  const started = Date.now();
  const found = findWinnableSeed(req.seed, req.config, req.opts);
  return {
    id: req.id,
    seed: found ? found.seed : null,
    tries: found ? found.tries : (req.opts?.maxTries ?? 25),
    nodes: found ? found.nodes : 0,
    ms: Date.now() - started,
    line: found ? found.line : []
  };
}

if (typeof self !== 'undefined' && self !== null) {
  self.onmessage = (event) => {
    self.postMessage(handle(event.data));
  };
}
