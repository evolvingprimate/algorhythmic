import { DNAVector, DNAFrame, interpolateDNA, applyAudioReactivity, smoothstepBellCurve, sigmoid, smootherstep } from './dna';
import { MorphScheduler } from './MorphScheduler';
import type { AudioAnalysis } from '@shared/schema';
import { clientTelemetry } from './client-telemetry';

export type MorphPhase = 'hold' | 'ramp' | 'morph';

// Per-frame Ken Burns progress tracker
interface FrameTracker {
  cycleStart: number; // When this frame's Ken Burns cycle started
  progress: number; // 0-1 progress through Ken Burns cycle
  zoomDirection: 'in' | 'out'; // Bidirectional: 'out' = expanding, 'in' = contracting
}

export interface MorphState {
  phase: MorphPhase;
  currentFrameIndex: number;
  nextFrameIndex: number;
  phaseProgress: number;
  totalProgress: number;
  currentDNA: DNAVector;
  nextDNA: DNAVector; // Frame B's DNA for Ken Burns continuity
  viewProgressA: number; // Frame A's independent Ken Burns progress (0-1)
  viewProgressB: number; // Frame B's independent Ken Burns progress (0-1)
  zoomDirectionA: 'in' | 'out'; // Frame A zoom direction (bidirectional Ken Burns)
  zoomDirectionB: 'in' | 'out'; // Frame B zoom direction (opposite of A)
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

// Audio-Reactive Controls (Morpheus 0.4)
export interface MorphControls {
  t: number;
  tRateBase: number;
  tRate: number;
  tBeatNudge: number;
  dispAmp: number;
  seamFeather: number;
  tpsLambda: number;
  meshSharpen: number;
  bgDispAmp: number;
  caps: {
    maxDispAmp: number;
    maxTRate: number;
    maxSharpen: number;
  };
}

export class MorphEngine {
  private frames: DNAFrame[] = [];
  private currentIndex: number = 0;
  private phaseStartTime: number = 0;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  private scheduler: MorphScheduler = new MorphScheduler(); // FSM for phase-safe transitions
  
  // Per-frame Ken Burns progress trackers (keyed by imageUrl for stability)
  private frameTrackers: Map<string, FrameTracker> = new Map();
  
  // Beat burst tracking
  private lastBeatTime: number = 0;
  private beatBurstValue: number = 0;
  private lastBassLevel: number = 0;
  private readonly BEAT_DECAY_MS = 180; // 180ms decay as per ChatGPT spec
  private readonly BEAT_THRESHOLD = 0.6; // Beat triggers when bass > 0.6
  private readonly BEAT_DELTA_THRESHOLD = 0.1; // AND delta > 0.1
  
  private readonly HOLD_DURATION = 0; // No hold - start immediately
  private readonly RAMP_DURATION = 8000; // 8 seconds to ramp up effects
  private readonly MORPH_DURATION = 52000; // 52 seconds morph (0:52)
  private readonly TOTAL_CYCLE = 60000; // 1 minute total (0+8+52=60s)
  private readonly KEN_BURNS_CYCLE = 60000; // Ken Burns cycle matches morph cycle

  // Audio-reactive controls (Morpheus 0.4)
  public controls: MorphControls = {
    t: 0,
    tRateBase: 0,
    tRate: 0,
    tBeatNudge: 0.03,
    dispAmp: 0.006,
    seamFeather: 1.0,
    tpsLambda: 0.02,
    meshSharpen: 0,
    bgDispAmp: 0.003,
    caps: {
      maxDispAmp: 0.015,
      maxTRate: 0.15,
      maxSharpen: 0.15
    }
  };

  constructor() {
    // Don't initialize phaseStartTime until frames are added
    this.phaseStartTime = 0;
  }

  addFrame(frame: DNAFrame): void {
    this.frames.push(frame);
    
    // Initialize Ken Burns tracker for this frame
    // New frames start with 'out' direction (zooming out when they become visible)
    if (!this.frameTrackers.has(frame.imageUrl)) {
      this.frameTrackers.set(frame.imageUrl, {
        cycleStart: Date.now(),
        progress: 0,
        zoomDirection: 'out', // Start zooming out when visible
      });
    }
    
    // Send frame to scheduler for FSM management
    this.scheduler.enqueueFreshFrame(frame);
    
    // CRITICAL: Reset timing when first frame is added to prevent starting at 11.6% progress
    if (this.frames.length === 1) {
      this.phaseStartTime = Date.now();
      console.log(`[MorphEngine] First frame added, timing reset to ensure Frame A appears at full opacity`);
    }
    
    console.log(`[MorphEngine] Added frame. Total frames: ${this.frames.length}`);
  }

  insertFrameAfterCurrent(frame: DNAFrame): void {
    // Initialize Ken Burns tracker for this frame
    if (!this.frameTrackers.has(frame.imageUrl)) {
      this.frameTrackers.set(frame.imageUrl, {
        cycleStart: Date.now(),
        progress: 0,
        zoomDirection: 'out',
      });
    }
    
    // Special case: first frame
    if (this.frames.length === 0) {
      this.frames.push(frame);
      this.scheduler.enqueueFreshFrame(frame); // Add to scheduler FSM
      this.phaseStartTime = Date.now();
      console.log(`[MorphEngine] First frame inserted, timing reset`);
      return;
    }
    
    // Insert after current frame (will be next in queue)
    const insertIndex = this.currentIndex + 1;
    this.frames.splice(insertIndex, 0, frame);
    
    // CRITICAL: Use scheduler FSM to handle fresh frames properly
    // FSM will queue frame and wait for phase boundary to transition
    if (this.isRunning) {
      this.scheduler.enqueueFreshFrame(frame);
      console.log(`[MorphEngine] 🎨 Fresh frame queued in scheduler, will transition at next phase boundary`);
    }
    
    console.log(`[MorphEngine] 🎨 Inserted fresh frame after position ${insertIndex - 1}. Total frames: ${this.frames.length}`);
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

  hasFrameById(artworkId: string): boolean {
    return this.frames.some(frame => frame.artworkId === artworkId);
  }

  pruneOldestFrames(count: number): void {
    if (count <= 0 || this.frames.length === 0) return;
    
    const framesToRemove = Math.min(count, this.frames.length - 2); // Keep at least 2 frames
    if (framesToRemove <= 0) return;
    
    console.log(`[MorphEngine] Pruning ${framesToRemove} oldest frames (current: ${this.frames.length})`);
    
    // Check if we're removing the currently active frame
    const removingActiveFrame = this.currentIndex < framesToRemove;
    
    // Clean up trackers for removed frames
    const removedFrames = this.frames.slice(0, framesToRemove);
    removedFrames.forEach(frame => {
      this.frameTrackers.delete(frame.imageUrl);
    });
    
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
    this.frameTrackers.clear(); // Clear all trackers on reset
    this.scheduler.reset(); // Reset the scheduler FSM
    this.stop();
    console.log('[MorphEngine] Reset');
  }
  
  // Update scheduler state - should be called regularly
  tick(deltaTime: number = 16): void {
    if (this.isRunning) {
      this.scheduler.tick(deltaTime);
    }
  }
  
  // Calculate per-frame Ken Burns progress (0-1), updating tracker
  // Direction is set by role (Frame A='out', Frame B='in'), NOT by elapsed time
  private getFrameProgress(frame: DNAFrame | null, forceDirection?: 'in' | 'out'): { progress: number; direction: 'in' | 'out' } {
    if (!frame) return { progress: 0, direction: forceDirection || 'out' };
    
    let tracker = this.frameTrackers.get(frame.imageUrl);
    
    // Initialize tracker if missing (shouldn't happen, but safety first)
    if (!tracker) {
      tracker = { cycleStart: Date.now(), progress: 0, zoomDirection: forceDirection || 'out' };
      this.frameTrackers.set(frame.imageUrl, tracker);
    }
    
    // CRITICAL: Update direction if forced (by role assignment)
    if (forceDirection && tracker.zoomDirection !== forceDirection) {
      // Calculate current progress before direction change
      const currentElapsed = Date.now() - tracker.cycleStart;
      const currentProgress = Math.min(currentElapsed / this.KEN_BURNS_CYCLE, 1.0);
      
      // CRITICAL FIX: Skip mirroring for brand new frames (progress ≈ 0)
      // New frames should start from 0 with their assigned direction, not mirror to 1.0
      if (currentProgress < 0.01) {
        // Frame is brand new - just set the direction and keep progress at 0
        tracker.zoomDirection = forceDirection;
        // cycleStart already set to Date.now() from initialization
        console.log('[MorphEngine] New frame direction set:', forceDirection, 'progress: 0');
      } else {
        // Frame is mid-cycle - mirror progress for smooth handoff
        // Example: frame at 70% 'in' becomes 30% 'out'
        const mirroredProgress = 1.0 - currentProgress;
        
        // Update direction
        tracker.zoomDirection = forceDirection;
        
        // Back-compute cycleStart to preserve mirrored progress
        const mirroredElapsed = mirroredProgress * this.KEN_BURNS_CYCLE;
        tracker.cycleStart = Date.now() - mirroredElapsed;
        tracker.progress = mirroredProgress;
        
        console.log('[MorphEngine] Frame role swap - mirrored progress:', 
          currentProgress.toFixed(2), '→', mirroredProgress.toFixed(2), 
          'direction:', tracker.zoomDirection);
      }
    }
    
    // Calculate progress based on elapsed time
    const elapsed = Date.now() - tracker.cycleStart;
    const progress = Math.min(elapsed / this.KEN_BURNS_CYCLE, 1.0);
    
    // Update tracker
    tracker.progress = progress;
    
    // Reset cycle when complete (for looping) - keep same direction
    if (progress >= 1.0) {
      tracker.cycleStart = Date.now();
      tracker.progress = 0;
      // Direction stays the same - it's controlled by role, not time
    }
    
    return { progress, direction: tracker.zoomDirection };
  }

  getMorphState(audioAnalysis?: AudioAnalysis): MorphState {
    const defaultDNA = Array(50).fill(0.5);
    
    // Update scheduler FSM state before computing morph state
    if (this.isRunning) {
      this.scheduler.tick(16); // Tick scheduler with ~16ms frame time
    }
    
    // Get active frames from scheduler FSM
    const activeFrames = this.scheduler.getActiveFrames();
    
    // Handle no frames case
    if (!activeFrames || this.frames.length === 0) {
      return {
        phase: 'hold',
        currentFrameIndex: 0,
        nextFrameIndex: 0,
        phaseProgress: 0,
        totalProgress: 0,
        currentDNA: defaultDNA,
        nextDNA: defaultDNA,
        viewProgressA: 0,
        viewProgressB: 0,
        zoomDirectionA: 'out',
        zoomDirectionB: 'in',
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

    // Use frames from scheduler FSM or fall back to legacy method
    const currentFrame = activeFrames ? activeFrames.frameA : this.getCurrentFrame();
    const nextFrame = activeFrames ? activeFrames.frameB : this.getNextFrame();
    
    if (!currentFrame) {
      return {
        phase: 'hold',
        currentFrameIndex: 0,
        nextFrameIndex: 0,
        phaseProgress: 0,
        totalProgress: 0,
        currentDNA: defaultDNA,
        nextDNA: defaultDNA,
        viewProgressA: 0,
        viewProgressB: 0,
        zoomDirectionA: 'out',
        zoomDirectionB: 'in',
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

    // Use scheduler's phase info if available, else fall back to legacy timing
    const phaseInfo = this.scheduler.getCurrentPhase();
    const schedulerProgress = activeFrames ? activeFrames.progress : phaseInfo.progress;
    
    let elapsed = Date.now() - this.phaseStartTime;
    const cyclePosition = Math.min(elapsed, this.TOTAL_CYCLE); // Cap at TOTAL_CYCLE for final state
    
    // If scheduler is in TRANSITIONING state, use its progress for smooth transition
    const schedulerState = this.scheduler.getState();
    const isTransitioning = schedulerState === 'TRANSITIONING';
    
    // No need to advance frames manually when scheduler is managing them
    if (!activeFrames && elapsed >= this.TOTAL_CYCLE && this.frames.length > 1) {
      // Legacy frame advancement (only if scheduler not active)
      if (elapsed > this.TOTAL_CYCLE + 100) { // 100ms grace period for final state
        // Track morph cycle completion
        clientTelemetry.trackMorphCycle(
          this.currentIndex,
          elapsed,
          this.frames.length,
          true // completed
        );
        
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

    // Calculate per-frame Ken Burns progress with bidirectional zoom (independent of global cycle)
    // CRITICAL: Direction is assigned by ROLE, not elapsed time
    // Frame A (foreground) ALWAYS zooms OUT while fading IN
    // Frame B (background) ALWAYS zooms IN while fading OUT
    const frameAData = this.getFrameProgress(currentFrame, 'out'); // Force 'out' for Frame A
    const frameBData = this.getFrameProgress(nextFrame, 'in'); // Force 'in' for Frame B
    
    const viewProgressA = frameAData.progress;
    const viewProgressB = frameBData.progress;
    const zoomDirectionA = frameAData.direction; // Will always be 'out'
    const zoomDirectionB = frameBData.direction; // Will always be 'in'
    
    // Calculate nextDNA for Frame B's Ken Burns continuity
    let nextDNA = nextFrame?.dnaVector 
      ? [...nextFrame.dnaVector]
      : [...currentFrame.dnaVector]; // Fallback to current if only 1 frame
    
    // Apply audio reactivity with smooth intensity scaling to BOTH DNAs
    if (audioAnalysis && audioIntensity > 0) {
      // Scale the audio analysis by intensity before applying
      const scaledAnalysis = {
        bassLevel: audioAnalysis.bassLevel * audioIntensity,
        amplitude: audioAnalysis.amplitude * audioIntensity,
        tempo: audioAnalysis.tempo,
        trebleLevel: audioAnalysis.trebleLevel * audioIntensity,
      };
      currentDNA = applyAudioReactivity(currentDNA, scaledAnalysis);
      nextDNA = applyAudioReactivity(nextDNA, scaledAnalysis); // CRITICAL: Apply to both for sync
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
      nextDNA,
      viewProgressA, // Per-frame Ken Burns progress for Frame A
      viewProgressB, // Per-frame Ken Burns progress for Frame B
      zoomDirectionA, // Bidirectional zoom direction for Frame A
      zoomDirectionB, // Bidirectional zoom direction for Frame B
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
