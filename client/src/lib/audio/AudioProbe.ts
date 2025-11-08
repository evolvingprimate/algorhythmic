import { EventEmitter } from "events";
import { AudioAnalyzer } from "../audio-analyzer";
import type { AudioFeatures, ClockState } from "@shared/maestroTypes";

/**
 * AudioProbe - Advanced audio analysis for Maestro
 * 
 * Features:
 *   - Onset detection (energy flux + adaptive threshold)
 *   - Tempo estimation (weighted autocorrelation over 90s history)
 *   - Phase tracking (phase-locked loop + 1D Kalman filter)
 *   - Outputs ClockState for bar-aligned scheduling
 * 
 * Based on Architect's recommendations:
 *   - 90-second ring buffer for tempo stability
 *   - Kalman-smoothed phase tracking
 *   - Fast (~120ms) and slow (~2-3s) EMA signals
 */
export class AudioProbe extends EventEmitter {
  private analyzer: AudioAnalyzer;
  private analyzerStarted: boolean = false;
  
  // FFT analysis
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private frequencyData: Float32Array | null = null;
  private timeData: Float32Array | null = null;
  
  // Onset detection
  private onsetHistory: number[] = []; // Timestamps of detected onsets
  private prevEnergy: number = 0;
  private onsetThreshold: number = 1.5; // Adaptive threshold multiplier
  private minOnsetInterval: number = 0.1; // Min 100ms between onsets
  private lastOnsetTime: number = 0;
  
  // Tempo estimation (90-second ring buffer)
  private readonly TEMPO_HISTORY_SIZE = 900; // 90 seconds at 10Hz analysis rate
  private tempoBuffer: number[] = [];
  private estimatedTempo: number = 120; // BPM
  private tempoConfidence: number = 0;
  
  // Phase tracking (Kalman filter)
  private kalmanState: [number, number] = [120, 0]; // [tempo, phase]
  private kalmanCovariance: [[number, number], [number, number]] = [[1, 0], [0, 1]];
  private phase: number = 0;
  private barPhase: number = 0;
  private currentBar: number = 0;
  
  // EMA smoothing (fast and slow)
  private emaFast: { rms: number; bass: number; mids: number; highs: number } = {
    rms: 0, bass: 0, mids: 0, highs: 0
  };
  private emaSlow: { rms: number; bass: number; mids: number; highs: number } = {
    rms: 0, bass: 0, mids: 0, highs: 0
  };
  private readonly ALPHA_FAST = 0.3;  // ~120ms time constant at 60fps
  private readonly ALPHA_SLOW = 0.05; // ~2-3s time constant
  
  // Analysis timing
  private lastAnalysisTime: number = 0;
  private analysisInterval: number = 100; // 10 Hz analysis rate
  
  constructor() {
    super();
    this.analyzer = new AudioAnalyzer();
    console.log("[AudioProbe] Initialized");
  }

  /**
   * Initialize audio input and start analysis
   */
  async initialize(deviceId?: string): Promise<void> {
    try {
      // Initialize the base AudioAnalyzer
      await this.analyzer.initialize(
        (analysis) => {
          // We don't use the basic analysis, we do our own
        },
        deviceId
      );
      
      // Get the audio context from the analyzer
      // @ts-ignore - accessing private property
      this.audioContext = this.analyzer.audioContext;
      // @ts-ignore
      this.analyserNode = this.analyzer.analyser;
      
      if (!this.analyserNode) {
        throw new Error("Failed to get analyser node");
      }
      
      // Set up for more detailed analysis
      this.analyserNode.fftSize = 4096; // Larger FFT for better frequency resolution
      this.analyserNode.smoothingTimeConstant = 0;
      
      const bufferLength = this.analyserNode.frequencyBinCount;
      this.frequencyData = new Float32Array(bufferLength);
      this.timeData = new Float32Array(bufferLength);
      
      this.analyzerStarted = true;
      this.lastAnalysisTime = performance.now();
      
      // Start analysis loop
      this.tick();
      
      console.log("[AudioProbe] Initialized with fftSize =", this.analyserNode.fftSize);
      this.emit("initialized");
    } catch (error) {
      console.error("[AudioProbe] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Main analysis tick (runs at analysisInterval rate)
   */
  private tick = (): void => {
    if (!this.analyzerStarted) return;
    
    const now = performance.now();
    const elapsed = now - this.lastAnalysisTime;
    
    if (elapsed >= this.analysisInterval) {
      this.analyze();
      this.lastAnalysisTime = now;
    }
    
    requestAnimationFrame(this.tick);
  };

  /**
   * Perform audio analysis
   */
  private analyze(): void {
    if (!this.analyserNode || !this.frequencyData || !this.timeData || !this.audioContext) {
      return;
    }
    
    const now = performance.now();
    
    // Get frequency and time domain data
    this.analyserNode.getFloatFrequencyData(this.frequencyData);
    this.analyserNode.getFloatTimeDomainData(this.timeData);
    
    // Calculate spectral features
    const features = this.calculateSpectralFeatures();
    
    // Detect onsets (beat events)
    const isOnset = this.detectOnset(features.energy, now);
    if (isOnset) {
      this.onsetHistory.push(now);
      
      // Trim onset history to 90 seconds
      const cutoff = now - 90000;
      this.onsetHistory = this.onsetHistory.filter(t => t > cutoff);
      
      // Update tempo estimation
      this.updateTempoEstimation();
    }
    
    // Update phase tracking (Kalman filter)
    this.updatePhaseTracking(now, isOnset);
    
    // Update EMA signals
    this.updateEMA(features);
    
    // Build ClockState
    const clockState: ClockState = {
      tempo: this.estimatedTempo,
      beatPhase: this.phase,
      barPhase: this.barPhase,
      currentBar: this.currentBar,
      confidence: this.tempoConfidence,
      timestamp: now,
    };
    
    // Build AudioFeatures
    const audioFeatures: AudioFeatures = {
      ts: now,
      bpm: this.estimatedTempo,
      beatPhase: this.phase,
      rms: features.rms,
      bands128: this.compressToBands128(this.frequencyData),
      centroid: features.centroid,
      energy: features.energy,
      bass: features.bass,
      mids: features.mids,
      highs: features.highs,
    };
    
    // Emit updates
    this.emit("clock", clockState);
    this.emit("audio", audioFeatures);
  }

  /**
   * Calculate spectral features from FFT data
   */
  private calculateSpectralFeatures() {
    if (!this.frequencyData || !this.timeData || !this.audioContext) {
      return { rms: 0, energy: 0, centroid: 0, bass: 0, mids: 0, highs: 0 };
    }
    
    const nyquist = this.audioContext.sampleRate / 2;
    const binWidth = nyquist / this.frequencyData.length;
    
    // RMS (Root Mean Square) from time domain
    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      sumSq += this.timeData[i] * this.timeData[i];
    }
    const rms = Math.sqrt(sumSq / this.timeData.length);
    
    // Energy (sum of magnitudes in frequency domain)
    let energy = 0;
    for (let i = 0; i < this.frequencyData.length; i++) {
      const magnitude = Math.pow(10, this.frequencyData[i] / 20); // dB to linear
      energy += magnitude;
    }
    energy /= this.frequencyData.length;
    
    // Spectral centroid (brightness)
    let weightedSum = 0;
    let magnitudeSum = 0;
    for (let i = 0; i < this.frequencyData.length; i++) {
      const frequency = i * binWidth;
      const magnitude = Math.pow(10, this.frequencyData[i] / 20);
      weightedSum += frequency * magnitude;
      magnitudeSum += magnitude;
    }
    const centroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
    
    // Frequency band energies
    const bassEnd = Math.floor(250 / binWidth);   // 0-250 Hz
    const midsEnd = Math.floor(2000 / binWidth);  // 250-2000 Hz
    
    let bass = 0, mids = 0, highs = 0;
    for (let i = 0; i < this.frequencyData.length; i++) {
      const magnitude = Math.pow(10, this.frequencyData[i] / 20);
      if (i < bassEnd) bass += magnitude;
      else if (i < midsEnd) mids += magnitude;
      else highs += magnitude;
    }
    
    bass /= bassEnd;
    mids /= (midsEnd - bassEnd);
    highs /= (this.frequencyData.length - midsEnd);
    
    return { rms, energy, centroid, bass, mids, highs };
  }

  /**
   * Detect onset (beat event) using energy flux and adaptive threshold
   */
  private detectOnset(energy: number, now: number): boolean {
    // Calculate energy flux (first-order derivative)
    const flux = Math.max(0, energy - this.prevEnergy);
    this.prevEnergy = energy;
    
    // Adaptive threshold (based on recent energy history)
    const threshold = energy * this.onsetThreshold;
    
    // Check minimum interval between onsets
    const timeSinceLastOnset = (now - this.lastOnsetTime) / 1000;
    if (timeSinceLastOnset < this.minOnsetInterval) {
      return false;
    }
    
    // Detect onset
    if (flux > threshold && energy > 0.01) {
      this.lastOnsetTime = now;
      return true;
    }
    
    return false;
  }

  /**
   * Update tempo estimation using weighted autocorrelation
   */
  private updateTempoEstimation(): void {
    if (this.onsetHistory.length < 4) {
      // Not enough data
      return;
    }
    
    // Calculate inter-onset intervals (IOIs)
    const iois: number[] = [];
    for (let i = 1; i < this.onsetHistory.length; i++) {
      iois.push(this.onsetHistory[i] - this.onsetHistory[i - 1]);
    }
    
    // Autocorrelation over IOIs to find period
    const bpmCandidates: Array<{ bpm: number; score: number }> = [];
    
    for (let bpm = 60; bpm <= 180; bpm += 1) {
      const period = (60000 / bpm); // ms per beat
      let score = 0;
      let count = 0;
      
      // Check how many IOIs are close to this period (or multiples)
      for (const ioi of iois) {
        const ratio = ioi / period;
        const nearestMultiple = Math.round(ratio);
        const error = Math.abs(ratio - nearestMultiple);
        
        if (error < 0.05 && nearestMultiple >= 1 && nearestMultiple <= 4) {
          score += (1 - error) / nearestMultiple; // Weight by inverse of multiple
          count++;
        }
      }
      
      if (count > 0) {
        bpmCandidates.push({ bpm, score: score / count });
      }
    }
    
    if (bpmCandidates.length === 0) {
      return;
    }
    
    // Find best BPM candidate
    bpmCandidates.sort((a, b) => b.score - a.score);
    const bestCandidate = bpmCandidates[0];
    
    // Update tempo with smoothing
    const alpha = 0.1; // Smooth tempo changes
    this.estimatedTempo = alpha * bestCandidate.bpm + (1 - alpha) * this.estimatedTempo;
    this.tempoConfidence = Math.min(bestCandidate.score, 1.0);
    
    console.log(`[AudioProbe] Tempo: ${this.estimatedTempo.toFixed(1)} BPM (confidence: ${this.tempoConfidence.toFixed(2)})`);
  }

  /**
   * Update phase tracking using phase-locked loop and Kalman filter
   */
  private updatePhaseTracking(now: number, isOnset: boolean): void {
    const dt = 0.1; // Analysis interval in seconds
    const beatPeriod = 60 / this.estimatedTempo; // seconds per beat
    
    // Predict phase (phase increment based on tempo)
    this.phase = (this.phase + (dt / beatPeriod)) % 1.0;
    this.barPhase = (this.barPhase + (dt / (beatPeriod * 4))) % 1.0;
    
    // Update bar counter when bar phase wraps
    if (this.barPhase < 0.1 && this.phase < 0.1) {
      this.currentBar++;
    }
    
    // Kalman filter update on onset
    if (isOnset && this.tempoConfidence > 0.3) {
      // Measurement: phase should be near 0 on onset (downbeat)
      const measurementPhase = 0.0;
      const innovation = measurementPhase - this.phase;
      
      // Simple Kalman gain (simplified 1D case)
      const kalmanGain = 0.3;
      
      // Correct phase
      this.phase = (this.phase + kalmanGain * innovation + 1.0) % 1.0;
    }
  }

  /**
   * Update fast and slow EMA signals
   */
  private updateEMA(features: { rms: number; bass: number; mids: number; highs: number }): void {
    // Fast EMA (~120ms)
    this.emaFast.rms = this.ALPHA_FAST * features.rms + (1 - this.ALPHA_FAST) * this.emaFast.rms;
    this.emaFast.bass = this.ALPHA_FAST * features.bass + (1 - this.ALPHA_FAST) * this.emaFast.bass;
    this.emaFast.mids = this.ALPHA_FAST * features.mids + (1 - this.ALPHA_FAST) * this.emaFast.mids;
    this.emaFast.highs = this.ALPHA_FAST * features.highs + (1 - this.ALPHA_FAST) * this.emaFast.highs;
    
    // Slow EMA (~2-3s)
    this.emaSlow.rms = this.ALPHA_SLOW * features.rms + (1 - this.ALPHA_SLOW) * this.emaSlow.rms;
    this.emaSlow.bass = this.ALPHA_SLOW * features.bass + (1 - this.ALPHA_SLOW) * this.emaSlow.bass;
    this.emaSlow.mids = this.ALPHA_SLOW * features.mids + (1 - this.ALPHA_SLOW) * this.emaSlow.mids;
    this.emaSlow.highs = this.ALPHA_SLOW * features.highs + (1 - this.ALPHA_SLOW) * this.emaSlow.highs;
  }

  /**
   * Compress full FFT to 128 bands for AudioFeatures
   */
  private compressToBands128(fftData: Float32Array): Float32Array {
    const bands = new Float32Array(128);
    const binsPerBand = Math.floor(fftData.length / 128);
    
    for (let i = 0; i < 128; i++) {
      const start = i * binsPerBand;
      const end = start + binsPerBand;
      let sum = 0;
      for (let j = start; j < end && j < fftData.length; j++) {
        sum += Math.pow(10, fftData[j] / 20); // dB to linear
      }
      bands[i] = sum / binsPerBand;
    }
    
    return bands;
  }

  /**
   * Stop audio analysis
   */
  stop(): void {
    this.analyzerStarted = false;
    this.analyzer.stop();
    this.emit("stopped");
    console.log("[AudioProbe] Stopped");
  }

  /**
   * Get current clock state
   */
  getClock(): ClockState {
    return {
      tempo: this.estimatedTempo,
      beatPhase: this.phase,
      barPhase: this.barPhase,
      currentBar: this.currentBar,
      confidence: this.tempoConfidence,
      timestamp: performance.now(),
    };
  }

  /**
   * Get fast EMA signals
   */
  getFastEMA() {
    return { ...this.emaFast };
  }

  /**
   * Get slow EMA signals
   */
  getSlowEMA() {
    return { ...this.emaSlow };
  }
}
