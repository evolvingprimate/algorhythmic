import type { AudioAnalysis } from '@shared/schema';
import type { DNAVector } from './dna';

export interface EffectFrame {
  timestamp: number;
  frame: number;
  zoomLevel: number;
  parallaxStrength: number;
  burnIntensity: number;
  morphProgress: number;
  frameAOpacity: number;
  frameBOpacity: number;
  activeEffects: {
    trace: boolean;
    traceIntensity: number;
    bloom: boolean;
    bloomIntensity: number;
    chromaticDrift: boolean;
    chromaticDriftIntensity: number;
    particles: boolean;
    particleDensity: number;
    kenBurns: boolean;
    kenBurnsMaxZoom: number;
  };
  audioAnalysis: {
    bassLevel: number;
    trebleLevel: number;
    amplitude: number;
    tempo: number;
    frequency: number;
  } | null;
  dna: number[];
  imageUrls: {
    frameA: string | null;
    frameB: string | null;
  };
}

export class EffectLogger {
  private frames: EffectFrame[] = [];
  private frameCount = 0;
  private sessionStartTime = Date.now();
  private maxFrames = 1000; // Keep last 1000 frames (at 60fps = ~16 seconds)

  logFrame(data: {
    zoomLevel: number;
    parallaxStrength: number;
    burnIntensity: number;
    morphProgress: number;
    frameAOpacity: number;
    frameBOpacity: number;
    activeEffects: EffectFrame['activeEffects'];
    audioAnalysis: AudioAnalysis | null;
    dna: DNAVector;
    imageUrls: { frameA: string | null; frameB: string | null };
  }) {
    const frame: EffectFrame = {
      timestamp: Date.now() - this.sessionStartTime,
      frame: this.frameCount++,
      zoomLevel: data.zoomLevel,
      parallaxStrength: data.parallaxStrength,
      burnIntensity: data.burnIntensity,
      morphProgress: data.morphProgress,
      frameAOpacity: data.frameAOpacity,
      frameBOpacity: data.frameBOpacity,
      activeEffects: data.activeEffects,
      audioAnalysis: data.audioAnalysis ? {
        bassLevel: data.audioAnalysis.bassLevel,
        trebleLevel: data.audioAnalysis.trebleLevel,
        amplitude: data.audioAnalysis.amplitude,
        tempo: data.audioAnalysis.tempo,
        frequency: data.audioAnalysis.frequency,
      } : null,
      dna: Array.isArray(data.dna) ? data.dna : [],
      imageUrls: data.imageUrls,
    };

    this.frames.push(frame);

    // Keep only last maxFrames
    if (this.frames.length > this.maxFrames) {
      this.frames.shift();
    }
  }

  getFrames(): EffectFrame[] {
    return [...this.frames];
  }

  downloadLogs(filename?: string) {
    const logData = {
      sessionStart: this.sessionStartTime,
      sessionDuration: Date.now() - this.sessionStartTime,
      totalFrames: this.frameCount,
      capturedFrames: this.frames.length,
      frames: this.frames,
      metadata: {
        userAgent: navigator.userAgent,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        pixelRatio: window.devicePixelRatio,
        timestamp: new Date().toISOString(),
      },
    };

    const blob = new Blob([JSON.stringify(logData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `algorhythmic-effects-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  clear() {
    this.frames = [];
    this.frameCount = 0;
    this.sessionStartTime = Date.now();
  }

  getStats() {
    if (this.frames.length === 0) {
      return null;
    }

    const recentFrames = this.frames.slice(-60); // Last 60 frames (~1 second)
    const avgZoom = recentFrames.reduce((sum, f) => sum + f.zoomLevel, 0) / recentFrames.length;
    const maxZoom = Math.max(...recentFrames.map(f => f.zoomLevel));
    const minZoom = Math.min(...recentFrames.map(f => f.zoomLevel));

    return {
      totalFrames: this.frameCount,
      capturedFrames: this.frames.length,
      avgZoom,
      maxZoom,
      minZoom,
      zoomRange: maxZoom - minZoom,
      effectUsage: {
        trace: recentFrames.filter(f => f.activeEffects.trace).length / recentFrames.length,
        bloom: recentFrames.filter(f => f.activeEffects.bloom).length / recentFrames.length,
        chromaticDrift: recentFrames.filter(f => f.activeEffects.chromaticDrift).length / recentFrames.length,
        particles: recentFrames.filter(f => f.activeEffects.particles).length / recentFrames.length,
        kenBurns: recentFrames.filter(f => f.activeEffects.kenBurns).length / recentFrames.length,
      },
    };
  }
}
