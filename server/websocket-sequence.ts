// WebSocket Sequence ID Manager - Ensures monotonic message ordering
// Prevents state drift between server and client
// Enhanced with ACK tracking and retry logic for reliable delivery

/**
 * Pending message waiting for acknowledgment
 */
export interface PendingMessage {
  seq: number;
  message: any;
  timestamp: number;
  retryCount: number;
  clientId: string;
}

/**
 * Client connection state tracking
 */
export interface ClientState {
  clientId: string;
  lastSeen: number;
  lastAckedSeq: number;
  connected: boolean;
}

/**
 * Manages monotonic sequence IDs for WebSocket messages
 * Each client connection gets its own sequence counter
 * Enhanced with ACK tracking and retry logic
 */
export class WebSocketSequenceManager {
  private globalSequence = 0;
  private clientSequences = new Map<string, number>();
  
  // ACK tracking
  private pendingMessages = new Map<string, PendingMessage[]>();
  private clientStates = new Map<string, ClientState>();
  private readonly MAX_RETRY_COUNT = 3;
  private readonly ACK_TIMEOUT_MS = 5000;
  private readonly HEARTBEAT_INTERVAL_MS = 30000;
  
  // WebSocket server reference for broadcasting
  private wss: any = null;
  
  /**
   * Get the current global sequence number (for sync)
   */
  getCurrentSequence(): number {
    return this.globalSequence;
  }
  
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
   * Initialize client connection state
   * @param clientId - Unique identifier for the client
   */
  initializeClient(clientId: string): void {
    this.clientStates.set(clientId, {
      clientId,
      lastSeen: Date.now(),
      lastAckedSeq: 0,
      connected: true
    });
    this.pendingMessages.set(clientId, []);
  }
  
  /**
   * Reset sequence for a client (on disconnect/reconnect)
   * @param clientId - Unique identifier for the client connection
   */
  resetClientSequence(clientId: string): void {
    this.clientSequences.delete(clientId);
    this.pendingMessages.delete(clientId);
    const state = this.clientStates.get(clientId);
    if (state) {
      state.connected = false;
    }
  }
  
  /**
   * Update client's last seen timestamp
   * @param clientId - Unique identifier for the client
   */
  updateClientLastSeen(clientId: string): void {
    const state = this.clientStates.get(clientId);
    if (state) {
      state.lastSeen = Date.now();
    }
  }
  
  /**
   * Track a pending message that needs acknowledgment
   * @param clientId - Target client
   * @param message - Message to track
   */
  trackPendingMessage(clientId: string, message: any): void {
    const pending = this.pendingMessages.get(clientId) || [];
    pending.push({
      seq: message.seq,
      message,
      timestamp: Date.now(),
      retryCount: 0,
      clientId
    });
    this.pendingMessages.set(clientId, pending);
  }
  
  /**
   * Acknowledge a message from a client
   * @param clientId - Client who sent the ACK
   * @param seq - Sequence number being acknowledged
   */
  acknowledgeMessage(clientId: string, seq: number): void {
    const pending = this.pendingMessages.get(clientId);
    if (!pending) return;
    
    // Remove acknowledged message
    const filtered = pending.filter(msg => msg.seq !== seq);
    this.pendingMessages.set(clientId, filtered);
    
    // Update client state
    const state = this.clientStates.get(clientId);
    if (state && seq > state.lastAckedSeq) {
      state.lastAckedSeq = seq;
    }
    
    console.log(`[WebSocket] ACK received from ${clientId} for seq ${seq}`);
  }
  
  /**
   * Check for messages that need retrying
   * @returns Messages that have timed out and need retrying
   */
  checkPendingMessages(): PendingMessage[] {
    const now = Date.now();
    const needsRetry: PendingMessage[] = [];
    
    for (const [clientId, messages] of this.pendingMessages) {
      for (const msg of messages) {
        if (now - msg.timestamp > this.ACK_TIMEOUT_MS) {
          if (msg.retryCount < this.MAX_RETRY_COUNT) {
            needsRetry.push(msg);
          } else {
            console.warn(`[WebSocket] Message seq ${msg.seq} to ${clientId} exceeded max retries`);
          }
        }
      }
    }
    
    return needsRetry;
  }
  
  /**
   * Mark a message as retried
   * @param clientId - Target client
   * @param seq - Sequence number
   */
  markRetried(clientId: string, seq: number): void {
    const pending = this.pendingMessages.get(clientId);
    if (!pending) return;
    
    const msg = pending.find(m => m.seq === seq);
    if (msg) {
      msg.retryCount++;
      msg.timestamp = Date.now(); // Reset timeout
    }
  }
  
  /**
   * Get messages from a specific sequence number (for resync)
   * @param fromSeq - Starting sequence number
   * @returns Messages from that sequence onwards
   */
  getMessagesFromSequence(clientId: string, fromSeq: number): any[] {
    const pending = this.pendingMessages.get(clientId) || [];
    return pending
      .filter(msg => msg.seq >= fromSeq)
      .sort((a, b) => a.seq - b.seq)
      .map(msg => msg.message);
  }
  
  /**
   * Check if a client is stale (hasn't been seen recently)
   * @param clientId - Client to check
   * @param staleThresholdMs - Time threshold for staleness
   */
  isClientStale(clientId: string, staleThresholdMs: number = 60000): boolean {
    const state = this.clientStates.get(clientId);
    if (!state) return true;
    return Date.now() - state.lastSeen > staleThresholdMs;
  }
  
  /**
   * Get all connected client IDs
   */
  getConnectedClients(): string[] {
    return Array.from(this.clientStates.entries())
      .filter(([_, state]) => state.connected)
      .map(([clientId, _]) => clientId);
  }
  
  /**
   * Clean up disconnected or stale clients
   */
  cleanupStaleClients(): void {
    const staleThreshold = 120000; // 2 minutes
    const now = Date.now();
    
    for (const [clientId, state] of this.clientStates) {
      if (!state.connected || now - state.lastSeen > staleThreshold) {
        this.resetClientSequence(clientId);
        this.clientStates.delete(clientId);
        console.log(`[WebSocket] Cleaned up stale client ${clientId}`);
      }
    }
  }
  
  /**
   * Create a sequenced message for broadcasting
   * @param type - Message type (e.g., 'artwork.swap', 'fallback_enter')
   * @param data - Message payload
   * @param requiresAck - Whether this message requires acknowledgment
   */
  createSequencedMessage(type: string, data: any, requiresAck: boolean = false): any {
    const seq = this.getNextGlobalSequence();
    return {
      type,
      seq,
      ts: Date.now(),
      requiresAck,
      data
    };
  }
  
  /**
   * Create a sequenced message for a specific client
   * @param clientId - Unique identifier for the client
   * @param type - Message type
   * @param data - Message payload
   * @param requiresAck - Whether this message requires acknowledgment
   */
  createClientMessage(clientId: string, type: string, data: any, requiresAck: boolean = false): any {
    const seq = this.getNextClientSequence(clientId);
    const message = {
      type,
      seq,
      ts: Date.now(),
      requiresAck,
      data
    };
    
    // Track if ACK is required
    if (requiresAck) {
      this.trackPendingMessage(clientId, message);
    }
    
    return message;
  }
  
  /**
   * Set the WebSocket server reference for broadcasting
   * @param wss - The WebSocket server instance
   */
  setWebSocketServer(wss: any): void {
    this.wss = wss;
    console.log('[WebSocketSequenceManager] WebSocket server reference set');
  }
  
  /**
   * Get the current number of connected WebSocket clients
   */
  getConnectionCount(): number {
    if (!this.wss || !this.wss.clients) {
      return 0;
    }
    
    let count = 0;
    this.wss.clients.forEach((client: any) => {
      if (client.readyState === 1) { // WebSocket.OPEN === 1
        count++;
      }
    });
    
    return count;
  }
  
  /**
   * Broadcast a message to all connected WebSocket clients
   * @param message - Message to broadcast (can be an object or pre-created sequenced message)
   */
  broadcast(message: any): void {
    if (!this.wss) {
      console.error('[WebSocketSequenceManager] Cannot broadcast: WebSocket server not set');
      return;
    }
    
    // If message doesn't have a sequence number, create a sequenced message
    let sequencedMessage = message;
    if (!message.seq) {
      // If it has a type field, use createSequencedMessage
      if (message.type) {
        sequencedMessage = this.createSequencedMessage(
          message.type,
          message.payload || message.data || message,
          false
        );
      } else {
        // Otherwise, wrap it in a generic broadcast message
        sequencedMessage = this.createSequencedMessage(
          'broadcast',
          message,
          false
        );
      }
    }
    
    // Broadcast to all connected clients
    try {
      const messageString = JSON.stringify(sequencedMessage);
      let broadcastCount = 0;
      
      // Check if wss has a clients property (standard WebSocketServer)
      if (this.wss.clients) {
        this.wss.clients.forEach((client: any) => {
          if (client.readyState === 1) { // WebSocket.OPEN === 1
            try {
              client.send(messageString);
              broadcastCount++;
            } catch (error) {
              console.error('[WebSocketSequenceManager] Error sending to client:', error);
            }
          }
        });
      }
      
      console.log(`[WebSocketSequenceManager] Broadcast to ${broadcastCount} clients:`, sequencedMessage.type);
    } catch (error) {
      console.error('[WebSocketSequenceManager] Broadcast failed:', error);
    }
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
  
  // ACK and reliability events
  CLIENT_ACK: 'client.ack',
  SERVER_ACK: 'server.ack',
  HEARTBEAT: 'heartbeat',
  HEARTBEAT_ACK: 'heartbeat.ack',
  ERROR: 'error',
  RESYNC_REQUEST: 'resync.request',
  CONNECTION_INIT: 'connection.init',
} as const;

export type WSMessageType = typeof WS_MESSAGE_TYPES[keyof typeof WS_MESSAGE_TYPES];