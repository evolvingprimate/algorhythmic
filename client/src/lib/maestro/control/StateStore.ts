import type { ClockState, AudioFeatures, VisionFeatures, Directive } from "@shared/maestroTypes";

/**
 * StateStore - Maintains lightweight snapshots of Maestro state
 * 
 * Purpose:
 *   - Store recent state history for deterministic replay
 *   - Track active directives
 *   - Provide state snapshots for debugging
 * 
 * This enables:
 *   - Deterministic behavior (can replay from state)
 *   - Debugging (inspect past states)
 *   - Testing (inject known states)
 */
export interface MaestroState {
  timestamp: number;
  clock: ClockState | null;
  audio: AudioFeatures | null;
  vision: VisionFeatures | null;
  activeDirectives: Directive[];
  fps: number;
}

export class StateStore {
  private currentState: MaestroState;
  private history: MaestroState[] = [];
  private maxHistorySize: number = 300; // 5 seconds at 60 FPS

  constructor() {
    this.currentState = {
      timestamp: performance.now(),
      clock: null,
      audio: null,
      vision: null,
      activeDirectives: [],
      fps: 0,
    };
    console.log("[StateStore] Initialized");
  }

  /**
   * Update current state
   */
  update(partial: Partial<MaestroState>): void {
    this.currentState = {
      ...this.currentState,
      ...partial,
      timestamp: performance.now(),
    };

    // Add to history
    this.history.push({ ...this.currentState });

    // Trim history
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Get current state snapshot
   */
  getCurrent(): MaestroState {
    return { ...this.currentState };
  }

  /**
   * Get state history
   */
  getHistory(): MaestroState[] {
    return [...this.history];
  }

  /**
   * Get state at specific timestamp (nearest match)
   */
  getStateAt(timestamp: number): MaestroState | null {
    if (this.history.length === 0) return null;

    let closest = this.history[0];
    let closestDiff = Math.abs(closest.timestamp - timestamp);

    for (const state of this.history) {
      const diff = Math.abs(state.timestamp - timestamp);
      if (diff < closestDiff) {
        closest = state;
        closestDiff = diff;
      }
    }

    return { ...closest };
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.currentState = {
      timestamp: performance.now(),
      clock: null,
      audio: null,
      vision: null,
      activeDirectives: [],
      fps: 0,
    };
    this.history = [];
    console.log("[StateStore] Cleared");
  }

  /**
   * Get state statistics
   */
  getStats() {
    return {
      historySize: this.history.length,
      maxHistorySize: this.maxHistorySize,
      oldestTimestamp: this.history[0]?.timestamp || null,
      newestTimestamp: this.history[this.history.length - 1]?.timestamp || null,
      currentFPS: this.currentState.fps,
      activeDirectives: this.currentState.activeDirectives.length,
    };
  }
}
