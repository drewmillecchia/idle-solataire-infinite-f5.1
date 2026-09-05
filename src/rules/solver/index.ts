/**
 * The solver layer. PURE TS — safe to import from a test, the sim, or a Web Worker.
 * `worker.ts` is deliberately NOT re-exported: it installs an `onmessage` handler on import.
 */
export * from './klondike';
