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
  
  private readonly HOLD_DURATION = 60000;
  private readonly MORPH_DURATION = 240000;
  private readonly TOTAL_CYCLE = 300000;

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

    const elapsed = Date.now() - this.phaseStartTime;
    const cyclePosition = elapsed % this.TOTAL_CYCLE;

    let phase: MorphPhase;
    let phaseProgress: number;
    let currentDNA: DNAVector;

    if (cyclePosition < this.HOLD_DURATION) {
      phase = 'hold';
      phaseProgress = cyclePosition / this.HOLD_DURATION;
      currentDNA = [...currentFrame.dnaVector];
    } else {
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

      if (phaseProgress >= 1.0 && this.frames.length > 1) {
        this.currentIndex = (this.currentIndex + 1) % this.frames.length;
        this.phaseStartTime = Date.now();
        console.log(`[MorphEngine] Advanced to frame ${this.currentIndex}`);
      }
    }

    if (audioAnalysis) {
      currentDNA = applyAudioReactivity(currentDNA, audioAnalysis);
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
