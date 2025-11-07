import { DNAVector, DNAFrame, interpolateDNA, applyAudioReactivity } from './dna';
import type { AudioAnalysis } from '@shared/schema';

export type MorphPhase = 'hold' | 'morph';

export interface MorphState {
  phase: MorphPhase;
  currentFrameIndex: number;
  nextFrameIndex: number;
  phaseProgress: number;
  totalProgress: number;
  currentDNA: DNAVector;
}

export class MorphEngine {
  private frames: DNAFrame[] = [];
  private currentIndex: number = 0;
  private phaseStartTime: number = 0;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  
  private readonly HOLD_DURATION = 60000; // 1 minute pure static
  private readonly RAMP_DURATION = 30000; // 30 seconds to ramp up effects
  private readonly MORPH_DURATION = 240000; // 4 minutes morph
  private readonly TOTAL_CYCLE = 300000; // 5 minutes total

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
      };
    }

    let elapsed = Date.now() - this.phaseStartTime;
    
    // CRITICAL FIX: Advance frame BEFORE applying modulo
    // This ensures phaseProgress reaches 1.0 before cycling back
    if (elapsed >= this.TOTAL_CYCLE && this.frames.length > 1) {
      this.currentIndex = (this.currentIndex + 1) % this.frames.length;
      this.phaseStartTime = Date.now();
      elapsed = 0;
      console.log(`[MorphEngine] Advanced to frame ${this.currentIndex} (cycle complete)`);
    }
    
    const cyclePosition = elapsed;

    let phase: MorphPhase;
    let phaseProgress: number;
    let currentDNA: DNAVector;

    if (cyclePosition < this.HOLD_DURATION) {
      // Pure hold phase: completely static, no effects
      phase = 'hold';
      phaseProgress = cyclePosition / this.HOLD_DURATION;
      currentDNA = [...currentFrame.dnaVector];
    } else {
      // Morph phase: interpolate between frames
      phase = 'morph';
      const morphElapsed = cyclePosition - this.HOLD_DURATION;
      phaseProgress = Math.min(morphElapsed / this.MORPH_DURATION, 1.0);

      if (nextFrame && nextFrame.dnaVector) {
        currentDNA = interpolateDNA(
          currentFrame.dnaVector,
          nextFrame.dnaVector,
          phaseProgress
        );
      } else {
        currentDNA = [...currentFrame.dnaVector];
      }
    }

    // Apply audio reactivity with intensity ramp-up
    if (audioAnalysis) {
      let audioIntensity = 0;
      
      if (cyclePosition < this.HOLD_DURATION) {
        // Hold phase: no audio effects (completely static)
        audioIntensity = 0;
      } else if (cyclePosition < this.HOLD_DURATION + this.RAMP_DURATION) {
        // Ramp-up phase: gradually increase from 0 to 1 over 30 seconds
        const rampElapsed = cyclePosition - this.HOLD_DURATION;
        audioIntensity = rampElapsed / this.RAMP_DURATION;
      } else {
        // Full morph phase: full audio reactivity
        audioIntensity = 1.0;
      }

      if (audioIntensity > 0) {
        // Scale the audio analysis by intensity before applying
        const scaledAnalysis = {
          bassLevel: audioAnalysis.bassLevel * audioIntensity,
          amplitude: audioAnalysis.amplitude * audioIntensity,
          tempo: audioAnalysis.tempo,
          trebleLevel: audioAnalysis.trebleLevel * audioIntensity,
        };
        currentDNA = applyAudioReactivity(currentDNA, scaledAnalysis);
      }
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
