import { EventEmitter } from "../../utils/EventEmitter";
import type { ClockState, AudioFeatures, Command, Opportunities } from "@shared/maestroTypes";

/**
 * Maestro Loop - Main orchestration engine
 * 
 * Architecture:
 *   AudioProbe → Evaluator → Policy → Planner → Conductor → MorphEngine
 * 
 * Responsibilities:
 *   - Subscribe to AudioProbe clock updates
 *   - Evaluate current state to identify opportunities
 *   - Apply policy rules to generate intents
 *   - Plan bar-aligned directives
 *   - Conduct the MorphEngine via CommandBus
 */
export class MaestroLoop extends EventEmitter {
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  private isRunning: boolean = false;

  // Component references (to be wired)
  private evaluator: Evaluator | null = null;
  private policy: Policy | null = null;
  private planner: Planner | null = null;
  private conductor: Conductor | null = null;

  // Current state
  private currentClock: ClockState | null = null;
  private currentAudio: AudioFeatures | null = null;

  constructor() {
    super();
    console.log("[MaestroLoop] Initialized");
  }

  /**
   * Start the orchestration loop
   */
  start(): void {
    if (this.isRunning) {
      console.warn("[MaestroLoop] Already running");
      return;
    }

    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.tick();
    
    console.log("[MaestroLoop] Started");
    this.emit("started");
  }

  /**
   * Stop the orchestration loop
   */
  stop(): void {
    if (!this.isRunning) {
      console.warn("[MaestroLoop] Not running");
      return;
    }

    this.isRunning = false;
    
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    console.log("[MaestroLoop] Stopped");
    this.emit("stopped");
  }

  /**
   * Main tick function (runs every frame)
   */
  private tick = (): void => {
    if (!this.isRunning) return;

    const now = performance.now();
    const deltaMs = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // TODO: Phase 1 - Just log for now
    // In Phase 2, this will drive:
    //   1. Evaluator: Analyze current state → Opportunities
    //   2. Policy: Opportunities → Intents
    //   3. Planner: Intents → Directives (bar-aligned)
    //   4. Conductor: Directives → Commands → MorphEngine

    // Emit tick event with timing info
    this.emit("tick", { now, deltaMs });

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  /**
   * Update clock state from AudioProbe
   */
  updateClock(clock: ClockState): void {
    this.currentClock = clock;
    this.emit("clockUpdate", clock);
  }

  /**
   * Update audio features from AudioProbe
   */
  updateAudio(audio: AudioFeatures): void {
    this.currentAudio = audio;
    this.emit("audioUpdate", audio);
  }

  /**
   * Get current clock state
   */
  getClock(): ClockState | null {
    return this.currentClock;
  }

  /**
   * Get current audio features
   */
  getAudio(): AudioFeatures | null {
    return this.currentAudio;
  }
}

/**
 * Evaluator - Analyzes current state to identify opportunities
 * 
 * Inputs: VisionFeatures, AudioFeatures, ClockState
 * Outputs: Opportunities (0-1 scores for different effect triggers)
 */
export class Evaluator {
  constructor() {
    console.log("[Evaluator] Initialized");
  }

  /**
   * Evaluate current state and return opportunities
   * 
   * For Phase 1+2, we'll use simplified audio-only evaluation
   */
  evaluate(audio: AudioFeatures | null, clock: ClockState | null): Opportunities {
    // Placeholder implementation
    // TODO: In Phase 2, implement actual opportunity detection:
    //   - manyDots: based on keypoint count (Phase 3 - vision)
    //   - strongSilhouette: based on segmentation (Phase 3 - vision)
    //   - edgeParty: based on edge density (Phase 3 - vision)
    //   - dramaBeat: based on beat energy and phase
    //   - novelty: based on scene change (Phase 3 - vision)

    return {
      manyDots: 0,
      strongSilhouette: 0,
      edgeParty: 0,
      dramaBeat: audio ? this.detectDramaBeat(audio, clock) : 0,
      novelty: 0,
    };
  }

  private detectDramaBeat(audio: AudioFeatures, clock: ClockState | null): number {
    // Simple drama detection: high RMS near downbeat
    if (!clock) return 0;
    
    const energyScore = Math.min(audio.rms / 0.5, 1.0); // Normalize RMS
    const beatProximity = 1.0 - Math.abs(clock.beatPhase - 0.0); // Closer to downbeat = higher
    
    return energyScore * beatProximity;
  }
}

/**
 * Policy - Applies rules to generate intents from opportunities
 * 
 * Inputs: Opportunities
 * Outputs: Intents (typed effect descriptions)
 */
export class Policy {
  constructor() {
    console.log("[Policy] Initialized");
  }

  /**
   * Apply policy rules to generate intents
   * 
   * For Phase 1+2, we'll implement simple audio-reactive rules
   */
  generateIntents(opportunities: Opportunities, clock: ClockState | null): Command[] {
    const commands: Command[] = [];

    // TODO: Phase 2 - Implement policy rules
    // Example: If dramaBeat > 0.7, trigger particle burst
    
    return commands;
  }
}

/**
 * Planner - Converts intents into bar-aligned directives
 * 
 * Inputs: Intents, ClockState
 * Outputs: Directives (scheduled, deterministic commands)
 */
export class Planner {
  constructor() {
    console.log("[Planner] Initialized");
  }

  /**
   * Plan directives from intents
   * 
   * Ensures bar-aligned execution and deterministic seeding
   */
  plan(commands: Command[], clock: ClockState | null): Command[] {
    // TODO: Phase 2 - Implement planning logic
    // - Bar alignment
    // - Deterministic seeding from (barIndex, intentId)
    // - Safety checks (FPS floors, cooldowns)
    
    return commands;
  }
}

/**
 * Conductor - Dispatches commands to MorphEngine via CommandBus
 * 
 * Inputs: Directives
 * Outputs: Dispatches commands to CommandBus
 */
export class Conductor {
  constructor() {
    console.log("[Conductor] Initialized");
  }

  /**
   * Conduct the engine by dispatching commands
   */
  conduct(commands: Command[]): void {
    // TODO: Phase 2 - Wire to CommandBus
    // commandBus.enqueue(commands);
    
    if (commands.length > 0) {
      console.log(`[Conductor] Would dispatch ${commands.length} commands`);
    }
  }
}
