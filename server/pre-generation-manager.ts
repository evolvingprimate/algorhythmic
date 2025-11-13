/**
 * PreGenerationManager - Orchestrates pre-generation with intelligent throttling
 * 
 * Responsibilities:
 * - Rate limiting using token bucket algorithm
 * - Health and queue depth checks before pre-generation
 * - Cooldown and backoff management
 * - Integration with CreditController and GenerationHealth
 * - Prevents queue flooding by gating pre-generation
 */

import type { IStorage } from "./storage";
import type { GenerationHealthPort } from "./types/generation-ports";
import type { CreditController } from "./generation/creditController";
import { telemetryService } from "./telemetry-service";
import type { QueueService } from "./queue-service";
import { JOB_PRIORITY } from "./queue-service";

export interface PreGenerationIntent {
  sessionId: string;
  userId: string;
  styles: string[];
  count: number;
  reason: string;
  urgency: 'low' | 'medium' | 'high';
}

interface TokenBucket {
  tokens: number;
  lastRefillTime: number;
  maxTokens: number;
  refillRatePerMinute: number;
}

interface PreGenQuota {
  perSessionHourly: number;
  perStyleHourly: number;
  globalHourly: number;
}

// Configuration for pre-generation management
const PRE_GEN_CONFIG = {
  // Token bucket settings
  MAX_TOKENS: 5,
  REFILL_RATE_PER_MINUTE: 1,
  
  // Queue health gates
  MAX_QUEUE_DEPTH: 3,
  MAX_ACTIVE_LIVE_JOBS: 0, // No pre-gen if any live jobs
  MAX_RECENT_TIMEOUTS: 2,
  TIMEOUT_WINDOW_MS: 300000, // 5 minutes
  
  // Cooldown and backoff
  MIN_INTERVAL_MS: 60000, // 1 minute between pre-gen batches
  BACKOFF_BASE_MS: 120000, // 2 minute base backoff
  MAX_BACKOFF_MS: 900000, // 15 minute max backoff
  
  // Quotas (per hour)
  QUOTA_PER_SESSION: 10,
  QUOTA_PER_STYLE: 20,
  QUOTA_GLOBAL: 50,
  
  // Priority decay
  STALE_THRESHOLD_MS: 300000, // 5 minutes
};

export class PreGenerationManager {
  private tokenBucket: TokenBucket;
  private lastPreGenTime = 0;
  private recentTimeouts: number[] = [];
  private backoffMultiplier = 1;
  
  // Track usage for quotas
  private sessionUsage = new Map<string, { count: number; resetTime: number }>();
  private styleUsage = new Map<string, { count: number; resetTime: number }>();
  private globalUsage = { count: 0, resetTime: Date.now() + 3600000 };
  
  constructor(
    private storage: IStorage,
    private generationHealth: GenerationHealthPort,
    private queueService: QueueService, // REQUIRED - no longer optional
    private creditController?: CreditController
  ) {
    // Validate required dependencies
    if (!queueService) {
      throw new Error('[PreGenManager] QueueService is required for pre-generation management');
    }
    if (!generationHealth) {
      throw new Error('[PreGenManager] GenerationHealth is required for pre-generation management');
    }
    
    // Initialize token bucket
    this.tokenBucket = {
      tokens: PRE_GEN_CONFIG.MAX_TOKENS,
      lastRefillTime: Date.now(),
      maxTokens: PRE_GEN_CONFIG.MAX_TOKENS,
      refillRatePerMinute: PRE_GEN_CONFIG.REFILL_RATE_PER_MINUTE
    };
  }
  
  /**
   * Process a pre-generation intent from PoolMonitor
   * Applies all gates and throttling before allowing pre-generation
   * Returns: { allowed: boolean, suppressUntil?: number, reason?: string }
   */
  async processIntent(intent: PreGenerationIntent): Promise<{ 
    allowed: boolean; 
    suppressUntil?: number;
    reason?: string;
  }> {
    console.log('[PreGenManager] Processing intent:', {
      sessionId: intent.sessionId,
      styles: intent.styles,
      count: intent.count,
      reason: intent.reason
    });
    
    // CHEAP GATES FIRST - before consuming resources
    
    // Gate 1: Check minimum interval
    const timeSinceLastPreGen = Date.now() - this.lastPreGenTime;
    if (timeSinceLastPreGen < PRE_GEN_CONFIG.MIN_INTERVAL_MS) {
      const suppressUntil = this.lastPreGenTime + PRE_GEN_CONFIG.MIN_INTERVAL_MS;
      console.log('[PreGenManager] Too soon since last pre-gen, suppressing until', new Date(suppressUntil));
      return { 
        allowed: false, 
        suppressUntil,
        reason: 'min_interval' 
      };
    }
    
    // Gate 2: Check queue depth (cheap if queue service available)
    const queueCheck = await this.checkQueueHealth();
    if (!queueCheck.healthy) {
      console.log('[PreGenManager] Queue not healthy:', queueCheck.reason);
      telemetryService.recordEvent({
        event: 'pregen_blocked_queue',
        category: 'pregen',
        severity: 'info',
        metrics: { reason: queueCheck.reason }
      });
      // Suppress for 30 seconds when queue is unhealthy
      return { 
        allowed: false, 
        suppressUntil: Date.now() + 30000,
        reason: queueCheck.reason 
      };
    }
    
    // Gate 3: Check generation health
    const healthCheck = this.checkGenerationHealth();
    if (!healthCheck.healthy) {
      console.log('[PreGenManager] Generation health degraded:', healthCheck.reason);
      // Suppress for 2 minutes when health is degraded
      return { 
        allowed: false, 
        suppressUntil: Date.now() + 120000,
        reason: healthCheck.reason 
      };
    }
    
    // Gate 4: Check recent timeouts
    if (this.hasRecentTimeouts()) {
      console.log('[PreGenManager] Recent timeouts detected, applying backoff');
      this.applyBackoff();
      // Suppress with exponential backoff
      const suppressUntil = Date.now() + (PRE_GEN_CONFIG.BACKOFF_BASE_MS * this.backoffMultiplier);
      return { 
        allowed: false, 
        suppressUntil,
        reason: 'recent_timeouts' 
      };
    }
    
    // Gate 5: Check quotas
    if (!this.checkQuotas(intent)) {
      console.log('[PreGenManager] Quota exceeded');
      // Suppress for 10 minutes when quota exceeded
      return { 
        allowed: false, 
        suppressUntil: Date.now() + 600000,
        reason: 'quota_exceeded' 
      };
    }
    
    // Gate 6: Check credits (if CreditController available)
    if (this.creditController) {
      const creditCheck = await this.creditController.shouldGenerate(
        intent.userId,
        { preGeneration: true }
      );
      if (!creditCheck.shouldGenerate) {
        console.log('[PreGenManager] Credit controller denied:', creditCheck.reason);
        // Suppress for 5 minutes when credits exhausted
        return { 
          allowed: false, 
          suppressUntil: Date.now() + 300000,
          reason: creditCheck.reason || 'insufficient_credits' 
        };
      }
    }
    
    // EXPENSIVE GATE LAST - consume token only if all other checks pass
    
    // Gate 7: Check if we have tokens available
    if (!this.consumeToken()) {
      console.log('[PreGenManager] No tokens available, skipping pre-generation');
      telemetryService.recordEvent({
        event: 'pregen_throttled',
        category: 'pregen',
        severity: 'info',
        metrics: { reason: 'no_tokens' }
      });
      // Suppress for 1 minute to allow token refill
      return { 
        allowed: false, 
        suppressUntil: Date.now() + 60000,
        reason: 'no_tokens' 
      };
    }
    
    // All gates passed, allow pre-generation
    try {
      await this.executePreGeneration(intent);
      
      // Update tracking
      this.lastPreGenTime = Date.now();
      this.updateQuotaUsage(intent);
      
      // Reset backoff on successful pre-gen
      this.backoffMultiplier = 1;
      
      return { allowed: true };
      
    } catch (error) {
      // If execution fails, record timeout and refund token
      console.error('[PreGenManager] Pre-generation execution failed:', error);
      this.recordTimeout();
      this.refundToken();
      
      // Suppress with backoff after failure
      const suppressUntil = Date.now() + (PRE_GEN_CONFIG.BACKOFF_BASE_MS * this.backoffMultiplier);
      return { 
        allowed: false, 
        suppressUntil,
        reason: 'execution_failed' 
      };
    }
  }
  
  /**
   * Token bucket implementation for rate limiting
   */
  private consumeToken(): boolean {
    // Refill tokens based on time elapsed
    const now = Date.now();
    const minutesElapsed = (now - this.tokenBucket.lastRefillTime) / 60000;
    const tokensToAdd = Math.floor(minutesElapsed * this.tokenBucket.refillRatePerMinute);
    
    if (tokensToAdd > 0) {
      this.tokenBucket.tokens = Math.min(
        this.tokenBucket.maxTokens,
        this.tokenBucket.tokens + tokensToAdd
      );
      this.tokenBucket.lastRefillTime = now;
    }
    
    // Try to consume a token
    if (this.tokenBucket.tokens >= 1) {
      this.tokenBucket.tokens--;
      return true;
    }
    
    return false;
  }
  
  private refundToken(): void {
    this.tokenBucket.tokens = Math.min(
      this.tokenBucket.maxTokens,
      this.tokenBucket.tokens + 1
    );
  }
  
  /**
   * Check if there have been recent timeouts
   */
  private hasRecentTimeouts(): boolean {
    const now = Date.now();
    const windowStart = now - PRE_GEN_CONFIG.TIMEOUT_WINDOW_MS;
    
    // Clean old timeouts
    this.recentTimeouts = this.recentTimeouts.filter(t => t > windowStart);
    
    return this.recentTimeouts.length > PRE_GEN_CONFIG.MAX_RECENT_TIMEOUTS;
  }
  
  /**
   * Record a timeout event
   */
  recordTimeout(): void {
    this.recentTimeouts.push(Date.now());
    telemetryService.recordEvent({
      event: 'pregen_timeout_recorded',
      category: 'pregen',
      severity: 'warning',
      metrics: { 
        recentTimeoutCount: this.recentTimeouts.length 
      }
    });
  }
  
  /**
   * Apply exponential backoff after failures
   */
  private applyBackoff(): void {
    this.backoffMultiplier = Math.min(this.backoffMultiplier * 2, 8);
    const backoffMs = Math.min(
      PRE_GEN_CONFIG.BACKOFF_BASE_MS * this.backoffMultiplier,
      PRE_GEN_CONFIG.MAX_BACKOFF_MS
    );
    this.lastPreGenTime = Date.now() - PRE_GEN_CONFIG.MIN_INTERVAL_MS + backoffMs;
  }
  
  /**
   * Check queue health before pre-generation
   */
  private async checkQueueHealth(): Promise<{ healthy: boolean; reason?: string }> {
    const metrics = this.queueService.getMetrics();
    
    // Check if live jobs are active
    if (metrics.activeLiveJobs > PRE_GEN_CONFIG.MAX_ACTIVE_LIVE_JOBS) {
      return { 
        healthy: false, 
        reason: `Live jobs active: ${metrics.activeLiveJobs}` 
      };
    }
    
    // Check queue depth (approximate by active jobs)
    if (metrics.activeJobs > PRE_GEN_CONFIG.MAX_QUEUE_DEPTH) {
      return { 
        healthy: false, 
        reason: `Queue depth too high: ${metrics.activeJobs}` 
      };
    }
    
    // Check if already at max pre-gen concurrency
    if (metrics.activePreGenJobs >= metrics.maxConcurrentPreGen) {
      return { 
        healthy: false, 
        reason: `Max pre-gen concurrency reached: ${metrics.activePreGenJobs}` 
      };
    }
    
    return { healthy: true };
  }
  
  /**
   * Check generation service health
   */
  private checkGenerationHealth(): { healthy: boolean; reason?: string } {
    if (!this.generationHealth) {
      return { healthy: true };
    }
    
    const health = this.generationHealth.getHealth();
    
    if (!health.isHealthy) {
      return { 
        healthy: false, 
        reason: health.reason || 'Generation service unhealthy' 
      };
    }
    
    // Check specific thresholds
    if (health.recentTimeouts > 5) {
      return { 
        healthy: false, 
        reason: `Too many recent timeouts: ${health.recentTimeouts}` 
      };
    }
    
    if (health.successRate < 0.5) {
      return { 
        healthy: false, 
        reason: `Low success rate: ${(health.successRate * 100).toFixed(1)}%` 
      };
    }
    
    return { healthy: true };
  }
  
  /**
   * Check if quotas allow pre-generation
   */
  private checkQuotas(intent: PreGenerationIntent): boolean {
    const now = Date.now();
    
    // Check global quota
    if (this.globalUsage.resetTime < now) {
      this.globalUsage = { count: 0, resetTime: now + 3600000 };
    }
    if (this.globalUsage.count >= PRE_GEN_CONFIG.QUOTA_GLOBAL) {
      return false;
    }
    
    // Check per-session quota
    const sessionQuota = this.sessionUsage.get(intent.sessionId);
    if (sessionQuota) {
      if (sessionQuota.resetTime < now) {
        this.sessionUsage.set(intent.sessionId, { count: 0, resetTime: now + 3600000 });
      } else if (sessionQuota.count >= PRE_GEN_CONFIG.QUOTA_PER_SESSION) {
        return false;
      }
    }
    
    // Check per-style quota
    for (const style of intent.styles) {
      const styleQuota = this.styleUsage.get(style);
      if (styleQuota) {
        if (styleQuota.resetTime < now) {
          this.styleUsage.set(style, { count: 0, resetTime: now + 3600000 });
        } else if (styleQuota.count >= PRE_GEN_CONFIG.QUOTA_PER_STYLE) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  /**
   * Update quota usage after successful pre-generation
   */
  private updateQuotaUsage(intent: PreGenerationIntent): void {
    const now = Date.now();
    
    // Update global
    this.globalUsage.count += intent.count;
    
    // Update session
    const sessionQuota = this.sessionUsage.get(intent.sessionId) || 
      { count: 0, resetTime: now + 3600000 };
    sessionQuota.count += intent.count;
    this.sessionUsage.set(intent.sessionId, sessionQuota);
    
    // Update styles
    for (const style of intent.styles) {
      const styleQuota = this.styleUsage.get(style) || 
        { count: 0, resetTime: now + 3600000 };
      styleQuota.count += intent.count;
      this.styleUsage.set(style, styleQuota);
    }
  }
  
  /**
   * Execute pre-generation by enqueueing jobs
   */
  private async executePreGeneration(intent: PreGenerationIntent): Promise<void> {
    try {
      // Enqueue pre-generation jobs via QueueService
      const jobIds = await this.queueService.enqueuePreGenerationJob(
        intent.userId,
        intent.sessionId,
        intent.styles,
        intent.count,
        intent.reason
      );
      
      console.log('[PreGenManager] Enqueued pre-generation jobs:', jobIds);
      
      telemetryService.recordEvent({
        event: 'pregen_executed',
        category: 'pregen',
        severity: 'info',
        metrics: {
          sessionId: intent.sessionId,
          userId: intent.userId,
          styles: intent.styles,
          count: intent.count,
          reason: intent.reason,
          jobIds: jobIds,
          urgency: intent.urgency
        }
      });
    } catch (error) {
      console.error('[PreGenManager] Failed to enqueue pre-generation:', error);
      
      // Re-throw to trigger error handling in processIntent
      throw error;
    }
  }
  
  /**
   * Get current manager metrics
   */
  getMetrics() {
    return {
      tokensAvailable: this.tokenBucket.tokens,
      maxTokens: this.tokenBucket.maxTokens,
      lastPreGenTime: this.lastPreGenTime,
      recentTimeouts: this.recentTimeouts.length,
      backoffMultiplier: this.backoffMultiplier,
      globalUsage: this.globalUsage.count,
      sessionQuotas: this.sessionUsage.size,
      styleQuotas: this.styleUsage.size
    };
  }
  
  /**
   * Reset state (for testing or recovery)
   */
  reset(): void {
    this.tokenBucket.tokens = PRE_GEN_CONFIG.MAX_TOKENS;
    this.lastPreGenTime = 0;
    this.recentTimeouts = [];
    this.backoffMultiplier = 1;
    this.sessionUsage.clear();
    this.styleUsage.clear();
    this.globalUsage = { count: 0, resetTime: Date.now() + 3600000 };
  }
}