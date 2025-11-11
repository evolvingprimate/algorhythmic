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
  | "vision_analyzed"
  // ============================================================================
  // TASK 9: Catalogue Bridge & GPU Handoff Telemetry Events
  // ============================================================================
  | "catalogue_bridge.request"
  | "catalogue_bridge.success"
  | "catalogue_bridge.fallback_tier_1"
  | "catalogue_bridge.fallback_tier_2"
  | "catalogue_bridge.fallback_tier_3"
  | "catalogue_bridge.fallback_tier_4"
  | "catalogue_bridge.error"
  | "handoff.prewarm_start"
  | "handoff.prewarm_complete"
  | "handoff.ready_wait"
  | "handoff.ready_timeout"
  | "handoff.swap_complete"
  | "handoff.error"
  | "duplicate_prevented";

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
  
  // ============================================================================
  // TASK 9: Catalogue Bridge Telemetry Data
  // ============================================================================
  
  // catalogue_bridge.request
  requestedStyles?: string[];
  requestedOrientation?: string;
  sessionId?: string;
  
  // catalogue_bridge.success / fallback_tier_*
  tier?: number; // 1 (exact), 2 (related), 3 (global), 4 (procedural)
  frameCount?: number;
  latencyMs?: number;
  
  // catalogue_bridge.error
  errorMessage?: string;
  
  // ============================================================================
  // TASK 9: GPU Handoff Telemetry Data
  // ============================================================================
  
  // handoff.prewarm_start / prewarm_complete
  frameId?: string;
  prewarmDurationMs?: number;
  
  // handoff.ready_wait / ready_timeout
  waitDurationMs?: number;
  timedOut?: boolean;
  
  // handoff.swap_complete
  swapSuccess?: boolean;
  totalHandoffMs?: number;
  
  // handoff.error
  handoffError?: string;
  
  // ============================================================================
  // TASK 9: Duplicate Prevention Telemetry Data
  // ============================================================================
  
  // duplicate_prevented
  duplicateType?: "artwork_id" | "image_url";
  preventedFrameId?: string;
  
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
  
  // ============================================================================
  // TASK 9: Session lifecycle queue for serialized transitions
  // ============================================================================
  private sessionTransitionQueue: Promise<void> = Promise.resolve();

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
   * TASK 9: Transition to a new session (serialized end→start)
   * This ensures previous session fully ends before new one starts
   */
  transitionSession(userId: string | null): void {
    // Chain onto existing queue to ensure serialization
    this.sessionTransitionQueue = this.sessionTransitionQueue
      .then(async () => {
        // End current session if one exists
        if (this.isInitialized && this.currentSessionId) {
          console.log(`[TelemetryService] Transition: ending session ${this.currentSessionId}`);
          await this.endSession();
        }
        
        // Start new session
        console.log(`[TelemetryService] Transition: starting new session for userId=${userId}`);
        await this.startSession(userId);
      })
      .catch(error => {
        console.error('[TelemetryService] Session transition failed:', error);
      });
  }

  /**
   * TASK 9: Clear current session (unmount cleanup)
   * This ensures all events are flushed before component unmounts
   */
  async clearSession(): Promise<void> {
    // Wait for any pending transitions to complete
    await this.sessionTransitionQueue;
    
    // End current session if one exists
    if (this.isInitialized && this.currentSessionId) {
      console.log(`[TelemetryService] Clearing session ${this.currentSessionId}`);
      await this.endSession();
    }
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
