import { EventEmitter } from "events";
import type { AudioFeatures, VisionFeatures, ClockState } from "@shared/maestroTypes";

/**
 * FeatureBus - Central event bus for feature updates
 * 
 * Provides a decoupled communication channel between:
 *   - AudioProbe → MaestroLoop
 *   - VisionPipeline → MaestroLoop (Phase 3)
 *   - Any other feature extractors
 * 
 * Benefits:
 *   - Loose coupling (components don't directly reference each other)
 *   - Easy to add new feature sources
 *   - Centralized logging and monitoring
 */
export class FeatureBus extends EventEmitter {
  private static instance: FeatureBus;

  private latestAudio: AudioFeatures | null = null;
  private latestVision: VisionFeatures | null = null;
  private latestClock: ClockState | null = null;

  private constructor() {
    super();
    console.log("[FeatureBus] Initialized");
  }

  static getInstance(): FeatureBus {
    if (!FeatureBus.instance) {
      FeatureBus.instance = new FeatureBus();
    }
    return FeatureBus.instance;
  }

  /**
   * Publish audio features
   */
  publishAudio(features: AudioFeatures): void {
    this.latestAudio = features;
    this.emit("audio", features);
  }

  /**
   * Publish vision features
   */
  publishVision(features: VisionFeatures): void {
    this.latestVision = features;
    this.emit("vision", features);
  }

  /**
   * Publish clock state
   */
  publishClock(state: ClockState): void {
    this.latestClock = state;
    this.emit("clock", state);
  }

  /**
   * Get latest audio features
   */
  getLatestAudio(): AudioFeatures | null {
    return this.latestAudio;
  }

  /**
   * Get latest vision features
   */
  getLatestVision(): VisionFeatures | null {
    return this.latestVision;
  }

  /**
   * Get latest clock state
   */
  getLatestClock(): ClockState | null {
    return this.latestClock;
  }

  /**
   * Subscribe to audio updates
   */
  onAudio(listener: (features: AudioFeatures) => void): void {
    this.on("audio", listener);
  }

  /**
   * Subscribe to vision updates
   */
  onVision(listener: (features: VisionFeatures) => void): void {
    this.on("vision", listener);
  }

  /**
   * Subscribe to clock updates
   */
  onClock(listener: (state: ClockState) => void): void {
    this.on("clock", listener);
  }

  /**
   * Clear all listeners (cleanup)
   */
  cleanup(): void {
    this.removeAllListeners();
    this.latestAudio = null;
    this.latestVision = null;
    this.latestClock = null;
    console.log("[FeatureBus] Cleaned up");
  }
}
