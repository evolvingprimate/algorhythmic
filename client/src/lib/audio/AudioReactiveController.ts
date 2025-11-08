/**
 * Audio-Reactive Controller
 * Main public API for enabling audio-reactive control of MorphEngine
 */

import { AudioAnalyzer, type AudioSignals } from './AudioAnalyzer';
import { AudioReactiveMapper } from './AudioReactiveMapper';
import type { MorphEngine } from '../morphEngine';

export interface AudioReactiveOpts {
  tempoBpm?: number;            // default 120
  barBeats?: number;            // default 4
  audioVisualOffsetMs?: number; // default -50
  enableStageGating?: boolean;  // default true
}

export interface AudioReactiveController {
  start(): Promise<void>;
  stop(): void;
  setTempo(bpm: number): void;
  setOffset(ms: number): void;
  getSignals(): AudioSignals | null;
  isRunning(): boolean;
}

export function enableAudioReactive(
  engine: MorphEngine,
  opts: AudioReactiveOpts = {}
): AudioReactiveController {
  const {
    tempoBpm = 120,
    barBeats = 4,
    audioVisualOffsetMs = -50,
    enableStageGating = true
  } = opts;

  const analyzer = new AudioAnalyzer();
  const mapper = new AudioReactiveMapper();

  let animationFrameId: number | null = null;
  let lastUpdateTime: number = 0;

  // Set initial parameters
  analyzer.setTempo(tempoBpm);
  analyzer.setOffset(audioVisualOffsetMs);

  /**
   * Update loop - called every animation frame
   */
  function update(): void {
    if (!analyzer.isActive()) {
      return;
    }

    const now = performance.now();
    const dt = lastUpdateTime > 0 ? (now - lastUpdateTime) / 1000 : 0;
    lastUpdateTime = now;

    // Get audio signals
    const signals = analyzer.getSignals();

    // Update morph controls based on audio
    mapper.update(engine, signals, dt);

    // Stage gating logic (Task 13)
    if (enableStageGating && signals.barBoundary) {
      // This would trigger stage advancement in Morpheus 0.4
      // For now, this is a placeholder for the stage gating functionality
      // The actual implementation will be in Morpheus04Renderer
      console.log('[AudioReactiveController] Bar boundary - stage transition allowed');
    }

    // Continue loop
    animationFrameId = requestAnimationFrame(update);
  }

  /**
   * Start audio analysis and reactive control
   */
  async function start(): Promise<void> {
    try {
      console.log('[AudioReactiveController] Starting...');
      
      // Start analyzer (will request mic permission)
      await analyzer.start();
      
      // Start update loop
      lastUpdateTime = 0;
      animationFrameId = requestAnimationFrame(update);
      
      console.log('[AudioReactiveController] Started successfully');
    } catch (error) {
      console.error('[AudioReactiveController] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop audio analysis and reactive control
   */
  function stop(): void {
    console.log('[AudioReactiveController] Stopping...');

    // Stop update loop
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    // Stop analyzer
    analyzer.stop();

    // Reset mapper
    mapper.reset();

    console.log('[AudioReactiveController] Stopped');
  }

  /**
   * Set tempo (BPM)
   */
  function setTempo(bpm: number): void {
    analyzer.setTempo(bpm);
  }

  /**
   * Set audio-visual offset (latency compensation)
   */
  function setOffset(ms: number): void {
    analyzer.setOffset(ms);
  }

  /**
   * Get current audio signals
   */
  function getSignals(): AudioSignals | null {
    if (!analyzer.isActive()) {
      return null;
    }
    return analyzer.getSignals();
  }

  /**
   * Check if audio-reactive control is running
   */
  function isRunning(): boolean {
    return analyzer.isActive();
  }

  // Return public API
  return {
    start,
    stop,
    setTempo,
    setOffset,
    getSignals,
    isRunning
  };
}
