/**
 * Browser-compatible EventEmitter replacement
 * 
 * Simple event emitter implementation that works in browser environments
 * without requiring Node.js's 'events' module.
 */

type EventHandler = (...args: any[]) => void;

export class EventEmitter {
  private events: Map<string, Set<EventHandler>> = new Map();

  /**
   * Register an event handler
   */
  on(event: string, handler: EventHandler): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(handler);
    return this;
  }

  /**
   * Register a one-time event handler
   */
  once(event: string, handler: EventHandler): this {
    const onceHandler: EventHandler = (...args) => {
      handler(...args);
      this.off(event, onceHandler);
    };
    return this.on(event, onceHandler);
  }

  /**
   * Unregister an event handler
   */
  off(event: string, handler: EventHandler): this {
    const handlers = this.events.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.events.delete(event);
      }
    }
    return this;
  }

  /**
   * Emit an event
   */
  emit(event: string, ...args: any[]): boolean {
    const handlers = this.events.get(event);
    if (!handlers || handlers.size === 0) {
      return false;
    }
    
    handlers.forEach(handler => {
      try {
        handler(...args);
      } catch (error) {
        console.error(`[EventEmitter] Error in handler for event "${event}":`, error);
      }
    });
    
    return true;
  }

  /**
   * Remove all handlers for an event, or all handlers if no event specified
   */
  removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: string): number {
    return this.events.get(event)?.size || 0;
  }
}
