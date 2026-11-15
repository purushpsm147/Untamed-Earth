export type Listener<E> = (e: E) => void;
/** Minimal typed event bus. */
export class EventBus<E> {
  private listeners: Listener<E>[] = [];
  on(fn: Listener<E>): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
  emit(e: E): void {
    for (const l of this.listeners) l(e);
  }
}
