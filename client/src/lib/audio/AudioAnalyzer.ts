/**
 * Audio Analyzer Module
 * Extracts music features using Web Audio API (no external dependencies)
 */

export interface AudioSignals {
  rms: number;                // instant loudness, 0..1
  rmsSlow: number;            // smoothed loudness envelope
  peak: number;               // tracked peak for normalization
  centroid: number;           // spectral brightness, 0..1
  beatPulse: number;          // 0..1 short pulse right after each beat
  barBoundary: boolean;       // true once every 4 beats
  tempoBpm: number;           // current tempo
}

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyzerNode: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  
  // Analysis buffers
  private timeData: Float32Array | null = null;
  private freqData: Uint8Array | null = null;
  
  // RMS tracking
  private rmsValue: number = 0;
  private rmsSlowValue: number = 0;
  private peakValue: number = 0.1; // Prevent division by zero
  
  // Centroid tracking
  private centroidValue: number = 0.5;
  
  // Beat quantizer
  private tempoBpm: number = 120;
  private barBeats: number = 4;
  private beatPhase: number = 0;
  private lastBeatTime: number = 0;
  private beatPulseValue: number = 0;
  private lastBarBoundary: boolean = false;
  private audioVisualOffsetMs: number = -50; // Latency compensation
  
  // Smoothing constants
  private readonly RMS_ATTACK_COEF = 0.97; // ~30ms attack
  private readonly RMS_RELEASE_COEF = 0.985; // ~160ms release
  private readonly BEAT_PULSE_DECAY = 6.0; // Exponential decay rate
  
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;

  async start(stream?: MediaStream): Promise<void> {
    if (this.isRunning) {
      console.log('[AudioAnalyzer] Already running');
      return;
    }

    try {
      // Get microphone stream if not provided
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }

      // Create audio context
      this.audioContext = new AudioContext();
      
      // Create analyzer node
      this.analyzerNode = this.audioContext.createAnalyser();
      this.analyzerNode.fftSize = 2048;
      this.analyzerNode.smoothingTimeConstant = 0.8;
      
      // Create source from stream
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.sourceNode.connect(this.analyzerNode);
      
      // Allocate buffers
      this.timeData = new Float32Array(this.analyzerNode.fftSize);
      this.freqData = new Uint8Array(this.analyzerNode.frequencyBinCount);
      
      // Start analysis loop
      this.isRunning = true;
      this.lastBeatTime = this.audioContext.currentTime;
      this.analyze();
      
      console.log('[AudioAnalyzer] Started successfully');
    } catch (error) {
      console.error('[AudioAnalyzer] Failed to start:', error);
      throw error;
    }
  }

  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyzerNode = null;
    this.timeData = null;
    this.freqData = null;

    console.log('[AudioAnalyzer] Stopped');
  }

  private analyze = (): void => {
    if (!this.isRunning || !this.analyzerNode || !this.timeData || !this.freqData) {
      return;
    }

    // Get current time
    const now = this.audioContext!.currentTime;
    const dt = now - this.lastBeatTime;

    // Fetch audio data
    this.analyzerNode.getFloatTimeDomainData(this.timeData);
    this.analyzerNode.getByteFrequencyData(this.freqData);

    // 1. Compute RMS (instant loudness)
    let sumSquares = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      sumSquares += this.timeData[i] * this.timeData[i];
    }
    const rms = Math.sqrt(sumSquares / this.timeData.length);

    // Normalize by peak tracking
    this.peakValue = Math.max(this.peakValue * 0.999, rms); // Slow decay
    this.rmsValue = Math.min(1, rms / this.peakValue);

    // 2. Compute RMS slow (envelope)
    const alpha = this.rmsValue > this.rmsSlowValue 
      ? this.RMS_ATTACK_COEF 
      : this.RMS_RELEASE_COEF;
    this.rmsSlowValue = alpha * this.rmsSlowValue + (1 - alpha) * this.rmsValue;

    // 3. Compute spectral centroid
    let weightedSum = 0;
    let magnitudeSum = 0;
    const nyquist = this.audioContext!.sampleRate / 2;

    for (let i = 0; i < this.freqData.length; i++) {
      const magnitude = this.freqData[i] / 255;
      const frequency = (i / this.freqData.length) * nyquist;
      weightedSum += frequency * magnitude;
      magnitudeSum += magnitude;
    }

    if (magnitudeSum > 0) {
      const centroidHz = weightedSum / magnitudeSum;
      this.centroidValue = Math.min(1, centroidHz / nyquist);
    }

    // 4. Beat quantizer
    const beatInterval = 60 / this.tempoBpm;
    const compensatedTime = now + (this.audioVisualOffsetMs / 1000);
    this.beatPhase = (compensatedTime % beatInterval) / beatInterval;

    // Detect beat edge (phase wraps from ~1 to ~0)
    const beatEdge = this.beatPhase < 0.1 && dt > beatInterval * 0.8;

    if (beatEdge) {
      this.beatPulseValue = 1.0;
      this.lastBeatTime = now;

      // Check for bar boundary (every 4 beats)
      const beatIndex = Math.floor(compensatedTime / beatInterval);
      this.lastBarBoundary = (beatIndex % this.barBeats) === 0;
    } else {
      // Decay beat pulse
      const decayDt = dt * 60; // Convert to frames at 60fps
      this.beatPulseValue *= Math.exp(-decayDt * this.BEAT_PULSE_DECAY / 60);
      this.lastBarBoundary = false;
    }

    // Continue loop
    this.animationFrameId = requestAnimationFrame(this.analyze);
  };

  getSignals(): AudioSignals {
    return {
      rms: this.rmsValue,
      rmsSlow: this.rmsSlowValue,
      peak: this.peakValue,
      centroid: this.centroidValue,
      beatPulse: this.beatPulseValue,
      barBoundary: this.lastBarBoundary,
      tempoBpm: this.tempoBpm
    };
  }

  setTempo(bpm: number): void {
    this.tempoBpm = Math.max(60, Math.min(240, bpm));
    console.log(`[AudioAnalyzer] Tempo set to ${this.tempoBpm} BPM`);
  }

  setOffset(ms: number): void {
    this.audioVisualOffsetMs = ms;
    console.log(`[AudioAnalyzer] Audio-visual offset set to ${ms}ms`);
  }

  getTempo(): number {
    return this.tempoBpm;
  }

  getOffset(): number {
    return this.audioVisualOffsetMs;
  }

  getBeatPhase(): number {
    return this.beatPhase;
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
