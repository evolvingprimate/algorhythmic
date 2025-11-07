import { DNAVector, DNAFrame, interpolateDNA, applyAudioReactivity, smoothstepBellCurve, sigmoid } from './dna';
import type { AudioAnalysis } from '@shared/schema';

export type MorphPhase = 'hold' | 'ramp' | 'morph';

export interface MorphState {
  phase: MorphPhase;
  currentFrameIndex: number;
  nextFrameIndex: number;
  phaseProgress: number;
  totalProgress: number;
  currentDNA: DNAVector;
  morphProgress: number;
  audioIntensity: number;
  frameForeshadowMix: number;
}

export class MorphEngine {
  private frames: DNAFrame[] = [];
  private currentIndex: number = 0;
  private phaseStartTime: number = 0;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  
  private readonly HOLD_DURATION = 60000; // 1 minute pure static (60s)
  private readonly RAMP_DURATION = 30000; // 30 seconds to ramp up effects (30s)
  private readonly MORPH_DURATION = 210000; // 3.5 minutes morph (210s)
  private readonly TOTAL_CYCLE = 300000; // 5 minutes total (60+30+210=300s)

  constructor() {
    this.phaseStartTime = Date.now();
  }

  addFrame(frame: DNAFrame): void {
    this.frames.push(frame);
    console.log(`[MorphEngine] Added frame. Total frames: ${this.frames.length}`);
  }

  getFrameCount(): number {
    return this.frames.length;
  }

  getCurrentFrame(): DNAFrame | null {
    if (this.frames.length === 0) return null;
    return this.frames[this.currentIndex] || null;
  }

  getNextFrame(): DNAFrame | null {
    if (this.frames.length < 2) return null;
    const nextIndex = (this.currentIndex + 1) % this.frames.length;
    return this.frames[nextIndex] || null;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.phaseStartTime = Date.now();
    console.log('[MorphEngine] Started');
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    console.log('[MorphEngine] Stopped');
  }

  reset(): void {
    this.frames = [];
    this.currentIndex = 0;
    this.phaseStartTime = Date.now();
    this.stop();
    console.log('[MorphEngine] Reset');
  }

  getMorphState(audioAnalysis?: AudioAnalysis): MorphState {
    if (this.frames.length === 0) {
      return {
        phase: 'hold',
        currentFrameIndex: 0,
        nextFrameIndex: 0,
        phaseProgress: 0,
        totalProgress: 0,
        currentDNA: Array(50).fill(0.5),
        morphProgress: 0,
        audioIntensity: 0,
        frameForeshadowMix: 0,
      };
    }

    const currentFrame = this.getCurrentFrame();
    const nextFrame = this.getNextFrame();
    
    if (!currentFrame) {
      return {
        phase: 'hold',
        currentFrameIndex: 0,
        nextFrameIndex: 0,
        phaseProgress: 0,
        totalProgress: 0,
        currentDNA: Array(50).fill(0.5),
        morphProgress: 0,
        audioIntensity: 0,
        frameForeshadowMix: 0,
      };
    }

    let elapsed = Date.now() - this.phaseStartTime;
    const cyclePosition = Math.min(elapsed, this.TOTAL_CYCLE); // Cap at TOTAL_CYCLE for final state
    
    // Advance frame AFTER computing state (allows morphProgress to reach 1.0)
    if (elapsed >= this.TOTAL_CYCLE && this.frames.length > 1) {
      // Set elapsed to TOTAL_CYCLE for this frame, then advance on next call
      if (elapsed > this.TOTAL_CYCLE + 100) { // 100ms grace period for final state
        this.currentIndex = (this.currentIndex + 1) % this.frames.length;
        this.phaseStartTime = Date.now();
        console.log(`[MorphEngine] Advanced to frame ${this.currentIndex} (cycle complete)`);
      }
    }

    let phase: MorphPhase;
    let phaseProgress: number;
    let audioIntensity: number = 0;
    let morphProgress: number = 0;
    let frameForeshadowMix: number = 0;
    let currentDNA: DNAVector;

    if (cyclePosition < this.HOLD_DURATION) {
      // Pure hold phase: completely static, no effects (60s pristine viewing)
      phase = 'hold';
      phaseProgress = cyclePosition / this.HOLD_DURATION;
      audioIntensity = 0;
      morphProgress = 0;
      frameForeshadowMix = 0;
      currentDNA = [...currentFrame.dnaVector];
      
    } else if (cyclePosition < this.HOLD_DURATION + this.RAMP_DURATION) {
      // Ramp-up phase: effects activate using bell-curve sigmoid (30s)
      phase = 'ramp';
      const rampElapsed = cyclePosition - this.HOLD_DURATION;
      const rawRampProgress = rampElapsed / this.RAMP_DURATION;
      
      // Use sigmoid for smooth bell-curve ramp-up
      phaseProgress = sigmoid(rawRampProgress, 8);
      audioIntensity = phaseProgress;
      morphProgress = 0;
      frameForeshadowMix = 0;
      currentDNA = [...currentFrame.dnaVector];
      
    } else {
      // Full morph phase: blend from frame A to frame B (210s)
      phase = 'morph';
      const morphElapsed = cyclePosition - this.HOLD_DURATION - this.RAMP_DURATION;
      const rawMorphProgress = Math.min(morphElapsed / this.MORPH_DURATION, 1.0);
      
      // Apply double-smoothstep for bell-curve feel
      morphProgress = smoothstepBellCurve(rawMorphProgress);
      phaseProgress = rawMorphProgress;
      audioIntensity = 1.0;
      
      // Frame foreshadowing: Start showing next frame at 20% into the blend
      if (rawMorphProgress >= 0.2) {
        // Map 20%-100% to 0%-100% foreshadow mix
        const foreshadowT = (rawMorphProgress - 0.2) / 0.8;
        // Use smoothstepBellCurve to ensure it reaches exactly 1.0
        frameForeshadowMix = smoothstepBellCurve(foreshadowT);
      } else {
        frameForeshadowMix = 0;
      }

      if (nextFrame && nextFrame.dnaVector) {
        currentDNA = interpolateDNA(
          currentFrame.dnaVector,
          nextFrame.dnaVector,
          morphProgress
        );
      } else {
        currentDNA = [...currentFrame.dnaVector];
      }
    }

    // Apply audio reactivity with smooth intensity scaling
    if (audioAnalysis && audioIntensity > 0) {
      // Scale the audio analysis by intensity before applying
      const scaledAnalysis = {
        bassLevel: audioAnalysis.bassLevel * audioIntensity,
        amplitude: audioAnalysis.amplitude * audioIntensity,
        tempo: audioAnalysis.tempo,
        trebleLevel: audioAnalysis.trebleLevel * audioIntensity,
      };
      currentDNA = applyAudioReactivity(currentDNA, scaledAnalysis);
    }

    const totalProgress = cyclePosition / this.TOTAL_CYCLE;
    const nextIndex = this.frames.length > 1 
      ? (this.currentIndex + 1) % this.frames.length 
      : this.currentIndex;

    return {
      phase,
      currentFrameIndex: this.currentIndex,
      nextFrameIndex: nextIndex,
      phaseProgress,
      totalProgress,
      currentDNA,
      morphProgress,
      audioIntensity,
      frameForeshadowMix,
    };
  }

  getDebugInfo(): {
    frameCount: number;
    currentIndex: number;
    isRunning: boolean;
    phaseStartTime: number;
  } {
    return {
      frameCount: this.frames.length,
      currentIndex: this.currentIndex,
      isRunning: this.isRunning,
      phaseStartTime: this.phaseStartTime,
    };
  }
}
