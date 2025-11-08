/**
 * Audio-Reactive Mapper
 * Maps audio signals to MorphEngine controls with tasteful defaults
 */

import type { MorphEngine, MorphControls } from '../morphEngine';
import type { AudioSignals } from './AudioAnalyzer';

// Utility functions
function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class AudioReactiveMapper {
  private lastUpdateTime: number = 0;

  /**
   * Update MorphEngine controls based on audio signals
   */
  update(engine: MorphEngine, audio: AudioSignals, deltaTimeSeconds: number): void {
    const controls = engine.controls;
    const now = performance.now();

    // Track delta time
    if (this.lastUpdateTime === 0) {
      this.lastUpdateTime = now;
    }
    const dt = (now - this.lastUpdateTime) / 1000; // seconds
    this.lastUpdateTime = now;

    // ========================================================================
    // 1. Progress Control: Beat-quantized nudges (not volume-driven)
    // ========================================================================

    controls.tRate = clamp(
      controls.tRateBase + 0.0,
      -controls.caps.maxTRate,
      controls.caps.maxTRate
    );

    // On beat edge, nudge progress
    if (audio.beatPulse > 0.5) {
      controls.t = clamp01(controls.t + controls.tBeatNudge);
    }

    // ========================================================================
    // 2. Warping Intensity: Micro-displacement from loudness envelope
    // ========================================================================

    // dispAmp scales with RMS envelope (0.003 -> 0.012)
    controls.dispAmp = clamp(
      lerp(0.003, 0.012, audio.rmsSlow),
      0,
      controls.caps.maxDispAmp
    );

    // Background displacement is half of foreground
    controls.bgDispAmp = 0.5 * controls.dispAmp;

    // ========================================================================
    // 3. Edge Hiding: Feather scales with loudness
    // ========================================================================

    controls.seamFeather = 1.0 + 0.8 * audio.rmsSlow;

    // ========================================================================
    // 4. Mode Flavor: Controlled by spectral centroid
    // ========================================================================

    // TPS lambda varies ±15% based on brightness
    const lambdaBase = 0.02;
    const lambdaVariation = (audio.centroid - 0.5) * 0.3; // ±15%
    controls.tpsLambda = clamp(
      lambdaBase * (1.0 + lambdaVariation),
      0.01,
      0.03
    );

    // Mesh sharpen spikes on beats, scaled by centroid
    controls.meshSharpen = clamp(
      0.15 * audio.centroid * audio.beatPulse,
      0,
      controls.caps.maxSharpen
    );

    // ========================================================================
    // 5. Apply tRate to progress
    // ========================================================================

    controls.t = clamp01(controls.t + controls.tRate * dt);

    // ========================================================================
    // 6. Safety: Enforce hard caps
    // ========================================================================

    controls.dispAmp = Math.min(controls.dispAmp, controls.caps.maxDispAmp);
    controls.tRate = clamp(controls.tRate, -controls.caps.maxTRate, controls.caps.maxTRate);
    controls.meshSharpen = Math.min(controls.meshSharpen, controls.caps.maxSharpen);
  }

  /**
   * Reset mapper state
   */
  reset(): void {
    this.lastUpdateTime = 0;
  }
}
