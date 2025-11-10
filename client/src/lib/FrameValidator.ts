/**
 * FrameValidator - Ensures frames entering morph engine have never been seen
 * 
 * This service runs BEFORE blending starts, acting as a final gatekeeper against duplicates.
 * Similar to how architect validates agent actions, this validates frame selection.
 * 
 * Key Features:
 * - Session-scoped duplicate tracking
 * - Max retry cap (prevents spinner loops)
 * - Telemetry integration
 * - Resets on session change
 */

export interface ValidationResult {
  valid: boolean;
  rejectedFrameIds?: string[];
  reason?: string;
}

export interface FrameValidatorConfig {
  maxRetries?: number;
  enableTelemetry?: boolean;
}

export class FrameValidator {
  private seenFrameIds: Set<string>;
  private sessionId: string | null;
  private retryCount: number;
  private maxRetries: number;
  private enableTelemetry: boolean;
  
  constructor(config: FrameValidatorConfig = {}) {
    this.seenFrameIds = new Set();
    this.sessionId = null;
    this.retryCount = 0;
    this.maxRetries = config.maxRetries ?? 2;
    this.enableTelemetry = config.enableTelemetry ?? true;
  }
  
  /**
   * Validate frames before morphing
   * @param frameIds - Array of artwork IDs to validate
   * @param currentSessionId - Current session ID (triggers reset if changed)
   * @returns Validation result with rejection details
   */
  validate(frameIds: string[], currentSessionId: string): ValidationResult {
    // Reset if session changed
    if (this.sessionId !== currentSessionId) {
      this.reset(currentSessionId);
    }
    
    // CRITICAL: Deduplicate within current batch FIRST (same-batch repeats)
    const uniqueFrameIds = [...new Set(frameIds)];
    if (uniqueFrameIds.length < frameIds.length) {
      console.warn('[FrameValidator] ⚠️ Found duplicates within same batch:', {
        original: frameIds.length,
        unique: uniqueFrameIds.length,
        duplicates: frameIds.length - uniqueFrameIds.length,
      });
    }
    
    // Find duplicates against already-seen frames
    const duplicates = uniqueFrameIds.filter(id => this.seenFrameIds.has(id));
    
    if (duplicates.length > 0) {
      this.retryCount++;
      
      if (this.enableTelemetry) {
        console.warn('[FrameValidator] ❌ Rejected duplicate frames:', {
          duplicateCount: duplicates.length,
          duplicateIds: duplicates,
          retryAttempt: this.retryCount,
          maxRetries: this.maxRetries,
        });
      }
      
      // Check if max retries exceeded
      if (this.retryCount > this.maxRetries) {
        console.error('[FrameValidator] 🚨 Max retries exceeded - pool may be exhausted');
        return {
          valid: false,
          rejectedFrameIds: duplicates,
          reason: 'max_retries_exceeded',
        };
      }
      
      return {
        valid: false,
        rejectedFrameIds: duplicates,
        reason: 'duplicate_detected',
      };
    }
    
    // Mark frames as seen (using deduplicated set)
    uniqueFrameIds.forEach(id => this.seenFrameIds.add(id));
    
    // Reset retry counter on success
    this.retryCount = 0;
    
    if (this.enableTelemetry) {
      console.log(`[FrameValidator] ✅ Validated ${uniqueFrameIds.length} fresh frames (total seen: ${this.seenFrameIds.size})`);
    }
    
    return { valid: true };
  }
  
  /**
   * Seed validator with already-displayed frames
   * Use this when initializing validator mid-session
   */
  seed(frameIds: string[]) {
    frameIds.forEach(id => this.seenFrameIds.add(id));
    console.log(`[FrameValidator] 🌱 Seeded with ${frameIds.length} existing frames`);
  }
  
  /**
   * Reset validator state (call when session changes)
   */
  reset(newSessionId: string) {
    this.seenFrameIds.clear();
    this.sessionId = newSessionId;
    this.retryCount = 0;
    console.log(`[FrameValidator] 🔄 Reset for session: ${newSessionId}`);
  }
  
  /**
   * Get current state for debugging
   */
  getState() {
    return {
      seenCount: this.seenFrameIds.size,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      sessionId: this.sessionId,
    };
  }
}
