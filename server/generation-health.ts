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
  private readonly REFILL_MS = 180000; // 1 token drained every 3 minutes
  private readonly OPEN_TOKENS = 3; // Open breaker after 3 tokens
  private readonly OPEN_DURATION_MS = 300000; // Stay open for 5 minutes
  private readonly MIN_TIMEOUT_MS = 45000; // Minimum timeout (45s)
  private readonly MAX_TIMEOUT_MS = 90000; // Maximum timeout (90s)
  private readonly TIMEOUT_MULTIPLIER = 1.25; // P95 * 1.25 for adaptive timeout
  
  // Half-open recovery configuration
  private readonly HALF_OPEN_SAMPLE_RATE = 0.05; // Allow 5% traffic through
  private readonly PROBE_INTERVAL_MS = 120000; // Base probe interval (2 minutes)
  private readonly PROBE_JITTER = 0.2; // ±20% jitter
  
  // Metrics tracking
  private stats: RollingStats;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private totalTimeouts = 0;
  private totalSuccesses = 0;
  private totalAttempts = 0;
  
  // Active job tracking
  private activeJobs = new Map<string, GenerationJob>();
  
  // Recovery state
  private recoveryBatchSize = 1;
  private probeScheduled = false;
  
  constructor() {
    this.stats = new RollingStats(3600000); // 1 hour window for P95 calculation
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
   */
  getTimeout(): number {
    const p95 = this.stats.getPercentile(95);
    const adaptiveTimeout = Math.round(p95 * this.TIMEOUT_MULTIPLIER);
    
    // Clamp between min and max
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
    
    // Remove token on success (helps close breaker faster)
    this.tokens = Math.max(0, this.tokens - 1);
    
    // Remove from active jobs
    this.activeJobs.delete(jobId);
    
    // If we were in recovery, increase batch size
    if (this.getBreakerState() === 'half-open') {
      this.recoveryBatchSize = Math.min(this.recoveryBatchSize * 2, 5);
      telemetryService.recordEvent({
        event: 'recovery_batch_increased',
        category: 'system',
        severity: 'info',
        metrics: {
          new_batch_size: this.recoveryBatchSize
        }
      });
    }
    
    telemetryService.recordEvent({
      event: 'generation_success',
      category: 'generation',
      severity: 'info',
      metrics: {
        latency_ms: latencyMs,
        job_id: jobId,
        breaker_state: this.getBreakerState()
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
}

// Singleton instance
export const generationHealthService = new GenerationHealthService();

// Run cleanup every minute
setInterval(() => {
  generationHealthService.cleanupExpiredJobs();
}, 60000);