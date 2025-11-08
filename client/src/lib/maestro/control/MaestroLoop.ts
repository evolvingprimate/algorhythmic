import { EventEmitter } from "../../utils/EventEmitter";
import type { ClockState, AudioFeatures, Command } from "@shared/maestroTypes";
import type { MaestroControlStore } from "./MaestroControlStore";
import type { CommandBus } from "./CommandBus";
import { ClimaxDetector } from "../climax/ClimaxDetector";
import { VisionFeatureService } from "../vision/VisionFeatureService";
import type { SpawnAnchor } from "./MaestroControlStore";

/**
 * Maestro Loop - Main orchestration engine with AI-driven particle control
 * 
 * Phase 1 Architecture:
 *   AudioProbe → MaestroLoop → ClimaxDetector → VisionFeatureService → CommandBus
 * 
 * Responsibilities:
 *   - Subscribe to AudioProbe clock/audio updates
 *   - Consult MaestroControlStore for user preferences
 *   - Run ClimaxDetector to identify musical crescendos
 *   - Trigger VisionFeatureService on climax events (with throttling)
 *   - Emit PARTICLE_SPAWN_FIELD + PARTICLE_BURST commands
 *   - Apply user multipliers to audio-reactive pulses
 */
export class MaestroLoop extends EventEmitter {
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  private isRunning: boolean = false;

  // Component references
  private controlStore: MaestroControlStore | null = null;
  private commandBus: CommandBus | null = null;
  private climaxDetector: ClimaxDetector;
  private visionService: VisionFeatureService;

  // Current state
  private currentClock: ClockState | null = null;
  private currentAudio: AudioFeatures | null = null;
  private lastOnsetTime: number = 0;
  private onsetDetected: boolean = false;
  
  // Vision analysis state
  private currentArtworkId: string = "default";
  private lastVisionRequestTime: number = 0;
  private visionAnalysisPending: boolean = false;

  constructor() {
    super();
    this.climaxDetector = new ClimaxDetector();
    this.visionService = new VisionFeatureService();
    console.log("[MaestroLoop] Initialized with ClimaxDetector and VisionFeatureService");
  }

  /**
   * Wire dependencies
   */
  setDependencies(controlStore: MaestroControlStore, commandBus: CommandBus): void {
    this.controlStore = controlStore;
    this.commandBus = commandBus;
    console.log("[MaestroLoop] Dependencies wired");
  }

  /**
   * Set current artwork ID for vision analysis caching
   */
  setArtworkId(artworkId: string): void {
    if (this.currentArtworkId !== artworkId) {
      console.log(`[MaestroLoop] Artwork changed: ${this.currentArtworkId} → ${artworkId}`);
      this.currentArtworkId = artworkId;
    }
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
   * Main tick function - runs climax detection and policy evaluation
   */
  private tick = (): void => {
    if (!this.isRunning) return;

    const now = performance.now();
    const deltaMs = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // Run climax detection if we have audio data
    if (this.currentAudio && this.currentClock && this.controlStore && this.commandBus) {
      const climaxResult = this.climaxDetector.analyze(
        this.currentAudio,
        this.currentClock,
        this.onsetDetected
      );
      
      // Check if climax detected and cooldown allows triggering
      if (climaxResult.isClimax && this.controlStore.canTriggerClimax(this.currentClock.currentBar)) {
        console.log(
          `[MaestroLoop] CLIMAX DETECTED! Score: ${climaxResult.climaxScore.toFixed(2)} ` +
          `(${climaxResult.reason})`
        );
        
        // Mark climax as triggered in control store
        this.controlStore.triggerClimax(this.currentClock.currentBar);
        
        // Reset climax detector to prevent immediate re-trigger
        this.climaxDetector.reset();
        
        // Trigger Vision analysis for spawn anchors (async, won't block)
        this.requestVisionAnalysis();
        
        // Emit particle burst command
        this.commandBus.enqueue({
          kind: "PARTICLE_BURST",
          path: "particles.main.burst",
          durationBeats: 4, // 2 seconds at 120 BPM
          intensityMultiplier: 3.0, // 3x spawn rate during burst
        });
      }
      
      // Emit diagnostic event
      this.emit("climaxUpdate", {
        score: climaxResult.climaxScore,
        isClimax: climaxResult.isClimax,
        sustainedDuration: climaxResult.sustainedEnergyDuration,
        onsetDensity: climaxResult.onsetDensity,
      });
    }

    // Reset onset flag (it's only true for one frame after detection)
    this.onsetDetected = false;

    // Emit tick event with timing info
    this.emit("tick", { now, deltaMs });

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  /**
   * Request Vision analysis (async, non-blocking)
   */
  private async requestVisionAnalysis(): Promise<void> {
    if (this.visionAnalysisPending) {
      console.log("[MaestroLoop] Vision analysis already pending, skipping");
      return;
    }
    
    if (!this.controlStore || !this.commandBus) {
      console.warn("[MaestroLoop] Cannot request vision analysis: missing dependencies");
      return;
    }
    
    // Check if we have cached anchors for current artwork
    const cachedAnchors = this.controlStore.getSpawnAnchors(this.currentArtworkId);
    if (cachedAnchors) {
      console.log(`[MaestroLoop] Using cached spawn anchors (${cachedAnchors.length})`);
      this.loadSpawnAnchors(cachedAnchors);
      return;
    }
    
    // Get canvas element for frame capture
    const canvas = document.getElementById('maestro-canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      console.warn("[MaestroLoop] Cannot find canvas element for vision analysis");
      return;
    }
    
    this.visionAnalysisPending = true;
    this.lastVisionRequestTime = performance.now();
    
    try {
      const anchors = await this.visionService.analyzeFrame(canvas, this.currentArtworkId);
      
      if (anchors && anchors.length > 0) {
        console.log(`[MaestroLoop] Vision analysis complete: ${anchors.length} anchors`);
        
        // Cache the anchors in control store
        this.controlStore.cacheSpawnAnchors(this.currentArtworkId, anchors);
        
        // Load anchors into particle system
        this.loadSpawnAnchors(anchors);
      } else {
        console.log("[MaestroLoop] Vision analysis returned no anchors (throttled or failed)");
      }
    } catch (error) {
      console.error("[MaestroLoop] Vision analysis error:", error);
    } finally {
      this.visionAnalysisPending = false;
    }
  }

  /**
   * Load spawn anchors into particle system via command
   */
  private loadSpawnAnchors(anchors: SpawnAnchor[]): void {
    if (!this.commandBus) return;
    
    this.commandBus.enqueue({
      kind: "PARTICLE_SPAWN_FIELD",
      path: "particles.main.spawnField",
      anchors: anchors.map(a => ({ x: a.x, y: a.y, weight: a.weight })),
    });
    
    console.log(`[MaestroLoop] Loaded ${anchors.length} spawn anchors into particle system`);
  }

  /**
   * Handle onset detection event from AudioProbe
   */
  onOnset(): void {
    this.onsetDetected = true;
    this.lastOnsetTime = performance.now();
    
    // Apply user multipliers to pulse commands
    if (this.controlStore && this.commandBus) {
      const prefs = this.controlStore.getEffectPreferences();
      
      // Pulse particles on beat (if enabled)
      if (prefs.particles.enabled) {
        this.commandBus.enqueue({
          kind: 'PULSE',
          path: 'particles.main.spawnRate',
          amount: 50 * prefs.particles.spawnRateMultiplier,
          decayBeats: 0.5,
        });
        
        this.commandBus.enqueue({
          kind: 'PULSE',
          path: 'particles.main.velocity',
          amount: 2.0 * prefs.particles.velocityMultiplier,
          decayBeats: 1.0,
        });
      }
      
      // Pulse warp on beat (if enabled)
      if (prefs.warp.enabled) {
        this.commandBus.enqueue({
          kind: 'PULSE',
          path: 'warp.elasticity',
          amount: 0.3 * prefs.warp.elasticityMultiplier,
          decayBeats: 0.8,
        });
      }
    }
  }

  /**
   * Handle audio-reactive mixer changes (energy/bass)
   */
  onAudioUpdate(audio: AudioFeatures): void {
    if (!this.controlStore || !this.commandBus) return;
    
    const prefs = this.controlStore.getEffectPreferences();
    const energyLevel = audio.energy;
    const bassLevel = audio.bass;
    
    // Ramp saturation based on energy
    if (energyLevel > 0.7) {
      this.commandBus.enqueue({
        kind: 'RAMP',
        path: 'mixer.saturation',
        to: 1.3 * prefs.mixer.saturationMultiplier,
        durationBars: 0.5,
        curve: 'easeInOut',
      });
    } else if (energyLevel < 0.3) {
      this.commandBus.enqueue({
        kind: 'RAMP',
        path: 'mixer.saturation',
        to: 0.9 * prefs.mixer.saturationMultiplier,
        durationBars: 1.0,
        curve: 'easeInOut',
      });
    }
    
    // Bass-reactive brightness (subtle)
    if (bassLevel > 0.6) {
      this.commandBus.enqueue({
        kind: 'RAMP',
        path: 'mixer.brightness',
        to: 1.1 * prefs.mixer.brightnessMultiplier,
        durationBars: 0.25,
        curve: 'easeInOut',
      });
    }
  }

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
    
    // Process audio for mixer changes
    this.onAudioUpdate(audio);
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

  /**
   * Get diagnostic stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      climaxDetector: this.climaxDetector.getStats(),
      visionService: this.visionService.getStats(),
      visionPending: this.visionAnalysisPending,
      currentArtworkId: this.currentArtworkId,
    };
  }
}
