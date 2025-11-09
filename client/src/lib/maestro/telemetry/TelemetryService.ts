/**
 * TelemetryService - In-memory ring buffer with debounced flush
 * Captures user interactions, audio features, and system events for RAI analysis
 */

import type { InsertTelemetryEvent } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export type TelemetryEventType =
  | "session_start"
  | "session_end"
  | "artwork_impression"
  | "user_action"
  | "control_adjustment"
  | "climax_detected"
  | "vision_analyzed";

interface TelemetryEventData {
  // session_start/session_end
  artworkId?: string;
  genomeId?: string;
  
  // user_action
  action?: "like" | "skip" | "replay" | "save";
  
  // control_adjustment
  parameter?: string;
  oldValue?: number;
  newValue?: number;
  
  // climax_detected
  climaxMetrics?: {
    rms: number;
    onsetDensity: number;
    beatConfidence: number;
    duration: number;
  };
  
  // vision_analyzed
  visionResult?: {
    anchorCount: number;
    cached: boolean;
    processingTime: number;
  };
  
  // Generic metadata
  [key: string]: any;
}

interface AudioFeatures {
  rms: number;
  onsetStrength: number;
  beatConfidence: number;
  bpm?: number;
  spectralCentroid?: number;
}

interface VisualState {
  currentFrame?: string;
  effectsActive?: string[];
  parameterValues?: Record<string, number>;
}

interface BufferedEvent {
  eventType: TelemetryEventType;
  eventData: TelemetryEventData;
  audioFeatures?: AudioFeatures;
  visualState?: VisualState;
  timestamp: Date;
}

export class TelemetryService {
  private buffer: BufferedEvent[] = [];
  private readonly maxBufferSize = 1000;
  private readonly flushIntervalMs = 5000; // 5 seconds
  private flushTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private currentSessionId: string | null = null;
  private currentUserId: string | null = null;
  private isFlushing = false;

  constructor() {
    console.log('[TelemetryService] Initialized');
  }

  /**
   * Start a new RAI session
   */
  async startSession(userId: string | null, artworkId?: string, genomeId?: string): Promise<void> {
    try {
      // Create RAI session in database
      const response = await fetch('/api/telemetry/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          artworkId,
          genomeId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start session: ${response.statusText}`);
      }

      const { sessionId } = await response.json();
      this.currentSessionId = sessionId;
      this.currentUserId = userId;
      this.isInitialized = true;

      // Start flush timer
      this.scheduleFlush();

      // Record session_start event
      this.recordEvent('session_start', {
        artworkId,
        genomeId,
      });

      console.log(`[TelemetryService] Session started: ${sessionId}`);
    } catch (error) {
      console.error('[TelemetryService] Failed to start session:', error);
    }
  }

  /**
   * End the current session
   */
  async endSession(): Promise<void> {
    if (!this.currentSessionId) {
      console.warn('[TelemetryService] No active session to end');
      return;
    }

    // Record session_end event
    this.recordEvent('session_end', {});

    // Flush remaining events
    await this.flush();

    // Update session endedAt timestamp
    try {
      await fetch('/api/telemetry/session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.currentSessionId,
        }),
      });
    } catch (error) {
      console.error('[TelemetryService] Failed to end session:', error);
    }

    // Clear state
    this.stopFlush();
    this.currentSessionId = null;
    this.currentUserId = null;
    this.isInitialized = false;

    console.log('[TelemetryService] Session ended');
  }

  /**
   * Record a telemetry event
   */
  recordEvent(
    eventType: TelemetryEventType,
    eventData: TelemetryEventData,
    audioFeatures?: AudioFeatures,
    visualState?: VisualState
  ): void {
    if (!this.isInitialized || !this.currentSessionId) {
      console.warn('[TelemetryService] Cannot record event - no active session');
      return;
    }

    const event: BufferedEvent = {
      eventType,
      eventData,
      audioFeatures,
      visualState,
      timestamp: new Date(),
    };

    // Add to ring buffer
    this.buffer.push(event);

    // Trim buffer if exceeds max size (ring buffer behavior)
    if (this.buffer.length > this.maxBufferSize) {
      const overflow = this.buffer.length - this.maxBufferSize;
      this.buffer.splice(0, overflow);
      console.warn(`[TelemetryService] Buffer overflow - dropped ${overflow} oldest events`);
    }

    // Check if immediate flush needed
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  /**
   * Convenience methods for common events
   */
  recordArtworkImpression(artworkId: string, genomeId?: string): void {
    this.recordEvent('artwork_impression', { artworkId, genomeId });
  }

  recordUserAction(action: "like" | "skip" | "replay" | "save", artworkId: string): void {
    this.recordEvent('user_action', { action, artworkId });
  }

  recordControlAdjustment(parameter: string, oldValue: number, newValue: number): void {
    this.recordEvent('control_adjustment', { parameter, oldValue, newValue });
  }

  recordClimaxDetected(climaxMetrics: TelemetryEventData['climaxMetrics']): void {
    this.recordEvent('climax_detected', { climaxMetrics });
  }

  recordVisionAnalyzed(visionResult: TelemetryEventData['visionResult']): void {
    this.recordEvent('vision_analyzed', { visionResult });
  }

  /**
   * Flush buffered events to backend
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.isFlushing || !this.currentSessionId) {
      return;
    }

    this.isFlushing = true;

    try {
      // Copy buffer and clear it
      const eventsToFlush = [...this.buffer];
      this.buffer = [];

      // Convert to InsertTelemetryEvent format
      const events = eventsToFlush.map(event => ({
        sessionId: this.currentSessionId!,
        userId: this.currentUserId,
        eventType: event.eventType,
        eventData: JSON.stringify(event.eventData),
        audioFeatures: event.audioFeatures ? JSON.stringify(event.audioFeatures) : null,
        visualState: event.visualState ? JSON.stringify(event.visualState) : null,
      }));

      // Send to backend
      await fetch('/api/telemetry/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });

      console.log(`[TelemetryService] Flushed ${events.length} events`);
    } catch (error) {
      console.error('[TelemetryService] Flush failed:', error);
      // Note: Events are lost on flush failure (acceptable for telemetry)
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Schedule periodic flush
   */
  private scheduleFlush(): void {
    this.stopFlush();
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Stop periodic flush
   */
  private stopFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Get buffer stats for debugging
   */
  getStats(): { bufferSize: number; isActive: boolean; sessionId: string | null } {
    return {
      bufferSize: this.buffer.length,
      isActive: this.isInitialized,
      sessionId: this.currentSessionId,
    };
  }
}

// Singleton instance
export const telemetryService = new TelemetryService();
