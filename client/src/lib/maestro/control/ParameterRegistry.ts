import type { EnginePath } from "@shared/maestroTypes";

/**
 * Parameter metadata - defines how a parameter behaves
 */
export interface ParamMetadata {
  path: EnginePath;
  defaultValue: number | number[] | boolean | string;
  min?: number;
  max?: number;
  unit?: "scalar" | "degrees" | "seconds" | "bars" | "percent";
  curve?: "linear" | "exponential" | "logarithmic";
  description?: string;
}

/**
 * ParameterRegistry - Declarative knob metadata and validation
 * 
 * Features:
 *   - Register parameter metadata (range, unit, curve)
 *   - Validate parameter updates
 *   - Bridge to RendererManager for actual execution
 *   - Provide introspection for debugging
 * 
 * Design:
 *   - Centralized source of truth for parameter constraints
 *   - Type-safe parameter paths (EnginePath)
 *   - Extensible for future parameter types
 */
export class ParameterRegistry {
  private params: Map<EnginePath, ParamMetadata> = new Map();
  private currentValues: Map<EnginePath, number | number[] | boolean | string> = new Map();
  
  constructor() {
    console.log("[ParameterRegistry] Initialized");
    this.registerDefaultParameters();
  }

  /**
   * Register default parameters for MorphEngine v2
   */
  private registerDefaultParameters(): void {
    // Particles system
    this.register({
      path: "particles.main.spawnRate",
      defaultValue: 100,
      min: 0,
      max: 1000,
      unit: "scalar",
      curve: "linear",
      description: "Particle spawn rate per second",
    });
    
    this.register({
      path: "particles.main.trailLength",
      defaultValue: 0.5,
      min: 0,
      max: 1,
      unit: "scalar",
      curve: "linear",
      description: "Particle trail decay rate",
    });
    
    this.register({
      path: "particles.main.colorBias",
      defaultValue: [1, 1, 1],
      description: "Particle color multiplier (RGB)",
    });
    
    this.register({
      path: "particles.main.velocity",
      defaultValue: 1.0,
      min: 0,
      max: 10,
      unit: "scalar",
      curve: "exponential",
      description: "Particle velocity multiplier",
    });
    
    this.register({
      path: "particles.main.size",
      defaultValue: 1.0,
      min: 0.1,
      max: 10,
      unit: "scalar",
      curve: "logarithmic",
      description: "Particle size multiplier",
    });
    
    // Trace/outline effects
    this.register({
      path: "trace.strength",
      defaultValue: 0.5,
      min: 0,
      max: 1,
      unit: "scalar",
      curve: "linear",
      description: "Edge detection strength",
    });
    
    this.register({
      path: "trace.thickness",
      defaultValue: 2.0,
      min: 0.5,
      max: 10,
      unit: "scalar",
      curve: "linear",
      description: "Traced line thickness",
    });
    
    // Warp/distortion effects
    this.register({
      path: "warp.elasticity",
      defaultValue: 0.5,
      min: 0,
      max: 1,
      unit: "scalar",
      curve: "linear",
      description: "Bass-reactive warp strength",
    });
    
    this.register({
      path: "warp.radius",
      defaultValue: 0.3,
      min: 0,
      max: 1,
      unit: "scalar",
      curve: "linear",
      description: "Warp effect radius",
    });
    
    // Color mixer
    this.register({
      path: "mixer.saturation",
      defaultValue: 1.0,
      min: 0,
      max: 2,
      unit: "scalar",
      curve: "linear",
      description: "Color saturation multiplier",
    });
    
    this.register({
      path: "mixer.brightness",
      defaultValue: 1.0,
      min: 0,
      max: 2,
      unit: "scalar",
      curve: "linear",
      description: "Brightness multiplier",
    });
    
    this.register({
      path: "mixer.contrast",
      defaultValue: 1.0,
      min: 0,
      max: 2,
      unit: "scalar",
      curve: "linear",
      description: "Contrast multiplier",
    });
    
    console.log(`[ParameterRegistry] Registered ${this.params.size} default parameters`);
  }

  /**
   * Register a parameter with metadata
   */
  register(metadata: ParamMetadata): void {
    this.params.set(metadata.path, metadata);
    this.currentValues.set(metadata.path, metadata.defaultValue);
  }

  /**
   * Get parameter metadata
   */
  get(path: EnginePath): ParamMetadata | undefined {
    return this.params.get(path);
  }

  /**
   * Check if parameter exists
   */
  has(path: EnginePath): boolean {
    return this.params.has(path);
  }

  /**
   * Validate a parameter value
   */
  validate(path: EnginePath, value: number | number[] | boolean | string): boolean {
    const metadata = this.params.get(path);
    if (!metadata) {
      console.warn(`[ParameterRegistry] Unknown parameter: ${path}`);
      return false;
    }
    
    // Type check
    if (typeof value !== typeof metadata.defaultValue) {
      console.warn(
        `[ParameterRegistry] Type mismatch for ${path}: ` +
        `expected ${typeof metadata.defaultValue}, got ${typeof value}`
      );
      return false;
    }
    
    // Range check for numbers
    if (typeof value === "number") {
      if (metadata.min !== undefined && value < metadata.min) {
        console.warn(`[ParameterRegistry] Value ${value} below min ${metadata.min} for ${path}`);
        return false;
      }
      if (metadata.max !== undefined && value > metadata.max) {
        console.warn(`[ParameterRegistry] Value ${value} above max ${metadata.max} for ${path}`);
        return false;
      }
    }
    
    // Array length check
    if (Array.isArray(value) && Array.isArray(metadata.defaultValue)) {
      if (value.length !== metadata.defaultValue.length) {
        console.warn(
          `[ParameterRegistry] Array length mismatch for ${path}: ` +
          `expected ${metadata.defaultValue.length}, got ${value.length}`
        );
        return false;
      }
    }
    
    return true;
  }

  /**
   * Set parameter value (with validation)
   */
  set(path: EnginePath, value: number | number[] | boolean | string): boolean {
    if (!this.validate(path, value)) {
      return false;
    }
    
    this.currentValues.set(path, value);
    return true;
  }

  /**
   * Get current parameter value (returns raw value, no transforms)
   * 
   * Note: Curve transforms should be applied at SET time, not retrieval time
   */
  getValue(path: EnginePath): number | number[] | boolean | string | undefined {
    return this.currentValues.get(path);
  }

  /**
   * Get all registered parameters
   */
  getAll(): ParamMetadata[] {
    return Array.from(this.params.values());
  }

  /**
   * Get all current values
   */
  getAllValues(): Record<string, number | number[] | boolean | string> {
    const values: Record<string, number | number[] | boolean | string> = {};
    this.currentValues.forEach((value, path) => {
      values[path] = value;
    });
    return values;
  }

  /**
   * Reset parameter to default value
   */
  reset(path: EnginePath): void {
    const metadata = this.params.get(path);
    if (metadata) {
      this.currentValues.set(path, metadata.defaultValue);
    }
  }

  /**
   * Reset all parameters to default values
   */
  resetAll(): void {
    this.params.forEach((metadata, path) => {
      this.currentValues.set(path, metadata.defaultValue);
    });
    console.log("[ParameterRegistry] Reset all parameters to defaults");
  }

  /**
   * Apply curve transformation to a value
   */
  applyCurve(
    value: number,
    min: number,
    max: number,
    curve: "linear" | "exponential" | "logarithmic" = "linear"
  ): number {
    // Normalize to 0-1
    const normalized = (value - min) / (max - min);
    
    let transformed: number;
    switch (curve) {
      case "exponential":
        transformed = Math.pow(normalized, 2);
        break;
      case "logarithmic":
        transformed = Math.sqrt(normalized);
        break;
      default:
        transformed = normalized;
    }
    
    // Map back to range
    return min + transformed * (max - min);
  }
}
