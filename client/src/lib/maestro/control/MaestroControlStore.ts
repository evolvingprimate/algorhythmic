import type { EnginePath } from "@shared/maestroTypes";

/**
 * Vision spawn anchor for intelligent particle emission
 */
export interface SpawnAnchor {
  x: number;              // Normalized 0-1 canvas position
  y: number;              // Normalized 0-1 canvas position
  type: "edge" | "focal" | "dot" | "contrast";
  confidence: number;     // 0-1, AI confidence score
  weight: number;         // Emission probability weight
}

/**
 * Effect preferences for user control
 */
export interface EffectPreferences {
  particles: {
    enabled: boolean;
    spawnRateMultiplier: number;    // 0-2, scales baseline
    velocityMultiplier: number;     // 0-2
    sizeMultiplier: number;         // 0-2
  };
  warp: {
    enabled: boolean;
    elasticityMultiplier: number;   // 0-2
    radiusMultiplier: number;       // 0-2
  };
  mixer: {
    saturationMultiplier: number;   // 0-2
    brightnessMultiplier: number;   // 0-2
    contrastMultiplier: number;     // 0-2
  };
  trace: {
    enabled: boolean;
    strengthMultiplier: number;     // 0-2
  };
}

/**
 * Climax detection state
 */
export interface ClimaxState {
  lastTriggerTime: number;          // performance.now()
  lastTriggerBar: number;           // Bar number
  cooldownBars: number;             // Bars to wait before next climax
  sustainedHighEnergyStart: number; // When sustained energy began
  climaxScore: number;              // Current climax probability 0-1
}

/**
 * Cached vision analysis results
 */
interface VisionCache {
  artworkId: string;
  anchors: SpawnAnchor[];
  timestamp: number;
  ttlMs: number;
}

/**
 * Intent weights for RAI Phase 2/3
 */
export interface IntentWeights {
  calm: number;         // 0-1 probability weight
  build: number;        // 0-1 probability weight
  crescendo: number;    // 0-1 probability weight
  resolve: number;      // 0-1 probability weight
  version: number;      // For hot-reload detection
}

/**
 * MaestroControlStore - Policy and state layer for Maestro
 * 
 * Responsibilities:
 *   - User effect preferences (enable/disable, multipliers)
 *   - Vision spawn anchor caching (per-artwork, TTL)
 *   - Climax detection state (cooldowns, thresholds)
 *   - Intent weights (for RAI Phase 2/3)
 *   - LocalStorage persistence
 *   - Telemetry event hooks (no-ops until Phase 2)
 */
export class MaestroControlStore {
  private effectPrefs: EffectPreferences;
  private climaxState: ClimaxState;
  private visionCache: VisionCache | null = null;
  private intentWeights: IntentWeights;
  
  private readonly STORAGE_KEY_PREFS = "maestro:effectPrefs";
  private readonly STORAGE_KEY_INTENT = "maestro:intentWeights";
  private readonly DEFAULT_VISION_TTL = 10 * 60 * 1000; // 10 minutes
  
  constructor() {
    console.log("[MaestroControlStore] Initializing...");
    
    // Load or initialize effect preferences
    this.effectPrefs = this.loadEffectPreferences();
    
    // Initialize climax state
    this.climaxState = {
      lastTriggerTime: 0,
      lastTriggerBar: -1000,
      cooldownBars: 24,
      sustainedHighEnergyStart: 0,
      climaxScore: 0,
    };
    
    // Load or initialize intent weights
    this.intentWeights = this.loadIntentWeights();
    
    console.log("[MaestroControlStore] Initialized with preferences:", this.effectPrefs);
  }

  // ============================================================================
  // Effect Preferences
  // ============================================================================

  /**
   * Get current effect preferences
   */
  getEffectPreferences(): EffectPreferences {
    return { ...this.effectPrefs };
  }

  /**
   * Update effect preferences (partial updates allowed)
   */
  updateEffectPreferences(updates: Partial<EffectPreferences>): void {
    this.effectPrefs = {
      ...this.effectPrefs,
      ...updates,
      particles: { ...this.effectPrefs.particles, ...updates.particles },
      warp: { ...this.effectPrefs.warp, ...updates.warp },
      mixer: { ...this.effectPrefs.mixer, ...updates.mixer },
      trace: { ...this.effectPrefs.trace, ...updates.trace },
    };
    
    this.saveEffectPreferences();
    this.emitTelemetry("control_adjustment", { preferences: this.effectPrefs });
  }

  /**
   * Get multiplier for a specific parameter path
   */
  getMultiplier(path: EnginePath): number {
    // Map parameter paths to multipliers
    if (path.startsWith("particles.main.spawnRate")) {
      return this.effectPrefs.particles.enabled 
        ? this.effectPrefs.particles.spawnRateMultiplier 
        : 0;
    }
    if (path.startsWith("particles.main.velocity")) {
      return this.effectPrefs.particles.enabled 
        ? this.effectPrefs.particles.velocityMultiplier 
        : 0;
    }
    if (path.startsWith("particles.main.size")) {
      return this.effectPrefs.particles.enabled 
        ? this.effectPrefs.particles.sizeMultiplier 
        : 0;
    }
    if (path.startsWith("warp.elasticity")) {
      return this.effectPrefs.warp.enabled 
        ? this.effectPrefs.warp.elasticityMultiplier 
        : 0;
    }
    if (path.startsWith("warp.radius")) {
      return this.effectPrefs.warp.enabled 
        ? this.effectPrefs.warp.radiusMultiplier 
        : 1;
    }
    if (path.startsWith("mixer.saturation")) {
      return this.effectPrefs.mixer.saturationMultiplier;
    }
    if (path.startsWith("mixer.brightness")) {
      return this.effectPrefs.mixer.brightnessMultiplier;
    }
    if (path.startsWith("mixer.contrast")) {
      return this.effectPrefs.mixer.contrastMultiplier;
    }
    if (path.startsWith("trace.strength")) {
      return this.effectPrefs.trace.enabled 
        ? this.effectPrefs.trace.strengthMultiplier 
        : 0;
    }
    
    return 1.0; // Default passthrough
  }

  /**
   * Check if an effect category is enabled
   */
  isEffectEnabled(category: "particles" | "warp" | "trace"): boolean {
    return this.effectPrefs[category].enabled;
  }

  /**
   * Reset preferences to defaults
   */
  resetPreferences(): void {
    this.effectPrefs = this.getDefaultPreferences();
    this.saveEffectPreferences();
    this.emitTelemetry("control_adjustment", { action: "reset_to_defaults" });
  }

  // ============================================================================
  // Vision Spawn Anchors
  // ============================================================================

  /**
   * Get cached spawn anchors for an artwork
   */
  getSpawnAnchors(artworkId: string): SpawnAnchor[] | null {
    if (!this.visionCache || this.visionCache.artworkId !== artworkId) {
      return null;
    }
    
    const age = performance.now() - this.visionCache.timestamp;
    if (age > this.visionCache.ttlMs) {
      console.log("[MaestroControlStore] Vision cache expired for", artworkId);
      this.visionCache = null;
      return null;
    }
    
    return this.visionCache.anchors;
  }

  /**
   * Cache spawn anchors for an artwork
   */
  cacheSpawnAnchors(artworkId: string, anchors: SpawnAnchor[], ttlMs?: number): void {
    this.visionCache = {
      artworkId,
      anchors,
      timestamp: performance.now(),
      ttlMs: ttlMs ?? this.DEFAULT_VISION_TTL,
    };
    
    console.log(
      `[MaestroControlStore] Cached ${anchors.length} spawn anchors for ${artworkId} ` +
      `(TTL: ${(ttlMs ?? this.DEFAULT_VISION_TTL) / 1000}s)`
    );
  }

  /**
   * Clear vision cache
   */
  clearVisionCache(): void {
    this.visionCache = null;
  }

  // ============================================================================
  // Climax Detection State
  // ============================================================================

  /**
   * Get current climax state
   */
  getClimaxState(): ClimaxState {
    return { ...this.climaxState };
  }

  /**
   * Update climax state
   */
  updateClimaxState(updates: Partial<ClimaxState>): void {
    this.climaxState = { ...this.climaxState, ...updates };
  }

  /**
   * Check if climax can trigger (respects cooldown)
   */
  canTriggerClimax(currentBar: number): boolean {
    const barsSinceLastTrigger = currentBar - this.climaxState.lastTriggerBar;
    return barsSinceLastTrigger >= this.climaxState.cooldownBars;
  }

  /**
   * Mark climax as triggered
   */
  triggerClimax(currentBar: number): void {
    this.climaxState.lastTriggerTime = performance.now();
    this.climaxState.lastTriggerBar = currentBar;
    
    console.log(
      `[MaestroControlStore] Climax triggered at bar ${currentBar} ` +
      `(cooldown: ${this.climaxState.cooldownBars} bars)`
    );
    
    this.emitTelemetry("climax_triggered", { bar: currentBar });
  }

  // ============================================================================
  // Intent Weights (for RAI Phase 2/3)
  // ============================================================================

  /**
   * Get current intent weights
   */
  getIntentWeights(): IntentWeights {
    return { ...this.intentWeights };
  }

  /**
   * Update intent weights (typically from MaestroBrainService)
   */
  updateIntentWeights(weights: Partial<IntentWeights>): void {
    this.intentWeights = { ...this.intentWeights, ...weights };
    this.saveIntentWeights();
    
    console.log("[MaestroControlStore] Intent weights updated:", this.intentWeights);
  }

  // ============================================================================
  // Telemetry Hooks (no-ops until Phase 2)
  // ============================================================================

  /**
   * Emit telemetry event (no-op until Phase 2 TelemetryService implemented)
   */
  private emitTelemetry(eventType: string, data: any): void {
    // TODO: Phase 2 - Send to TelemetryService
    // For now, just log for debugging
    if (import.meta.env.DEV) {
      console.log(`[Telemetry] ${eventType}:`, data);
    }
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  private getDefaultPreferences(): EffectPreferences {
    return {
      particles: {
        enabled: true,
        spawnRateMultiplier: 0.3,  // Lower default - was too aggressive
        velocityMultiplier: 1.0,
        sizeMultiplier: 1.0,
      },
      warp: {
        enabled: true,
        elasticityMultiplier: 0.5,  // Lower default
        radiusMultiplier: 1.0,
      },
      mixer: {
        saturationMultiplier: 1.0,
        brightnessMultiplier: 1.0,
        contrastMultiplier: 1.0,
      },
      trace: {
        enabled: true,
        strengthMultiplier: 0.7,
      },
    };
  }

  private loadEffectPreferences(): EffectPreferences {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_PREFS);
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log("[MaestroControlStore] Loaded effect preferences from localStorage");
        return { ...this.getDefaultPreferences(), ...parsed };
      }
    } catch (error) {
      console.warn("[MaestroControlStore] Failed to load preferences:", error);
    }
    
    return this.getDefaultPreferences();
  }

  private saveEffectPreferences(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY_PREFS, JSON.stringify(this.effectPrefs));
    } catch (error) {
      console.warn("[MaestroControlStore] Failed to save preferences:", error);
    }
  }

  private loadIntentWeights(): IntentWeights {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_INTENT);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn("[MaestroControlStore] Failed to load intent weights:", error);
    }
    
    // Default equal weights
    return {
      calm: 0.25,
      build: 0.25,
      crescendo: 0.25,
      resolve: 0.25,
      version: 0,
    };
  }

  private saveIntentWeights(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY_INTENT, JSON.stringify(this.intentWeights));
    } catch (error) {
      console.warn("[MaestroControlStore] Failed to save intent weights:", error);
    }
  }
}
