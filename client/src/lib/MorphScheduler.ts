/**
 * MorphScheduler FSM (Finite State Machine)
 * 
 * Manages smooth phase transitions and prevents mid-morph jumps.
 * Fresh frames are queued and only integrated at phase boundaries
 * (every 60 seconds) to ensure smooth visual transitions.
 */

import type { DNAFrame } from './dna';

export type SchedulerState = 'IDLE' | 'MORPHING' | 'PENDING_TRANSITION' | 'TRANSITIONING';

export interface MorphSchedulerState {
  state: SchedulerState;
  currentFrameA: DNAFrame | null;
  currentFrameB: DNAFrame | null;
  pendingFrame: DNAFrame | null;
  phaseStartTime: number;
  morphProgress: number; // 0-1 within current phase
  cycleCount: number;
  transitionStartTime: number | null; // When transition began
}

export interface PhaseInfo {
  progress: number; // 0-1
  timeRemaining: number; // milliseconds
  isAtBoundary: boolean;
  cycleCount: number;
}

export interface ActiveFrames {
  frameA: DNAFrame;
  frameB: DNAFrame;
  progress: number; // 0-1 morph progress
  isTransitioning: boolean;
}

export class MorphScheduler {
  private state: MorphSchedulerState;
  private readonly PHASE_DURATION_MS = 60000; // 60 seconds per phase
  private readonly TRANSITION_DURATION_MS = 1500; // 1.5 seconds for smooth transition
  private readonly BOUNDARY_TOLERANCE_MS = 100; // 100ms tolerance for boundary detection
  
  constructor() {
    this.state = {
      state: 'IDLE',
      currentFrameA: null,
      currentFrameB: null,
      pendingFrame: null,
      phaseStartTime: Date.now(),
      morphProgress: 0,
      cycleCount: 0,
      transitionStartTime: null,
    };
  }
  
  /**
   * Check if we're at a phase boundary (start or end of 60s cycle)
   */
  isAtPhaseBoundary(): boolean {
    if (this.state.state !== 'MORPHING') return false;
    
    const progress = this.state.morphProgress;
    const tolerance = this.BOUNDARY_TOLERANCE_MS / this.PHASE_DURATION_MS;
    
    // Check if we're near 0 or 1 (within tolerance)
    return progress <= tolerance || progress >= (1 - tolerance);
  }
  
  /**
   * Check if scheduler can accept a fresh frame
   */
  canAcceptFreshFrame(): boolean {
    // Can accept if not already pending or transitioning
    return this.state.state !== 'PENDING_TRANSITION' && 
           this.state.state !== 'TRANSITIONING';
  }
  
  /**
   * Get current phase information
   */
  getCurrentPhase(): PhaseInfo {
    const elapsed = Date.now() - this.state.phaseStartTime;
    const progress = Math.min(elapsed / this.PHASE_DURATION_MS, 1);
    const timeRemaining = Math.max(0, this.PHASE_DURATION_MS - elapsed);
    
    return {
      progress,
      timeRemaining,
      isAtBoundary: this.isAtPhaseBoundary(),
      cycleCount: this.state.cycleCount,
    };
  }
  
  /**
   * Enqueue a fresh frame for display
   */
  enqueueFreshFrame(frame: DNAFrame): void {
    console.log(`[MorphScheduler] Enqueueing fresh frame in state: ${this.state.state}`);
    
    switch (this.state.state) {
      case 'IDLE':
        // First frame - store as frameA and wait for second frame
        this.state.currentFrameA = frame;
        this.state.state = 'IDLE'; // Stay idle until we have 2 frames
        console.log('[MorphScheduler] First frame received, waiting for second');
        break;
        
      case 'MORPHING':
        if (!this.state.pendingFrame) {
          // Store pending frame and wait for boundary
          this.state.pendingFrame = frame;
          this.state.state = 'PENDING_TRANSITION';
          console.log('[MorphScheduler] Frame queued for next phase boundary');
        } else {
          console.log('[MorphScheduler] Already have pending frame, ignoring new frame');
        }
        break;
        
      case 'PENDING_TRANSITION':
        // Replace pending frame with newer one
        this.state.pendingFrame = frame;
        console.log('[MorphScheduler] Updated pending frame with newer artwork');
        break;
        
      case 'TRANSITIONING':
        // Store for next cycle
        this.state.pendingFrame = frame;
        console.log('[MorphScheduler] Frame queued for after current transition');
        break;
    }
    
    // Special case: If we have frameA but no frameB yet, use this as frameB
    if (this.state.state === 'IDLE' && this.state.currentFrameA && !this.state.currentFrameB) {
      this.state.currentFrameB = frame;
      this.state.state = 'MORPHING';
      this.state.phaseStartTime = Date.now();
      this.state.morphProgress = 0;
      console.log('[MorphScheduler] Second frame received, starting morph cycle');
    }
  }
  
  /**
   * Update scheduler state based on time progression
   */
  tick(deltaTime: number): void {
    const now = Date.now();
    
    switch (this.state.state) {
      case 'IDLE':
        // Waiting for frames, nothing to do
        break;
        
      case 'MORPHING':
        // Update morph progress
        const elapsed = now - this.state.phaseStartTime;
        this.state.morphProgress = Math.min(elapsed / this.PHASE_DURATION_MS, 1);
        
        // Check if cycle complete
        if (this.state.morphProgress >= 1) {
          // Cycle complete, swap frames for ping-pong
          const temp = this.state.currentFrameA;
          this.state.currentFrameA = this.state.currentFrameB;
          this.state.currentFrameB = temp;
          
          // Reset for next cycle
          this.state.phaseStartTime = now;
          this.state.morphProgress = 0;
          this.state.cycleCount++;
          
          console.log(`[MorphScheduler] Cycle ${this.state.cycleCount} complete, swapping frames`);
        }
        break;
        
      case 'PENDING_TRANSITION':
        // Update morph progress while waiting for boundary
        const pendingElapsed = now - this.state.phaseStartTime;
        this.state.morphProgress = Math.min(pendingElapsed / this.PHASE_DURATION_MS, 1);
        
        // Check if we're at a phase boundary
        if (this.isAtPhaseBoundary() && this.state.pendingFrame) {
          // Start transition
          this.state.state = 'TRANSITIONING';
          this.state.transitionStartTime = now;
          console.log('[MorphScheduler] Phase boundary reached, starting transition');
        }
        
        // Handle cycle completion while pending
        if (this.state.morphProgress >= 1) {
          // Start transition immediately at cycle boundary
          if (this.state.pendingFrame) {
            this.state.state = 'TRANSITIONING';
            this.state.transitionStartTime = now;
            console.log('[MorphScheduler] Cycle boundary reached, starting transition');
          } else {
            // No pending frame, just swap and continue
            const temp = this.state.currentFrameA;
            this.state.currentFrameA = this.state.currentFrameB;
            this.state.currentFrameB = temp;
            this.state.phaseStartTime = now;
            this.state.morphProgress = 0;
            this.state.cycleCount++;
            this.state.state = 'MORPHING';
          }
        }
        break;
        
      case 'TRANSITIONING':
        if (!this.state.transitionStartTime || !this.state.pendingFrame) {
          // Invalid state, go back to morphing
          this.state.state = 'MORPHING';
          break;
        }
        
        const transitionElapsed = now - this.state.transitionStartTime;
        
        if (transitionElapsed >= this.TRANSITION_DURATION_MS) {
          // Transition complete, integrate fresh frame
          const pendingFrame = this.state.pendingFrame;
          
          // Determine which frame to replace based on progress
          if (this.state.morphProgress < 0.5) {
            // Near start of cycle, replace frameB
            this.state.currentFrameB = pendingFrame;
          } else {
            // Near end of cycle, replace frameA for next cycle
            this.state.currentFrameA = pendingFrame;
          }
          
          // Clear pending and return to morphing
          this.state.pendingFrame = null;
          this.state.transitionStartTime = null;
          this.state.state = 'MORPHING';
          
          // Reset phase timing for clean continuation
          this.state.phaseStartTime = now;
          this.state.morphProgress = 0;
          
          console.log('[MorphScheduler] Transition complete, fresh frame integrated');
        }
        break;
    }
  }
  
  /**
   * Get active frames for rendering
   */
  getActiveFrames(): ActiveFrames | null {
    // Need at least 2 frames to render
    if (!this.state.currentFrameA || !this.state.currentFrameB) {
      return null;
    }
    
    let frameA = this.state.currentFrameA;
    let frameB = this.state.currentFrameB;
    let progress = this.state.morphProgress;
    let isTransitioning = false;
    
    // Handle transition blending
    if (this.state.state === 'TRANSITIONING' && 
        this.state.pendingFrame && 
        this.state.transitionStartTime) {
      
      const transitionElapsed = Date.now() - this.state.transitionStartTime;
      const transitionProgress = Math.min(transitionElapsed / this.TRANSITION_DURATION_MS, 1);
      
      // Smooth blend: fade out old frame, fade in new frame
      isTransitioning = true;
      
      // Use pending frame as one of the active frames during transition
      if (this.state.morphProgress < 0.5) {
        // Replace frameB during transition
        frameB = this.state.pendingFrame;
      } else {
        // Replace frameA during transition
        frameA = this.state.pendingFrame;
      }
      
      // Adjust progress for smooth visual transition
      // Use an easing function for the blend
      const easedProgress = this.smoothstep(transitionProgress);
      progress = progress * (1 - easedProgress) + 0.5 * easedProgress;
    }
    
    return {
      frameA,
      frameB,
      progress,
      isTransitioning,
    };
  }
  
  /**
   * Reset scheduler (for music changes)
   */
  reset(): void {
    console.log('[MorphScheduler] Resetting scheduler');
    
    this.state = {
      state: 'IDLE',
      currentFrameA: null,
      currentFrameB: null,
      pendingFrame: null,
      phaseStartTime: Date.now(),
      morphProgress: 0,
      cycleCount: 0,
      transitionStartTime: null,
    };
  }
  
  /**
   * Get current scheduler state (for debugging/UI)
   */
  getState(): SchedulerState {
    return this.state.state;
  }
  
  /**
   * Get full state snapshot (for debugging)
   */
  getFullState(): MorphSchedulerState {
    return { ...this.state };
  }
  
  /**
   * Smoothstep interpolation function for transitions
   */
  private smoothstep(t: number): number {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  }
}