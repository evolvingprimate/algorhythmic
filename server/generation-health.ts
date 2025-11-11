import { telemetryService } from './telemetry-service';
import type { GenerationHealthPort, RecoveryPort } from './types/generation-ports';

/**
 * Token-bucket circuit breaker for DALL-E generation health management.
 * Implements adaptive timeout, sliding window failure tracking, and gradual recovery.
 * 
 * Based on feedback from Grok and ChatGPT:
 * - Token-bucket prevents flapping during sporadic issues
 * - Adaptive timeout tracks API performance drift
 * - Half-open state allows gradual recovery
 */

interface HealthMetrics {
  consecutiveFailures: number;
  lastFailureTime: number;
  totalTimeouts: number;
  totalSuccesses: number;
  successRate: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  queueDepth: number;
  oldestJobAge: number;
}

interface GenerationJob {
  id: string;
  startTime: number;
  expiresAt: number;
  isProbe: boolean;
}

class RollingStats {
  private samples: number[] = [];
  private timestamps: number[] = [];
  private readonly windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  addSample(value: number): void {
    const now = Date.now();
    this.samples.push(value);
    this.timestamps.push(now);
    this.cleanup();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.samples.shift();
      this.timestamps.shift();
    }
  }

  getPercentile(percentile: number): number {
    this.cleanup();
    if (this.samples.length === 0) {
      // Default to 50s if no data
      return 50000;
    }
    
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * (percentile / 100)) - 1;
    return sorted[Math.max(0, index)];
  }

  getCount(): number {
    this.cleanup();
    return this.samples.length;
  }
}

export class GenerationHealthService implements GenerationHealthPort {
  // Token-bucket circuit breaker (Grok's recommendation)
  private tokens = 0; // Failure tokens
  private lastRefill = Date.now();
  private openUntil = 0;
  
  // Configuration (based on observed data + reviewer feedback)
  // Phase 4 Tuning: Based on Grok/ChatGPT recommendations
  private readonly REFILL_MS = 60000; // 1 token drained every 60 seconds (faster recovery from sporadic issues)
  private readonly OPEN_TOKENS = 5; // Open breaker after 5 tokens (more resilient to sporadic failures)
  private readonly OPEN_DURATION_MS = 300000; // Stay open for 5 minutes
  private readonly MIN_TIMEOUT_MS = 45000; // Minimum timeout (45s)
  private readonly MAX_TIMEOUT_MS = 90000; // Maximum timeout (90s)
  private readonly TIMEOUT_BUFFER_MS = 10000; // P95 + 10s for adaptive timeout (more predictable than multiplier)
  
  // Half-open recovery configuration
  // Phase 4C: Enhanced recovery parameters
  private readonly HALF_OPEN_SAMPLE_RATE = 0.1; // Allow 10% traffic through (increased for better recovery testing)
  private readonly PROBE_INTERVAL_MS = 120000; // Base probe interval (2 minutes)
  private readonly PROBE_JITTER = 0.2; // ±20% jitter
  private readonly SLIDING_WINDOW_SIZE = 25; // Track last 25 requests
  private readonly FAILURE_THRESHOLD = 0.5; // Open breaker at 50% failure rate
  private readonly RECOVERY_SUCCESS_COUNT = 3; // Require 3 consecutive successes to fully recover
  
  // Metrics tracking
  private stats: RollingStats;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private totalTimeouts = 0;
  private totalSuccesses = 0;
  private totalAttempts = 0;
  
  // Phase 4C: Sliding window for failure tracking
  private slidingWindow: boolean[] = []; // true = success, false = failure
  private consecutiveRecoverySuccesses = 0; // Track consecutive successes in half-open state
  
  // Active job tracking
  private activeJobs = new Map<string, GenerationJob>();
  
  // Recovery state
  private recoveryBatchSize = 1;
  private probeScheduled = false;
  
  constructor() {
    this.stats = new RollingStats(3600000); // 1 hour window for P95 calculation
  }

  /**
   * Phase 4C: Add result to sliding window and check if breaker should open
   */
  private updateSlidingWindow(success: boolean): void {
    this.slidingWindow.push(success);
    
    // Keep window at configured size
    while (this.slidingWindow.length > this.SLIDING_WINDOW_SIZE) {
      this.slidingWindow.shift();
    }
    
    // Check failure rate if we have enough samples
    if (this.slidingWindow.length >= 10) { // Need minimum samples
      const failures = this.slidingWindow.filter(result => !result).length;
      const failureRate = failures / this.slidingWindow.length;
      
      // Open breaker if failure rate exceeds threshold
      if (failureRate >= this.FAILURE_THRESHOLD && this.isHealthy()) {
        telemetryService.recordEvent({
          event: 'sliding_window_threshold_exceeded',
          category: 'system',
          severity: 'warning',
          metrics: {
            failure_rate: failureRate,
            threshold: this.FAILURE_THRESHOLD,
            window_size: this.slidingWindow.length
          }
        });
        
        // Add tokens to trigger breaker opening
        this.tokens = this.OPEN_TOKENS;
        this.openBreaker();
      }
    }
  }

  /**
   * Phase 4C: Check if recovery is complete (3 consecutive successes)
   */
  private checkRecoveryComplete(): boolean {
    return this.consecutiveRecoverySuccesses >= this.RECOVERY_SUCCESS_COUNT;
  }

  /**
   * Refill tokens based on time elapsed (token decay mechanism)
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToRemove = Math.floor(elapsed / this.REFILL_MS);
    
    if (tokensToRemove > 0) {
      this.tokens = Math.max(0, this.tokens - tokensToRemove);
      this.lastRefill = now;
      
      // Log token decay for observability
      if (tokensToRemove > 0) {
        telemetryService.recordEvent({
          event: 'circuit_breaker_token_decay',
          category: 'system',
          severity: 'info',
          metrics: {
            tokens_removed: tokensToRemove,
            tokens_remaining: this.tokens
          }
        });
      }
    }
  }

  /**
   * Calculate adaptive timeout based on recent P95 latency
   * Phase 4B: Changed from P95 * 1.25 to P95 + 10s for more predictable behavior
   */
  getTimeout(): number {
    const p95 = this.stats.getPercentile(95);
    // P95 + 10 seconds buffer (more predictable than multiplier)
    const adaptiveTimeout = Math.round(p95 + this.TIMEOUT_BUFFER_MS);
    
    // Clamp between min and max (45s - 90s)
    const timeout = Math.max(
      this.MIN_TIMEOUT_MS, 
      Math.min(this.MAX_TIMEOUT_MS, adaptiveTimeout)
    );
    
    // Log when timeout changes significantly
    const lastTimeout = this.lastTimeout || timeout;
    if (Math.abs(timeout - lastTimeout) > 5000) {
      telemetryService.recordEvent({
        event: 'adaptive_timeout_changed',
        category: 'system',
        severity: 'info',
        metrics: {
          old_timeout: lastTimeout,
          new_timeout: timeout,
          p95_latency: p95
        }
      });
    }
    this.lastTimeout = timeout;
    
    return timeout;
  }
  
  private lastTimeout?: number;

  /**
   * Check if service is healthy (breaker closed)
   */
  isHealthy(): boolean {
    this.refill();
    return Date.now() > this.openUntil;
  }

  /**
   * Get current breaker state
   */
  getBreakerState(): 'closed' | 'open' | 'half-open' {
    if (this.isHealthy()) {
      return 'closed';
    }
    
    // If breaker is open but we're allowing some traffic through
    if (Date.now() <= this.openUntil) {
      const timeSinceOpen = Date.now() - (this.openUntil - this.OPEN_DURATION_MS);
      if (timeSinceOpen > this.OPEN_DURATION_MS * 0.5) {
        return 'half-open';
      }
      return 'open';
    }
    
    return 'closed';
  }

  /**
   * Determine if a generation should be attempted (implements half-open sampling)
   */
  shouldAttemptGeneration(): boolean {
    const state = this.getBreakerState();
    
    if (state === 'closed') {
      return true;
    }
    
    if (state === 'half-open') {
      // Probabilistic sampling during recovery
      const shouldSample = Math.random() < this.HALF_OPEN_SAMPLE_RATE;
      if (shouldSample) {
        telemetryService.recordEvent({
          event: 'half_open_sample_allowed',
          category: 'system',
          severity: 'info',
          metrics: {
            batch_size: this.recoveryBatchSize
          }
        });
      }
      return shouldSample;
    }
    
    // Breaker fully open
    return false;
  }

  /**
   * Record a successful generation
   */
  recordSuccess(latencyMs: number, jobId: string): void {
    this.refill();
    
    // Update metrics
    this.totalSuccesses++;
    this.totalAttempts++;
    this.consecutiveFailures = 0;
    this.stats.addSample(latencyMs);
    
    // Phase 4C: Update sliding window
    this.updateSlidingWindow(true);
    
    // Remove token on success (helps close breaker faster)
    this.tokens = Math.max(0, this.tokens - 1);
    
    // Remove from active jobs
    this.activeJobs.delete(jobId);
    
    // Phase 4C: Track consecutive recovery successes
    const currentState = this.getBreakerState();
    if (currentState === 'half-open') {
      this.consecutiveRecoverySuccesses++;
      
      // Check if we've recovered (3 consecutive successes)
      if (this.checkRecoveryComplete()) {
        // Close the breaker completely
        this.openUntil = 0;
        this.tokens = 0;
        this.consecutiveRecoverySuccesses = 0;
        this.recoveryBatchSize = 5; // Full capacity
        
        telemetryService.recordEvent({
          event: 'circuit_breaker_recovered',
          category: 'system',
          severity: 'info',
          metrics: {
            consecutive_successes: this.RECOVERY_SUCCESS_COUNT,
            recovery_batch_size: this.recoveryBatchSize
          }
        });
      } else {
        // Still recovering, gradually increase batch size
        this.recoveryBatchSize = Math.min(this.recoveryBatchSize * 2, 5);
        telemetryService.recordEvent({
          event: 'recovery_progress',
          category: 'system',
          severity: 'info',
          metrics: {
            consecutive_successes: this.consecutiveRecoverySuccesses,
            new_batch_size: this.recoveryBatchSize
          }
        });
      }
    } else if (currentState === 'closed') {
      // Reset recovery counter when fully closed
      this.consecutiveRecoverySuccesses = 0;
    }
    
    telemetryService.recordEvent({
      event: 'generation_success',
      category: 'generation',
      severity: 'info',
      metrics: {
        latency_ms: latencyMs,
        job_id: jobId,
        breaker_state: currentState
      }
    });
  }

  /**
   * Record a timeout or failure
   */
  recordTimeout(jobId: string, reason: 'timeout' | 'error' = 'timeout'): void {
    this.refill();
    
    // Update metrics
    this.totalTimeouts++;
    this.totalAttempts++;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    
    // Phase 4C: Update sliding window
    this.updateSlidingWindow(false);
    
    // Phase 4C: Reset consecutive recovery successes on failure
    if (this.getBreakerState() === 'half-open') {
      this.consecutiveRecoverySuccesses = 0;
      this.recoveryBatchSize = 1; // Reset batch size on failure during recovery
      
      telemetryService.recordEvent({
        event: 'recovery_reset',
        category: 'system',
        severity: 'warning',
        metrics: {
          reason: 'failure_during_recovery',
          failure_type: reason
        }
      });
    }
    
    // Add failure token
    this.tokens++;
    
    // Remove from active jobs
    const job = this.activeJobs.get(jobId);
    this.activeJobs.delete(jobId);
    
    telemetryService.recordEvent({
      event: 'generation_timeout',
      category: 'generation',
      severity: 'error',
      metrics: {
        job_id: jobId,
        reason: reason,
        consecutive_failures: this.consecutiveFailures,
        tokens: this.tokens,
        was_probe: job?.isProbe || false
      }
    });
    
    // Check if we should open the breaker
    if (this.tokens >= this.OPEN_TOKENS) {
      this.openBreaker();
    }
  }

  /**
   * Open the circuit breaker
   */
  private openBreaker(): void {
    this.openUntil = Date.now() + this.OPEN_DURATION_MS;
    this.recoveryBatchSize = 1; // Reset batch size
    
    telemetryService.recordEvent({
      event: 'circuit_breaker_opened',
      category: 'system',
      severity: 'warning',
      metrics: {
        service: 'dalle',
        duration_ms: this.OPEN_DURATION_MS,
        tokens: this.tokens,
        consecutive_failures: this.consecutiveFailures
      }
    });
    
    // Schedule recovery probe
    this.scheduleRecoveryProbe();
  }

  /**
   * Schedule a recovery probe with jitter
   */
  private scheduleRecoveryProbe(): void {
    if (this.probeScheduled) return;
    
    this.probeScheduled = true;
    const jitter = 1 - this.PROBE_JITTER + (Math.random() * 2 * this.PROBE_JITTER);
    const delay = Math.round(this.PROBE_INTERVAL_MS * jitter);
    
    setTimeout(() => {
      this.probeScheduled = false;
      telemetryService.recordEvent({
        event: 'recovery_probe_scheduled',
        category: 'system',
        severity: 'info',
        metrics: {
          delay_ms: delay
        }
      });
    }, delay);
  }

  /**
   * Register a new generation job
   */
  registerJob(jobId: string, isProbe: boolean = false): void {
    const timeout = this.getTimeout();
    this.activeJobs.set(jobId, {
      id: jobId,
      startTime: Date.now(),
      expiresAt: Date.now() + timeout + 30000, // Extra buffer
      isProbe
    });
  }

  /**
   * Check if a job result is still valid (not expired)
   */
  isJobValid(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (!job) return false;
    return Date.now() < job.expiresAt;
  }

  /**
   * Get current health metrics
   */
  getHealthMetrics(): HealthMetrics {
    const successRate = this.totalAttempts > 0 
      ? (this.totalSuccesses / this.totalAttempts) 
      : 1.0;
    
    // Calculate queue metrics
    let oldestJobAge = 0;
    const now = Date.now();
    const jobs = Array.from(this.activeJobs.values());
    for (const job of jobs) {
      const age = now - job.startTime;
      if (age > oldestJobAge) {
        oldestJobAge = age;
      }
    }
    
    return {
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
      totalTimeouts: this.totalTimeouts,
      totalSuccesses: this.totalSuccesses,
      successRate,
      p50Latency: this.stats.getPercentile(50),
      p95Latency: this.stats.getPercentile(95),
      p99Latency: this.stats.getPercentile(99),
      queueDepth: this.activeJobs.size,
      oldestJobAge
    };
  }

  /**
   * Get recovery batch size for gradual scaling
   */
  getRecoveryBatchSize(): number {
    return this.recoveryBatchSize;
  }

  /**
   * Clean up expired jobs (housekeeping)
   */
  cleanupExpiredJobs(): void {
    const now = Date.now();
    const expiredJobs: string[] = [];
    
    const entries = Array.from(this.activeJobs.entries());
    for (const [jobId, job] of entries) {
      if (now > job.expiresAt) {
        expiredJobs.push(jobId);
      }
    }
    
    for (const jobId of expiredJobs) {
      this.activeJobs.delete(jobId);
      telemetryService.recordEvent({
        event: 'late_success_dropped',
        category: 'system',
        severity: 'info',
        metrics: {
          job_id: jobId
        }
      });
    }
  }
  
  // ============== GenerationHealthPort Interface Methods ==============
  // These are thin adapter methods that delegate to existing logic
  
  /**
   * Record a failure with specific kind (required by GenerationHealthPort)
   */
  recordFailure(kind: 'timeout' | 'quota' | '5xx' | '4xx' | 'unknown', jobId: string): void {
    // Delegate timeout failures to existing recordTimeout
    if (kind === 'timeout') {
      this.recordTimeout(jobId, 'timeout');
      return;
    }
    
    // Handle other failure types similarly to timeout
    this.refill();
    
    // Update metrics
    this.totalAttempts++;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    
    // Phase 4C: Update sliding window
    this.updateSlidingWindow(false);
    
    // Phase 4C: Reset consecutive recovery successes on failure
    if (this.getBreakerState() === 'half-open') {
      this.consecutiveRecoverySuccesses = 0;
      this.recoveryBatchSize = 1; // Reset batch size on failure during recovery
      
      telemetryService.recordEvent({
        event: 'recovery_reset',
        category: 'system',
        severity: 'warning',
        metrics: {
          reason: 'failure_during_recovery',
          failure_type: kind
        }
      });
    }
    
    // Add failure token
    this.tokens++;
    
    // Remove from active jobs
    const job = this.activeJobs.get(jobId);
    this.activeJobs.delete(jobId);
    
    telemetryService.recordEvent({
      event: 'generation_failure',
      category: 'generation',
      severity: 'error',
      metrics: {
        job_id: jobId,
        failure_kind: kind,
        consecutive_failures: this.consecutiveFailures,
        tokens: this.tokens,
        was_probe: job?.isProbe || false
      }
    });
    
    // Check if we should open the breaker
    if (this.tokens >= this.OPEN_TOKENS) {
      this.openBreaker();
    }
  }
  
  /**
   * Get current circuit breaker state (required by GenerationHealthPort)
   * Alias for getBreakerState()
   */
  getCurrentState(): 'closed' | 'open' | 'half-open' {
    return this.getBreakerState();
  }
  
  /**
   * Get current token budget (required by GenerationHealthPort)
   * Returns remaining tokens before breaker opens
   */
  currentBudget(): number {
    this.refill();
    return Math.max(0, this.OPEN_TOKENS - this.tokens);
  }
  
  /**
   * Get simplified metrics (required by GenerationHealthPort)
   * Extracts subset from getHealthMetrics()
   */
  getMetrics(): {
    successRate: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    totalTimeouts: number;
    totalSuccesses: number;
  } {
    const fullMetrics = this.getHealthMetrics();
    return {
      successRate: fullMetrics.successRate,
      p50Latency: fullMetrics.p50Latency,
      p95Latency: fullMetrics.p95Latency,
      p99Latency: fullMetrics.p99Latency,
      totalTimeouts: fullMetrics.totalTimeouts,
      totalSuccesses: fullMetrics.totalSuccesses
    };
  }

  /**
   * Force the circuit breaker open for testing purposes
   * @param durationMs - How long to keep the breaker open (defaults to OPEN_DURATION_MS)
   * @returns Previous breaker state
   */
  forceOpen(durationMs?: number): 'closed' | 'open' | 'half-open' {
    const previousState = this.getBreakerState();
    const duration = durationMs || this.OPEN_DURATION_MS;
    
    // Force the breaker open
    this.openUntil = Date.now() + duration;
    this.tokens = this.OPEN_TOKENS;
    this.consecutiveRecoverySuccesses = 0;
    this.recoveryBatchSize = 1;
    
    telemetryService.recordEvent({
      event: 'test.breaker_forced_open',
      category: 'test',
      severity: 'warning',
      metrics: {
        previous_state: previousState,
        duration_ms: duration,
        tokens: this.tokens
      }
    });
    
    return previousState;
  }

  /**
   * Force the circuit breaker closed for testing purposes
   * @returns Previous breaker state
   */
  forceClosed(): 'closed' | 'open' | 'half-open' {
    const previousState = this.getBreakerState();
    
    // Reset the breaker to closed state
    this.openUntil = 0;
    this.tokens = 0;
    this.consecutiveFailures = 0;
    this.consecutiveRecoverySuccesses = 0;
    this.recoveryBatchSize = 5;
    this.slidingWindow = [];
    
    telemetryService.recordEvent({
      event: 'test.breaker_reset',
      category: 'test',
      severity: 'info',
      metrics: {
        previous_state: previousState,
        tokens_cleared: true,
        failures_reset: true
      }
    });
    
    return previousState;
  }

  /**
   * Get extended status for testing/monitoring
   */
  getDetailedStatus() {
    this.refill();
    
    const fullMetrics = this.getHealthMetrics();
    
    return {
      state: this.getBreakerState(),
      tokens: this.tokens,
      openUntil: this.openUntil > Date.now() ? new Date(this.openUntil).toISOString() : null,
      timeoutMs: this.getTimeout(),
      metrics: fullMetrics,
      slidingWindowSize: this.slidingWindow.length,
      slidingWindowFailures: this.slidingWindow.filter(r => !r).length,
      recoveryProgress: {
        consecutiveSuccesses: this.consecutiveRecoverySuccesses,
        requiredSuccesses: this.RECOVERY_SUCCESS_COUNT,
        batchSize: this.recoveryBatchSize
      },
      tokenBucket: {
        currentTokens: this.tokens,
        maxTokens: this.OPEN_TOKENS,
        refillRateMs: this.REFILL_MS,
        lastRefillTime: new Date(this.lastRefill).toISOString()
      }
    };
  }
}

// Singleton instance
export const generationHealthService = new GenerationHealthService();

// Run cleanup every minute
setInterval(() => {
  generationHealthService.cleanupExpiredJobs();
}, 60000);