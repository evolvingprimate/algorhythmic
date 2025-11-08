import type { AudioFeatures, ClockState } from "@shared/maestroTypes";

/**
 * Climax detection result
 */
export interface ClimaxDetection {
  isClimax: boolean;
  climaxScore: number;        // 0-1, current climax probability
  sustainedEnergyDuration: number;  // Seconds of sustained high energy
  onsetDensity: number;      // Recent onset density (0-1)
  reason?: string;           // Human-readable reason for climax detection
}

/**
 * ClimaxDetector - Detects rare musical crescendo/climax moments
 * 
 * Strategy:
 *   - Sustained high energy (RMS > 0.8 for 4+ seconds)
 *   - High onset density (many rapid beats)
 *   - Beat confidence spike
 *   - Spectral centroid rise (brightness increase)
 * 
 * Design:
 *   - "Cherry on top, not a very cake" philosophy
 *   - Rare triggers (24-bar cooldown minimum)
 *   - Multi-factor analysis to avoid false positives
 *   - Configurable thresholds via MaestroControlStore
 */
export class ClimaxDetector {
  private sustainedEnergyStart: number = 0;
  private recentOnsets: number[] = [];
  private readonly ONSET_WINDOW_MS = 2000; // 2 second window for onset density
  private readonly ENERGY_THRESHOLD = 0.75; // RMS threshold for "high energy"
  private readonly SUSTAINED_DURATION_MS = 4000; // 4 seconds of sustained energy
  private readonly HIGH_ONSET_DENSITY = 8; // 8+ onsets in 2s = high density
  
  // Previous frame data for edge detection
  private prevEnergy: number = 0;
  private prevCentroid: number = 0;
  
  constructor() {
    console.log("[ClimaxDetector] Initialized with 4s sustained energy + onset density analysis");
  }

  /**
   * Analyze current audio state for climax detection
   * 
   * @param audio - Current audio features
   * @param clock - Current clock state
   * @param onsetDetected - Whether an onset was just detected this frame
   * @returns Climax detection result
   */
  analyze(
    audio: AudioFeatures,
    clock: ClockState | null,
    onsetDetected: boolean
  ): ClimaxDetection {
    const now = performance.now();
    
    // Track onsets for density calculation
    if (onsetDetected) {
      this.recentOnsets.push(now);
    }
    
    // Clean old onsets outside the window
    this.recentOnsets = this.recentOnsets.filter(
      time => now - time < this.ONSET_WINDOW_MS
    );
    
    // Calculate onset density
    const onsetDensity = this.recentOnsets.length / this.HIGH_ONSET_DENSITY;
    
    // Check for sustained high energy
    const isHighEnergy = audio.rms > this.ENERGY_THRESHOLD;
    
    if (isHighEnergy && this.sustainedEnergyStart === 0) {
      // Start of sustained energy period
      this.sustainedEnergyStart = now;
    } else if (!isHighEnergy) {
      // Energy dropped, reset
      this.sustainedEnergyStart = 0;
    }
    
    const sustainedEnergyDuration = this.sustainedEnergyStart > 0
      ? now - this.sustainedEnergyStart
      : 0;
    
    // Check for spectral centroid rise (brightness increase = more intensity)
    const centroidRise = audio.centroid - this.prevCentroid;
    const isBrightnessIncrease = centroidRise > 0.1;
    
    // Check for energy spike (sudden increase)
    const energySpike = audio.rms - this.prevEnergy;
    const isEnergySpike = energySpike > 0.2;
    
    // Calculate climax score (0-1)
    let climaxScore = 0;
    let reasons: string[] = [];
    
    // Factor 1: Sustained high energy (weight: 0.4)
    if (sustainedEnergyDuration >= this.SUSTAINED_DURATION_MS) {
      const sustainedBonus = Math.min(sustainedEnergyDuration / 10000, 1.0); // Cap at 10s
      climaxScore += 0.4 * sustainedBonus;
      reasons.push(`sustained energy ${(sustainedEnergyDuration / 1000).toFixed(1)}s`);
    }
    
    // Factor 2: High onset density (weight: 0.3)
    if (onsetDensity > 0.6) {
      climaxScore += 0.3 * Math.min(onsetDensity, 1.0);
      reasons.push(`onset density ${(onsetDensity * 100).toFixed(0)}%`);
    }
    
    // Factor 3: Brightness increase (weight: 0.15)
    if (isBrightnessIncrease) {
      climaxScore += 0.15;
      reasons.push("brightness spike");
    }
    
    // Factor 4: Energy spike (weight: 0.15)
    if (isEnergySpike) {
      climaxScore += 0.15;
      reasons.push("energy spike");
    }
    
    // Factor 5: Beat confidence (weight: bonus multiplier)
    if (clock && clock.confidence > 0.8) {
      climaxScore *= 1.1; // 10% bonus for high confidence
    }
    
    // Climax threshold: need score > 0.85 for true climax
    const isClimax = climaxScore > 0.85;
    
    // Update previous frame data
    this.prevEnergy = audio.rms;
    this.prevCentroid = audio.centroid;
    
    return {
      isClimax,
      climaxScore,
      sustainedEnergyDuration: sustainedEnergyDuration / 1000, // Convert to seconds
      onsetDensity,
      reason: isClimax ? reasons.join(", ") : undefined,
    };
  }

  /**
   * Reset detector state (called when climax is triggered)
   */
  reset(): void {
    this.sustainedEnergyStart = 0;
    this.recentOnsets = [];
    this.prevEnergy = 0;
    this.prevCentroid = 0;
    console.log("[ClimaxDetector] State reset after climax trigger");
  }

  /**
   * Get diagnostic information
   */
  getStats() {
    return {
      sustainedEnergyDuration: this.sustainedEnergyStart > 0 
        ? (performance.now() - this.sustainedEnergyStart) / 1000 
        : 0,
      recentOnsetCount: this.recentOnsets.length,
      onsetDensity: this.recentOnsets.length / this.HIGH_ONSET_DENSITY,
      thresholds: {
        energyThreshold: this.ENERGY_THRESHOLD,
        sustainedDurationMs: this.SUSTAINED_DURATION_MS,
        highOnsetDensity: this.HIGH_ONSET_DENSITY,
      },
    };
  }
}
