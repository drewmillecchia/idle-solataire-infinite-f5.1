import type { GameEvent, EventListener } from './types';

/** Tiny synchronous bus. Listeners must not throw; a throwing listener is logged and dropped for that event. */
export class EventBus {
  private listeners = new Set<EventListener>();
  on(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e: GameEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error('[events] listener failed on', e.type, err);
      }
    }
  }
  clear(): void {
    this.listeners.clear();
  }
}
