/**
 * Queue Controller with Hysteresis
 * Manages frame generation state with 2-tick hysteresis to prevent oscillation
 * Enhanced with DALL-E health awareness and backpressure control
 */

import { telemetryService } from "./telemetry-service";
import type { GenerationHealthPort } from "./types/generation-ports";
import type { RecoveryManager } from "./recovery-manager";

// State types for queue management
export type QueueState = 'HUNGRY' | 'SATISFIED' | 'OVERFULL';

// Queue metrics for decision making
export interface QueueMetrics {
  queueSize: number;       // Current number of frames in queue
  targetSize: number;      // Target queue size
  minSize: number;         // Minimum queue size threshold
  maxSize: number;         // Maximum queue size threshold
  generationRate: number;  // Frames generated per minute
  consumptionRate: number; // Frames consumed per minute
}

// Telemetry for monitoring queue behavior
export interface QueueTelemetry {
  timestamp: Date;
  state: QueueState;
  queueSize: number;
  stateChangeCounter: number;
  generationDecision: 'generate' | 'skip';
  batchSize: number;
  targetState?: QueueState; // State we're transitioning to
}

/**
 * Queue Controller Class
 * Implements state machine with hysteresis for stable queue management
 */
export class QueueController {
  // Current state of the queue
  private currentState: QueueState = 'HUNGRY';
  
  // Counter for hysteresis (tracks consecutive ticks in same target state)
  private stateChangeCounter: number = 0;
  
  // Last target state for hysteresis tracking
  private lastTargetState: QueueState | null = null;
  
  // Hysteresis threshold - require 2 consecutive ticks to change state
  private readonly HYSTERESIS_THRESHOLD = 2;
  
  // Queue size thresholds
  public readonly MIN_FRAMES = 2;      // Below this = HUNGRY
  public readonly TARGET_FRAMES = 3;   // Ideal queue size
  public readonly MAX_FRAMES = 4;      // Above this = OVERFULL
  
  // Rate tracking for telemetry
  private generationCount = 0;
  private consumptionCount = 0;
  private rateWindowStart = Date.now();
  private readonly RATE_WINDOW_MS = 60000; // 1 minute window
  
  // Telemetry storage
  private telemetryHistory: QueueTelemetry[] = [];
  private readonly MAX_TELEMETRY_ENTRIES = 100;
  
  constructor(
    private readonly generationHealth: GenerationHealthPort,
    private readonly recoveryManager: RecoveryManager
  ) {
    console.log('[QueueController] Initialized with thresholds:', {
      MIN_FRAMES: this.MIN_FRAMES,
      TARGET_FRAMES: this.TARGET_FRAMES,
      MAX_FRAMES: this.MAX_FRAMES,
      HYSTERESIS_THRESHOLD: this.HYSTERESIS_THRESHOLD
    });
  }
  
  /**
   * Process a tick with current queue metrics
   * Returns the current state after applying hysteresis
   */
  tick(metrics: QueueMetrics): QueueState {
    // Determine what state we should be in based on metrics
    const targetState = this.determineTargetState(metrics);
    
    // Apply hysteresis to prevent oscillation
    const newState = this.applyHysteresis(targetState);
    
    // Update internal metrics
    this.updateRates(metrics);
    
    // Log state transition if changed
    if (newState !== this.currentState) {
      console.log('[QueueController] State transition:', {
        from: this.currentState,
        to: newState,
        queueSize: metrics.queueSize,
        counter: this.stateChangeCounter
      });
      
      // Track telemetry for state change
      telemetryService.recordEvent({
        category: 'generation',
        event: 'queue_state_change',
        metrics: {
          fromState: this.currentState,
          toState: newState,
          queueSize: metrics.queueSize,
          stateChangeCounter: this.stateChangeCounter
        },
        severity: newState === 'HUNGRY' ? 'warning' : 'info'
      });
      
      this.currentState = newState;
    }
    
    // Also track queue depth for monitoring
    telemetryService.recordEvent({
      category: 'generation',
      event: 'queue_tick',
      metrics: {
        state: this.currentState,
        queueSize: metrics.queueSize,
        targetSize: metrics.targetSize
      },
      severity: 'info'
    });
    
    return this.currentState;
  }
  
  /**
   * Determine if we should generate a frame based on current state
   * Now integrates with DALL-E health service and circuit breaker
   */
  shouldGenerateFrame(): boolean {
    // Check DALL-E health first (circuit breaker state)
    const dalleHealthy = this.generationHealth.shouldAttemptGeneration();
    
    if (!dalleHealthy) {
      console.log('[QueueController] DALL-E unhealthy, skipping generation');
      
      // Track this decision in telemetry
      telemetryService.recordEvent({
        category: 'generation',
        event: 'generation_skipped_health',
        metrics: {
          state: this.currentState,
          breaker_state: this.generationHealth.getCurrentState(),
          reason: 'dalle_unhealthy'
        },
        severity: 'warning'
      });
      
      return false;
    }
    
    switch (this.currentState) {
      case 'HUNGRY':
        return true; // Always generate when hungry
      case 'SATISFIED':
        return true; // Generate at normal rate
      case 'OVERFULL':
        return false; // Pause generation
      default:
        return true;
    }
  }
  
  /**
   * Get generation decision with detailed reasoning
   * Returns both whether to generate AND why not (if applicable)
   * Critical for triggering fallback when circuit breaker is open
   */
  getGenerationDecision(): { shouldGenerate: boolean; reason?: 'breaker_open' | 'queue_full' | 'breaker_half_open' } {
    // Check DALL-E health first (circuit breaker state)
    const breakerState = this.generationHealth.getCurrentState();
    const dalleHealthy = this.generationHealth.shouldAttemptGeneration();
    
    if (!dalleHealthy) {
      console.log('[QueueController] DALL-E unhealthy, breaker state:', breakerState);
      
      // Track this decision in telemetry
      telemetryService.recordEvent({
        category: 'generation',
        event: 'generation_denied_breaker',
        metrics: {
          queue_state: this.currentState,
          breaker_state: breakerState,
          reason: 'breaker_denial'
        },
        severity: 'warning'
      });
      
      // Provide specific reason for fallback routing
      if (breakerState === 'open') {
        return { shouldGenerate: false, reason: 'breaker_open' };
      } else if (breakerState === 'half-open') {
        // In half-open, some requests are denied for sampling
        return { shouldGenerate: false, reason: 'breaker_half_open' };
      }
    }
    
    // Check queue state
    switch (this.currentState) {
      case 'HUNGRY':
        return { shouldGenerate: true };
      case 'SATISFIED':
        return { shouldGenerate: true };
      case 'OVERFULL':
        return { shouldGenerate: false, reason: 'queue_full' };
      default:
        return { shouldGenerate: true };
    }
  }
  
  /**
   * Get recommended batch size based on current state
   * Now considers recovery batch size when in degraded mode
   */
  getRecommendedBatchSize(): number {
    // If circuit breaker is in recovery, use recovery batch size
    const breakerState = this.generationHealth.getCurrentState();
    if (breakerState === 'half-open') {
      const recoveryBatch = this.recoveryManager.getRecoveryBatchSize();
      console.log(`[QueueController] Using recovery batch size: ${recoveryBatch}`);
      return recoveryBatch;
    }
    
    // If breaker is open, no generation
    if (breakerState === 'open') {
      return 0;
    }
    
    // Normal operation - base on queue state
    switch (this.currentState) {
      case 'HUNGRY':
        // Aggressive generation: 2-3 frames
        return Math.random() < 0.5 ? 2 : 3;
      case 'SATISFIED':
        // Normal generation: 1 frame
        return 1;
      case 'OVERFULL':
        // No generation
        return 0;
      default:
        return 1;
    }
  }
  
  /**
   * Get current state
   */
  getState(): QueueState {
    return this.currentState;
  }
  
  /**
   * Get current metrics including internal state
   */
  getMetrics(): QueueMetrics & { 
    stateChangeCounter: number;
    currentState: QueueState;
    lastTargetState: QueueState | null;
  } {
    const now = Date.now();
    const windowDuration = Math.max(1, (now - this.rateWindowStart) / 60000); // Minutes
    
    return {
      queueSize: 0, // Will be overridden by caller
      targetSize: this.TARGET_FRAMES,
      minSize: this.MIN_FRAMES,
      maxSize: this.MAX_FRAMES,
      generationRate: this.generationCount / windowDuration,
      consumptionRate: this.consumptionCount / windowDuration,
      stateChangeCounter: this.stateChangeCounter,
      currentState: this.currentState,
      lastTargetState: this.lastTargetState
    };
  }
  
  /**
   * Record telemetry for monitoring
   */
  recordTelemetry(
    queueSize: number,
    decision: 'generate' | 'skip',
    batchSize: number
  ): void {
    const telemetry: QueueTelemetry = {
      timestamp: new Date(),
      state: this.currentState,
      queueSize,
      stateChangeCounter: this.stateChangeCounter,
      generationDecision: decision,
      batchSize,
      targetState: this.lastTargetState || undefined
    };
    
    this.telemetryHistory.push(telemetry);
    
    // Trim history to max size
    if (this.telemetryHistory.length > this.MAX_TELEMETRY_ENTRIES) {
      this.telemetryHistory.shift();
    }
  }
  
  /**
   * Get telemetry history for debugging
   */
  getTelemetryHistory(limit?: number): QueueTelemetry[] {
    const entries = [...this.telemetryHistory].reverse(); // Most recent first
    return limit ? entries.slice(0, limit) : entries;
  }
  
  /**
   * Clear telemetry history
   */
  clearTelemetry(): void {
    this.telemetryHistory = [];
  }
  
  /**
   * Determine target state based on queue metrics
   * This is the state we WANT to be in based on current queue size
   */
  private determineTargetState(metrics: QueueMetrics): QueueState {
    const { queueSize } = metrics;
    
    if (queueSize < this.MIN_FRAMES) {
      return 'HUNGRY';
    } else if (queueSize > this.MAX_FRAMES) {
      return 'OVERFULL';
    } else {
      return 'SATISFIED';
    }
  }
  
  /**
   * Apply hysteresis to prevent rapid state changes
   * Only change state after HYSTERESIS_THRESHOLD consecutive ticks
   */
  private applyHysteresis(targetState: QueueState): QueueState {
    // If target state matches current state, we're stable
    if (targetState === this.currentState) {
      // Reset counter since we're not trying to change
      this.stateChangeCounter = 0;
      this.lastTargetState = null;
      return this.currentState;
    }
    
    // Check if this is the same target as last tick
    if (targetState === this.lastTargetState) {
      // Increment counter - we want to move to this state
      this.stateChangeCounter++;
      
      // Check if we've hit the threshold
      if (this.stateChangeCounter >= this.HYSTERESIS_THRESHOLD) {
        // State change confirmed! Reset counter
        console.log('[QueueController] Hysteresis threshold met, changing state:', {
          from: this.currentState,
          to: targetState,
          counter: this.stateChangeCounter
        });
        this.stateChangeCounter = 0;
        this.lastTargetState = null;
        return targetState;
      }
    } else {
      // Different target state than last tick - reset counter
      console.log('[QueueController] Target state changed, resetting counter:', {
        current: this.currentState,
        lastTarget: this.lastTargetState,
        newTarget: targetState
      });
      this.stateChangeCounter = 1;
      this.lastTargetState = targetState;
    }
    
    // Haven't hit threshold yet, maintain current state
    return this.currentState;
  }
  
  /**
   * Update generation and consumption rates
   */
  private updateRates(metrics: QueueMetrics): void {
    const now = Date.now();
    
    // Reset counters every minute
    if (now - this.rateWindowStart > this.RATE_WINDOW_MS) {
      this.generationCount = 0;
      this.consumptionCount = 0;
      this.rateWindowStart = now;
    }
    
    // Update rates from metrics if provided
    if (metrics.generationRate > 0 || metrics.consumptionRate > 0) {
      // Rates are externally calculated
      return;
    }
  }
  
  /**
   * Record a generation event for rate tracking
   */
  recordGeneration(count: number = 1): void {
    this.generationCount += count;
  }
  
  /**
   * Record a consumption event for rate tracking
   */
  recordConsumption(count: number = 1): void {
    this.consumptionCount += count;
  }
  
  /**
   * Reset the controller state (useful for testing)
   */
  reset(): void {
    this.currentState = 'HUNGRY';
    this.stateChangeCounter = 0;
    this.lastTargetState = null;
    this.generationCount = 0;
    this.consumptionCount = 0;
    this.rateWindowStart = Date.now();
    this.telemetryHistory = [];
    
    console.log('[QueueController] Reset to initial state');
  }
}

// Export singleton placeholder for backward compatibility
// This will be replaced in bootstrap.ts
export let queueController: QueueController;