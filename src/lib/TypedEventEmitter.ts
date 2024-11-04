export type EventMap = {
  [key: string]: unknown;
};

export type EventListener<D> = (data: D) => void;

abstract class TypedEventEmitter<E extends EventMap> {
  protected listeners: { [K in keyof E]?: EventListener<E[K]>[] } = {};

  /**
   * Add an event listener, returns a function that can be called to remove the listener
   * @param event
   * @param listener
   */
  on<T extends keyof E>(event: T, listener: EventListener<E[T]>) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(listener);
    return () => {
      this.off(event, listener);
    };
  }

  /**
   * Remove an event listener
   * @param event
   * @param listener
   */
  off<T extends keyof E>(event: T, listener: EventListener<E[T]>) {
    if (!this.listeners[event]) {
      return;
    }
    this.listeners[event] = this.listeners[event]!.filter((l) => l !== listener);
  }

  /**
   * Dispatch an event to all listeners
   * @param event
   * @param data
   */
  emit<T extends keyof E>(event: T, data: E[T]) {
    const listeners = this.listeners[event];
    if (!listeners) {
      return;
    }
    listeners.forEach((listener) => listener(data));
  }
}

export default TypedEventEmitter;
