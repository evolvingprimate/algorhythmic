import type { GenerationHealthPort } from './types/generation-ports';
import { GenerationFailure } from './openai-service';
import { telemetryService } from './telemetry-service';

/**
 * Recovery Manager for handling DALL-E health probes and gradual recovery
 * Based on Grok/ChatGPT recommendations:
 * - Jittered probes (±20%) to prevent thundering herd
 * - Budget cap to prevent runaway costs
 * - Gradual batch size recovery
 * - Lightweight probe prompts
 */
export class RecoveryManager {
  private batchSize = 1;
  private probeCostEstimate = 0; // Track estimated costs
  private probeAttempts = 0;
  private probeSuccesses = 0;
  private isProbing = false;
  private nextProbeTime = 0;
  
  // Configuration (based on reviewer feedback)
  private readonly HOURLY_BUDGET = 1.00; // $1/hour max for probes
  private readonly PROBE_COST_ESTIMATE = 0.04; // Estimated $0.04 per DALL-E probe
  private readonly MAX_PROBES_PER_HOUR = 25; // HOURLY_BUDGET / PROBE_COST_ESTIMATE
  private readonly PROBE_INTERVAL_MS = 120000; // Base 2 minutes
  private readonly PROBE_JITTER = 0.2; // ±20% jitter
  private readonly PROBE_TIMEOUT_MS = 30000; // 30s timeout for probes (shorter than regular)
  
  // Track costs over rolling hour window
  private probeCostHistory: { timestamp: number; cost: number }[] = [];
  
  // Lightweight probe prompts (minimal, fast to generate)
  // Phase 4D: Simplified probe prompts for minimal cost and complexity
  private readonly PROBE_PROMPTS = [
    'abstract geometric shape, no text, minimal detail',
    'simple abstract geometric pattern, no text, minimal detail',
    'basic geometric composition, no text, minimal detail',
    'minimal abstract shapes, no text, simple colors',
    'elementary geometric forms, no text, minimal complexity'
  ];

  constructor(
    private readonly generationHealth: GenerationHealthPort,
    private readonly generateArtImage: (prompt: string, options?: {
      isProbe?: boolean;
      skipTextDirective?: boolean;
    }) => Promise<string>
  ) {}

  /**
   * Get current recovery batch size for gradual scaling
   */
  getRecoveryBatchSize(): number {
    return this.batchSize;
  }

  /**
   * Check if we're within budget to attempt a probe
   */
  private isWithinBudget(): boolean {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    
    // Clean up old entries
    this.probeCostHistory = this.probeCostHistory.filter(
      entry => entry.timestamp > oneHourAgo
    );
    
    // Calculate total cost in last hour
    const totalCost = this.probeCostHistory.reduce((sum, entry) => sum + entry.cost, 0);
    
    return totalCost < this.HOURLY_BUDGET;
  }

  /**
   * Record probe cost for budget tracking
   */
  private recordProbeCost(): void {
    this.probeCostHistory.push({
      timestamp: Date.now(),
      cost: this.PROBE_COST_ESTIMATE
    });
    this.probeCostEstimate += this.PROBE_COST_ESTIMATE;
  }

  /**
   * Get jittered delay for next probe
   */
  private getJitteredDelay(): number {
    const jitterMultiplier = 1 - this.PROBE_JITTER + (Math.random() * 2 * this.PROBE_JITTER);
    return Math.round(this.PROBE_INTERVAL_MS * jitterMultiplier);
  }

  /**
   * Schedule the next recovery probe
   */
  scheduleProbe(): void {
    // Don't schedule if already probing or breaker is closed
    if (this.isProbing || this.generationHealth.getCurrentState() === 'closed') {
      return;
    }
    
    const delay = this.getJitteredDelay();
    this.nextProbeTime = Date.now() + delay;
    
    console.log(`[RecoveryManager] Scheduling probe in ${delay}ms (with ±20% jitter)`);
    
    setTimeout(() => {
      this.executeProbe();
    }, delay);
    
    telemetryService.recordEvent({
      event: 'recovery_probe_scheduled',
      category: 'system',
      severity: 'info',
      metrics: {
        delay_ms: delay,
        next_probe_time: this.nextProbeTime
      }
    });
  }

  /**
   * Execute a health probe
   */
  private async executeProbe(): Promise<void> {
    // Check if we should still probe
    if (this.generationHealth.getCurrentState() === 'closed') {
      console.log('[RecoveryManager] Circuit breaker closed, cancelling probe');
      return;
    }
    
    // Check budget
    if (!this.isWithinBudget()) {
      console.warn('[RecoveryManager] Probe budget exceeded, skipping probe');
      telemetryService.recordEvent({
        event: 'probe_budget_exceeded',
        category: 'system',
        severity: 'warning',
        metrics: {
          hourly_cost: this.probeCostEstimate,
          budget_limit: this.HOURLY_BUDGET
        }
      });
      
      // Schedule retry after budget reset
      setTimeout(() => this.scheduleProbe(), 3600000); // Try again in 1 hour
      return;
    }
    
    this.isProbing = true;
    this.probeAttempts++;
    
    // Select a random lightweight probe prompt
    const probePrompt = this.PROBE_PROMPTS[Math.floor(Math.random() * this.PROBE_PROMPTS.length)];
    
    console.log('[RecoveryManager] Executing health probe with lightweight prompt');
    
    telemetryService.recordEvent({
      event: 'recovery_probe_start',
      category: 'system',
      severity: 'info',
      metrics: {
        attempt_number: this.probeAttempts,
        batch_size: this.batchSize
      }
    });
    
    try {
      // Try a lightweight generation with shorter timeout
      const startTime = Date.now();
      
      // Note: Probes are handled specially by the generateArtImage function
      // The isProbe flag allows the generation to bypass certain checks
      const result = await this.generateArtImage(probePrompt, {
        isProbe: true,
        skipTextDirective: true // Probes don't need the no-text directive
      });
      
      const latency = Date.now() - startTime;
      
      // Probe succeeded!
      this.probeSuccesses++;
      this.onRecoverySuccess(latency);
      this.recordProbeCost();
      
    } catch (error) {
      // Probe failed
      this.onRecoveryFailure(error);
      this.recordProbeCost(); // Still count cost for failed attempts
      
    } finally {
      this.isProbing = false;
    }
  }

  /**
   * Handle successful probe - increase batch size
   */
  private onRecoverySuccess(latency: number): void {
    // Double batch size (up to 5)
    const oldBatchSize = this.batchSize;
    this.batchSize = Math.min(this.batchSize * 2, 5);
    
    console.log(`[RecoveryManager] Probe successful in ${latency}ms, batch size: ${oldBatchSize} → ${this.batchSize}`);
    
    telemetryService.recordEvent({
      event: 'recovery_probe_success',
      category: 'system',
      severity: 'info',
      metrics: {
        latency_ms: latency,
        old_batch_size: oldBatchSize,
        new_batch_size: this.batchSize,
        success_rate: this.probeSuccesses / this.probeAttempts
      }
    });
    
    // If fully recovered (batch size = 5), we can stop probing
    if (this.batchSize >= 5) {
      console.log('[RecoveryManager] Full recovery achieved');
      telemetryService.recordEvent({
        event: 'dalle_fully_recovered',
        category: 'system',
        severity: 'info',
        metrics: {
          total_probes: this.probeAttempts,
          successful_probes: this.probeSuccesses,
          total_cost: this.probeCostEstimate
        }
      });
      
      // Reset for next incident
      this.reset();
    } else {
      // Continue probing with gradual recovery
      this.scheduleProbe();
    }
  }

  /**
   * Handle failed probe
   */
  private onRecoveryFailure(error: any): void {
    console.error('[RecoveryManager] Probe failed:', error);
    
    // Reset batch size on failure
    this.batchSize = 1;
    
    telemetryService.recordEvent({
      event: 'recovery_probe_failed',
      category: 'system',
      severity: 'warning',
      metrics: {
        attempt_number: this.probeAttempts,
        error_type: error.name || 'unknown',
        success_rate: this.probeSuccesses / this.probeAttempts
      }
    });
    
    // Schedule next probe
    this.scheduleProbe();
  }

  /**
   * Reset recovery manager state
   */
  reset(): void {
    this.batchSize = 1;
    this.probeAttempts = 0;
    this.probeSuccesses = 0;
    this.isProbing = false;
    this.nextProbeTime = 0;
    
    console.log('[RecoveryManager] State reset');
  }

  /**
   * Get recovery status for monitoring
   */
  getStatus(): {
    isProbing: boolean;
    batchSize: number;
    probeAttempts: number;
    probeSuccesses: number;
    successRate: number;
    estimatedCost: number;
    nextProbeTime: number;
    budgetRemaining: number;
  } {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const recentCost = this.probeCostHistory
      .filter(entry => entry.timestamp > oneHourAgo)
      .reduce((sum, entry) => sum + entry.cost, 0);
    
    return {
      isProbing: this.isProbing,
      batchSize: this.batchSize,
      probeAttempts: this.probeAttempts,
      probeSuccesses: this.probeSuccesses,
      successRate: this.probeAttempts > 0 ? this.probeSuccesses / this.probeAttempts : 0,
      estimatedCost: this.probeCostEstimate,
      nextProbeTime: this.nextProbeTime,
      budgetRemaining: Math.max(0, this.HOURLY_BUDGET - recentCost)
    };
  }
  
  /**
   * Start monitoring circuit breaker state
   * This should be called after the recovery manager is instantiated
   */
  startMonitoring(): void {
    setInterval(() => {
      const breakerState = this.generationHealth.getCurrentState();
      
      // If breaker is open and we're not already probing, schedule a probe
      if (breakerState === 'open' || breakerState === 'half-open') {
        if (!this.isProbing && this.nextProbeTime === 0) {
          this.scheduleProbe();
        }
      }
    }, 10000); // Check every 10 seconds
  }
}

// Export singleton placeholder for backward compatibility
// This will be replaced in bootstrap.ts
export let recoveryManager: RecoveryManager;