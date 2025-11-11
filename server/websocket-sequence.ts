// WebSocket Sequence ID Manager - Ensures monotonic message ordering
// Prevents state drift between server and client

/**
 * Manages monotonic sequence IDs for WebSocket messages
 * Each client connection gets its own sequence counter
 */
export class WebSocketSequenceManager {
  private globalSequence = 0;
  private clientSequences = new Map<string, number>();
  
  /**
   * Get the next global sequence ID
   * Used when broadcasting to all clients
   */
  getNextGlobalSequence(): number {
    return ++this.globalSequence;
  }
  
  /**
   * Get the next sequence ID for a specific client
   * @param clientId - Unique identifier for the client connection
   */
  getNextClientSequence(clientId: string): number {
    const current = this.clientSequences.get(clientId) || 0;
    const next = current + 1;
    this.clientSequences.set(clientId, next);
    return next;
  }
  
  /**
   * Reset sequence for a client (on disconnect/reconnect)
   * @param clientId - Unique identifier for the client connection
   */
  resetClientSequence(clientId: string): void {
    this.clientSequences.delete(clientId);
  }
  
  /**
   * Create a sequenced message for broadcasting
   * @param type - Message type (e.g., 'artwork.swap', 'fallback_enter')
   * @param data - Message payload
   */
  createSequencedMessage(type: string, data: any): any {
    const seq = this.getNextGlobalSequence();
    return {
      type,
      seq,
      ts: Date.now(),
      data
    };
  }
  
  /**
   * Create a sequenced message for a specific client
   * @param clientId - Unique identifier for the client
   * @param type - Message type
   * @param data - Message payload
   */
  createClientMessage(clientId: string, type: string, data: any): any {
    const seq = this.getNextClientSequence(clientId);
    return {
      type,
      seq,
      ts: Date.now(),
      data
    };
  }
}

// Singleton instance
export const wsSequence = new WebSocketSequenceManager();

// Message types for consistency
export const WS_MESSAGE_TYPES = {
  // Artwork events
  ARTWORK_SWAP: 'artwork.swap',
  ARTWORK_GENERATED: 'artwork.generated',
  
  // Fallback events
  FALLBACK_ENTER: 'fallback_enter',
  FALLBACK_EXIT: 'fallback_exit',
  FRESH_READY: 'fresh_ready',
  
  // Frame events
  FRAME_INVALID: 'frame_invalid',
  TRANSITION_COMMIT: 'transition_commit',
  
  // Music events
  MUSIC_CHANGED: 'music_changed',
  
  // State events
  STATE_SYNC: 'state_sync',
} as const;

export type WSMessageType = typeof WS_MESSAGE_TYPES[keyof typeof WS_MESSAGE_TYPES];