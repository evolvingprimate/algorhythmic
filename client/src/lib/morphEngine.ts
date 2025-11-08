import { DNAVector, DNAFrame, interpolateDNA, applyAudioReactivity, smoothstepBellCurve, sigmoid, smootherstep } from './dna';
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
  beatBurst: number; // 0-1 impulse that decays over 180ms
  // DJ Crossfade & Visual Effects
  opacityA: number; // 0-1: Frame A opacity
  opacityB: number; // 0-1: Frame B opacity
  zoomBias: number; // 0-1: Ken Burns zoom (0 at holds, 1 at peak burn)
  parallaxStrength: number; // 0-1: Parallax effect intensity
  burnIntensity: number; // 0-1: Peak "burn" effect intensity
}

export class MorphEngine {
  private frames: DNAFrame[] = [];
  private currentIndex: number = 0;
  private phaseStartTime: number = 0;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  
  // Beat burst tracking
  private lastBeatTime: number = 0;
  private beatBurstValue: number = 0;
  private lastBassLevel: number = 0;
  private readonly BEAT_DECAY_MS = 180; // 180ms decay as per ChatGPT spec
  private readonly BEAT_THRESHOLD = 0.6; // Beat triggers when bass > 0.6
  private readonly BEAT_DELTA_THRESHOLD = 0.1; // AND delta > 0.1
  
  private readonly HOLD_DURATION = 0; // No hold - start immediately
  private readonly RAMP_DURATION = 8000; // 8 seconds to ramp up effects
  private readonly MORPH_DURATION = 292000; // 4:52 minutes morph (292s)
  private readonly TOTAL_CYCLE = 300000; // 5 minutes total (0+8+292=300s)

  constructor() {
    // Don't initialize phaseStartTime until frames are added
    this.phaseStartTime = 0;
  }

  addFrame(frame: DNAFrame): void {
    this.frames.push(frame);
    
    // CRITICAL: Reset timing when first frame is added to prevent starting at 11.6% progress
    if (this.frames.length === 1) {
      this.phaseStartTime = Date.now();
      console.log(`[MorphEngine] First frame added, timing reset to ensure Frame A appears at full opacity`);
    }
    
    console.log(`[MorphEngine] Added frame. Total frames: ${this.frames.length}`);
  }

  getFrameCount(): number {
    return this.frames.length;
  }

  hasFrame(artworkId: string | null): boolean {
    if (!artworkId) return false;
    return this.frames.some(frame => frame.artworkId === artworkId);
  }

  hasImageUrl(imageUrl: string): boolean {
    return this.frames.some(frame => frame.imageUrl === imageUrl);
  }

  pruneOldestFrames(count: number): void {
    if (count <= 0 || this.frames.length === 0) return;
    
    const framesToRemove = Math.min(count, this.frames.length - 2); // Keep at least 2 frames
    if (framesToRemove <= 0) return;
    
    console.log(`[MorphEngine] Pruning ${framesToRemove} oldest frames (current: ${this.frames.length})`);
    
    // Check if we're removing the currently active frame
    const removingActiveFrame = this.currentIndex < framesToRemove;
    
    // Remove from the beginning (oldest frames)
    this.frames.splice(0, framesToRemove);
    
    // Adjust currentIndex
    this.currentIndex = Math.max(0, this.currentIndex - framesToRemove);
    
    // CRITICAL: Reset phase timing if we removed the active frame to prevent jump cuts
    if (removingActiveFrame && this.isRunning) {
      this.phaseStartTime = Date.now();
      console.log(`[MorphEngine] ⚠️ Active frame was pruned - resetting phase timing to prevent jump cut`);
    }
    
    console.log(`[MorphEngine] Pruned ${framesToRemove} frames. Remaining: ${this.frames.length}`);
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
        beatBurst: 0,
        opacityA: 1.0,
        opacityB: 0.0,
        zoomBias: 0.0,
        parallaxStrength: 0.0,
        burnIntensity: 0.0,
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
        beatBurst: 0,
        opacityA: 1.0,
        opacityB: 0.0,
        zoomBias: 0.0,
        parallaxStrength: 0.0,
        burnIntensity: 0.0,
      };
    }

    // CRITICAL: Safety check - if phaseStartTime is 0, reset it now
    if (this.phaseStartTime === 0) {
      this.phaseStartTime = Date.now();
      console.log('[MorphEngine] phaseStartTime was 0, resetting to current time');
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
    
    // DJ Crossfade variables
    let opacityA: number = 1.0;
    let opacityB: number = 0.0;
    let zoomBias: number = 0.0;
    let parallaxStrength: number = 0.0;
    let burnIntensity: number = 0.0;

    if (cyclePosition < this.HOLD_DURATION) {
      // Pure hold phase: completely static, no effects (60s pristine viewing)
      phase = 'hold';
      phaseProgress = cyclePosition / this.HOLD_DURATION;
      audioIntensity = 0;
      morphProgress = 0;
      frameForeshadowMix = 0;
      currentDNA = [...currentFrame.dnaVector];
      
      // DJ Crossfade: Pure Frame A during hold
      opacityA = 1.0;
      opacityB = 0.0;
      zoomBias = 0.0;
      parallaxStrength = 0.0;
      burnIntensity = 0.0;
      
    } else if (cyclePosition < this.HOLD_DURATION + this.RAMP_DURATION) {
      // Ramp-up phase: effects activate using bell-curve sigmoid
      phase = 'ramp';
      const rampElapsed = cyclePosition - this.HOLD_DURATION;
      const rawRampProgress = rampElapsed / this.RAMP_DURATION;
      
      // Use sigmoid for smooth bell-curve ramp-up
      phaseProgress = sigmoid(rawRampProgress, 8);
      audioIntensity = phaseProgress;
      morphProgress = 0;
      frameForeshadowMix = 0;
      currentDNA = [...currentFrame.dnaVector];
      
      // DJ Crossfade: Pure Frame A during ramp, but start gentle Ken Burns zoom
      opacityA = 1.0;
      opacityB = 0.0;
      // Gentle zoom-in during ramp (0 → 0.3)
      zoomBias = smootherstep(rawRampProgress) * 0.3;
      parallaxStrength = 0.0;
      burnIntensity = 0.0;
      
    } else {
      // Full morph phase: DJ-style crossfade from Frame A to Frame B (210s)
      phase = 'morph';
      const morphElapsed = cyclePosition - this.HOLD_DURATION - this.RAMP_DURATION;
      const rawMorphProgress = Math.min(morphElapsed / this.MORPH_DURATION, 1.0);
      
      // Apply double-smoothstep for bell-curve feel
      morphProgress = smoothstepBellCurve(rawMorphProgress);
      phaseProgress = rawMorphProgress;
      audioIntensity = 1.0;
      
      // ====== DJ CROSSFADE CURVE ======
      // Inspired by DJ mixing: HOLD A → BLEND IN → PEAK BURN (50/50) → BLEND OUT → HOLD B
      
      // Use smootherstep for exact 0→1 with gentle holds (6t^5 - 15t^4 + 10t^3)
      const crossfadeProgress = smootherstep(rawMorphProgress);
      
      // Opacity curve: Frame A fades from 1→0, Frame B fades from 0→1
      opacityA = 1.0 - crossfadeProgress;
      opacityB = crossfadeProgress;
      
      // Ken Burns zoom: Continuous from ramp (0.3) → peak (1.0) → end (0)
      // Asymmetric bell curve that starts at ramp's end value
      if (crossfadeProgress < 0.5) {
        // First half: 0.3 → 1.0 (continues from ramp)
        const firstHalfProgress = crossfadeProgress / 0.5; // 0→1
        zoomBias = 0.3 + smootherstep(firstHalfProgress) * 0.7;
      } else {
        // Second half: 1.0 → 0 (smooth return to zero for Frame B)
        const secondHalfProgress = (crossfadeProgress - 0.5) / 0.5; // 0→1
        zoomBias = smootherstep(1.0 - secondHalfProgress);
      }
      
      // Parallax strength: Increases during blend, peaks at burn
      parallaxStrength = zoomBias;
      
      // Burn intensity: Peaks at exact 50/50 crossfade point
      // Maximum intensity when opacityA ≈ opacityB (both near 0.5)
      const blendBalance = 1.0 - Math.abs(opacityA - opacityB);
      burnIntensity = blendBalance * blendBalance; // Squared for sharper peak
      
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

    // ====== BEAT BURST DETECTION ======
    // Detect beats and create smooth impulse decay over 180ms
    const now = Date.now();
    if (audioAnalysis) {
      const bassLevel = audioAnalysis.bassLevel;
      const bassDelta = bassLevel - this.lastBassLevel;
      
      // Beat triggers when bass > 0.6 AND delta > 0.1
      if (bassLevel > this.BEAT_THRESHOLD && bassDelta > this.BEAT_DELTA_THRESHOLD) {
        this.lastBeatTime = now;
        this.beatBurstValue = 1.0; // Impulse peak
      }
      
      this.lastBassLevel = bassLevel;
    }
    
    // Decay beat burst over 180ms with exponential falloff
    // τ = 60ms gives e^(-180/60) = e^(-3) ≈ 0.05 (5% after 180ms)
    const timeSincebeat = now - this.lastBeatTime;
    if (timeSincebeat < this.BEAT_DECAY_MS) {
      // Exponential decay: e^(-t/τ) where τ = 60ms
      const TAU = 60; // Time constant for exponential decay
      this.beatBurstValue = Math.exp(-timeSincebeat / TAU);
    } else {
      this.beatBurstValue = 0.0;
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
      beatBurst: this.beatBurstValue,
      // DJ Crossfade & Visual Effects
      opacityA,
      opacityB,
      zoomBias,
      parallaxStrength,
      burnIntensity,
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
