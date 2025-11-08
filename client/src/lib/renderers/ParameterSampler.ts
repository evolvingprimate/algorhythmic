import type { EnginePath } from '@shared/maestroTypes';
import { ParameterRegistry } from '../maestro/control/ParameterRegistry';

/**
 * ParameterSampler - Efficient parameter access with smart defaults
 * 
 * Features:
 *   - O(1) Map lookups from context.parameters
 *   - Automatic fallback to ParameterRegistry defaults
 *   - Type-safe parameter access
 *   - Frame-time snapshot caching for consistency
 * 
 * Design:
 *   - Samples parameters once per frame
 *   - Handles missing values gracefully
 *   - Provides typed accessors for common parameter types
 */
export class ParameterSampler {
  private registry: ParameterRegistry;
  private snapshot: Map<EnginePath, number | number[] | boolean | string>;
  
  constructor() {
    this.registry = new ParameterRegistry();
    this.snapshot = new Map();
  }
  
  /**
   * Sample parameters from context.parameters Map
   * Call this once per frame to create a consistent snapshot
   */
  sample(contextParameters: Map<string, number | number[] | boolean | string>): void {
    this.snapshot.clear();
    
    // Copy all context parameters
    contextParameters.forEach((value, key) => {
      this.snapshot.set(key as EnginePath, value);
    });
  }
  
  /**
   * Get a scalar (number) parameter with fallback to default
   */
  getScalar(path: EnginePath): number {
    const value = this.snapshot.get(path);
    
    if (value !== undefined && typeof value === 'number') {
      return value;
    }
    
    // Fallback to registry default
    const metadata = this.registry.get(path);
    if (metadata && typeof metadata.defaultValue === 'number') {
      return metadata.defaultValue;
    }
    
    console.warn(`[ParameterSampler] No value or default found for ${path}, using 0`);
    return 0;
  }
  
  /**
   * Get a vector (number[]) parameter with fallback to default
   */
  getVector(path: EnginePath): number[] {
    const value = this.snapshot.get(path);
    
    if (value !== undefined && Array.isArray(value)) {
      return value;
    }
    
    // Fallback to registry default
    const metadata = this.registry.get(path);
    if (metadata && Array.isArray(metadata.defaultValue)) {
      return metadata.defaultValue;
    }
    
    console.warn(`[ParameterSampler] No value or default found for ${path}, using [0]`);
    return [0];
  }
  
  /**
   * Get a boolean parameter with fallback to default
   */
  getBoolean(path: EnginePath): boolean {
    const value = this.snapshot.get(path);
    
    if (value !== undefined && typeof value === 'boolean') {
      return value;
    }
    
    // Fallback to registry default
    const metadata = this.registry.get(path);
    if (metadata && typeof metadata.defaultValue === 'boolean') {
      return metadata.defaultValue;
    }
    
    console.warn(`[ParameterSampler] No value or default found for ${path}, using false`);
    return false;
  }
  
  /**
   * Get a string parameter with fallback to default
   */
  getString(path: EnginePath): string {
    const value = this.snapshot.get(path);
    
    if (value !== undefined && typeof value === 'string') {
      return value;
    }
    
    // Fallback to registry default
    const metadata = this.registry.get(path);
    if (metadata && typeof metadata.defaultValue === 'string') {
      return metadata.defaultValue;
    }
    
    console.warn(`[ParameterSampler] No value or default found for ${path}, using empty string`);
    return '';
  }
  
  /**
   * Get raw value (any type) with optional fallback
   */
  getRaw(path: EnginePath, fallback?: number | number[] | boolean | string): number | number[] | boolean | string | undefined {
    const value = this.snapshot.get(path);
    
    if (value !== undefined) {
      return value;
    }
    
    if (fallback !== undefined) {
      return fallback;
    }
    
    // Fallback to registry default
    const metadata = this.registry.get(path);
    return metadata?.defaultValue;
  }
  
  /**
   * Check if a parameter has been set (either in snapshot or registry)
   */
  has(path: EnginePath): boolean {
    return this.snapshot.has(path) || this.registry.has(path);
  }
  
  /**
   * Get all sampled values for debugging
   */
  getAllValues(): Record<string, number | number[] | boolean | string> {
    const values: Record<string, number | number[] | boolean | string> = {};
    this.snapshot.forEach((value, path) => {
      values[path] = value;
    });
    return values;
  }
}
