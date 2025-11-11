type MessageHandler = (data: any, fullMessage?: any) => void;

// ACK message types matching server
const WS_MESSAGE_TYPES = {
  CLIENT_ACK: 'client.ack',
  HEARTBEAT: 'heartbeat',
  HEARTBEAT_ACK: 'heartbeat.ack',
  RESYNC_REQUEST: 'resync.request',
  CONNECTION_INIT: 'connection.init',
  ERROR: 'error',
  ARTWORK_SWAP: 'artwork.swap',
};

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private reconnectTimeout: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10; // Increased for better resilience
  
  // Sequence tracking
  private receivedSequences = new Set<number>();
  private lastSequence = 0;
  private missingSequenceCheckInterval: number | null = null;
  
  // Client ID (assigned by server)
  private clientId: string | null = null;
  
  // Connection state
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;
  private connectionResolve: (() => void) | null = null;

  connect(): Promise<void> {
    // Return existing connection promise if already connecting
    if (this.connectionPromise) {
      return this.connectionPromise;
    }
    
    this.connectionPromise = new Promise((resolve) => {
      this.connectionResolve = resolve;
    });
    
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[WebSocket] Connected");
        this.reconnectAttempts = 0;
        this.isConnected = true;
        
        // Connection will be fully established after receiving CONNECTION_INIT
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Handle special message types first
          if (message.type === WS_MESSAGE_TYPES.CONNECTION_INIT) {
            this.clientId = message.clientId;
            this.lastSequence = message.seq || 0;
            console.log(`[WebSocket] Initialized with clientId: ${this.clientId}, current seq: ${this.lastSequence}`);
            
            // Resolve connection promise
            if (this.connectionResolve) {
              this.connectionResolve();
              this.connectionResolve = null;
            }
            
            // Start missing sequence check
            this.startMissingSequenceCheck();
            return;
          }
          
          // Handle heartbeat
          if (message.type === WS_MESSAGE_TYPES.HEARTBEAT) {
            this.sendHeartbeatAck(message.seq);
            return;
          }
          
          // Track sequence for all messages with seq
          if (message.seq) {
            this.trackSequence(message.seq, message.type);
          }
          
          // Call message handlers (pass both data and full message for ACK)
          const handler = this.messageHandlers.get(message.type);
          if (handler) {
            handler(message.data || message, message);
          }
        } catch (error) {
          console.error("[WebSocket] Error parsing message:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("[WebSocket] Error:", error);
        this.isConnected = false;
      };

      this.ws.onclose = () => {
        console.log("[WebSocket] Disconnected");
        this.isConnected = false;
        this.stopMissingSequenceCheck();
        this.attemptReconnect();
      };
    } catch (error) {
      console.error("[WebSocket] Error creating WebSocket:", error);
      this.attemptReconnect();
    }
    
    return this.connectionPromise;
  }
  
  private trackSequence(seq: number, messageType: string): void {
    this.receivedSequences.add(seq);
    
    // Send ACK for important messages
    if (messageType === WS_MESSAGE_TYPES.ARTWORK_SWAP || 
        (messageType && messageType.includes('artwork'))) {
      this.sendAck(seq);
    }
    
    // Update last sequence if consecutive
    if (seq === this.lastSequence + 1) {
      this.lastSequence = seq;
    } else if (seq > this.lastSequence + 1) {
      console.warn(`[WebSocket] Sequence gap detected: expected ${this.lastSequence + 1}, got ${seq}`);
      // Don't immediately request resync, wait for missing sequence check
    }
  }
  
  private sendAck(seq: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: WS_MESSAGE_TYPES.CLIENT_ACK,
        seq
      }));
      console.log(`[WebSocket] Sent ACK for seq ${seq}`);
    }
  }
  
  private sendHeartbeatAck(seq: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: WS_MESSAGE_TYPES.HEARTBEAT_ACK,
        seq
      }));
    }
  }
  
  private checkMissingSequences(): void {
    if (this.receivedSequences.size === 0) return;
    
    const sequences = Array.from(this.receivedSequences).sort((a, b) => a - b);
    const maxReceived = sequences[sequences.length - 1];
    const expected = this.lastSequence + 1;
    
    // Check for significant gap
    if (maxReceived > expected + 5) {
      console.warn(`[WebSocket] Missing sequences detected, requesting resync from ${expected}`);
      this.requestResync(expected);
    }
    
    // Clean up old sequences (keep last 100)
    if (sequences.length > 100) {
      const toRemove = sequences.slice(0, sequences.length - 100);
      toRemove.forEach(seq => this.receivedSequences.delete(seq));
    }
  }
  
  private requestResync(fromSeq: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: WS_MESSAGE_TYPES.RESYNC_REQUEST,
        fromSeq
      }));
      console.log(`[WebSocket] Requested resync from seq ${fromSeq}`);
    }
  }
  
  private startMissingSequenceCheck(): void {
    this.stopMissingSequenceCheck();
    this.missingSequenceCheckInterval = window.setInterval(() => {
      this.checkMissingSequences();
    }, 10000); // Check every 10 seconds
  }
  
  private stopMissingSequenceCheck(): void {
    if (this.missingSequenceCheckInterval) {
      clearInterval(this.missingSequenceCheckInterval);
      this.missingSequenceCheckInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      
      console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      this.reconnectTimeout = window.setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error(`[WebSocket] Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
    }
  }
  
  send(type: string, payload: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn(`[WebSocket] Cannot send message, not connected`);
    }
  }
  
  sendRaw(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn(`[WebSocket] Cannot send raw message, not connected`);
    }
  }

  on(messageType: string, handler: MessageHandler): void {
    this.messageHandlers.set(messageType, handler);
  }

  off(messageType: string): void {
    this.messageHandlers.delete(messageType);
  }
  
  getConnectionState(): { connected: boolean; clientId: string | null } {
    return {
      connected: this.isConnected,
      clientId: this.clientId
    };
  }
  
  resetConnection(): void {
    this.disconnect();
    this.reconnectAttempts = 0;
    this.connect();
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.stopMissingSequenceCheck();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers.clear();
    this.receivedSequences.clear();
    this.lastSequence = 0;
    this.clientId = null;
    this.isConnected = false;
    this.connectionPromise = null;
    this.connectionResolve = null;
  }
}
