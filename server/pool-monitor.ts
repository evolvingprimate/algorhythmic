/**
 * Pool Monitor Service - Real-time tracking of artwork pool health
 * 
 * Monitors:
 * - Fresh frame availability per session
 * - Active session count
 * - Pool coverage percentage
 * - Consumption rate trends
 * 
 * Triggers pre-generation when pool coverage drops below thresholds
 */

import { EventEmitter } from "events";
import type { IStorage } from "./storage";
import { telemetryService } from "./telemetry-service";
import type { GenerationHealthPort } from "./types/generation-ports";
import type { CreditController } from "./generation/creditController";

export interface PoolMetrics {
  timestamp: number;
  totalSessions: number;
  activeSessions: number;
  totalFramesAvailable: number;
  averageFramesPerSession: number;
  poolCoveragePercentage: number;
  consumptionRatePerMinute: number;
  predictedExhaustionMinutes: number | null;
  preGenerationActive: boolean;
  preGenerationQueued: number;
}

export interface PreGenerationRequest {
  sessionId: string;
  userId: string;
  styles: string[];
  count: number;
  priority: number;
  reason: string;
}

interface SessionPoolState {
  sessionId: string;
  userId: string;
  framesAvailable: number;
  consumptionRate: number; // frames per minute
  lastConsumedAt: number;
  isActive: boolean;
}

import { POOL_CONFIG } from './config/pool.config';
import type { PreGenerationIntent, PreGenerationManager } from "./pre-generation-manager";

export class PoolMonitor extends EventEmitter {
  private sessionPools = new Map<string, SessionPoolState>();
  private monitorInterval: NodeJS.Timeout | null = null;
  private lastPreGenTime = 0;
  private preGenCount = 0;
  private preGenCountResetTime = Date.now();
  private isMonitoring = false;
  
  // Track consumption events for rate calculation
  private consumptionEvents: Array<{ sessionId: string; timestamp: number }> = [];
  
  // Suppression tracking
  private suppressUntil = 0;
  private preGenerationManager?: PreGenerationManager;
  
  constructor(
    private storage: IStorage,
    private generationHealth: GenerationHealthPort,
    private creditController?: CreditController
  ) {
    super();
  }
  
  /**
   * Set the PreGenerationManager for coordinated throttling
   */
  setPreGenerationManager(manager: PreGenerationManager): void {
    this.preGenerationManager = manager;
  }
  
  /**
   * Start monitoring the pool
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      console.log('[PoolMonitor] Already monitoring');
      return;
    }
    
    this.isMonitoring = true;
    console.log('[PoolMonitor] Starting pool monitoring');
    
    // Initial pool assessment
    this.assessPoolHealth();
    
    // Schedule periodic monitoring
    this.monitorInterval = setInterval(() => {
      this.assessPoolHealth();
    }, POOL_CONFIG.MONITOR_INTERVAL_MS);
    
    telemetryService.recordEvent({
      event: 'pool_monitor_started',
      category: 'pool',
      severity: 'info',
    });
  }
  
  /**
   * Stop monitoring the pool
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    console.log('[PoolMonitor] Stopped pool monitoring');
    
    telemetryService.recordEvent({
      event: 'pool_monitor_stopped',
      category: 'pool',
      severity: 'info',
    });
  }
  
  /**
   * Record a frame consumption event
   */
  recordConsumption(sessionId: string, userId: string): void {
    const now = Date.now();
    
    // Add to consumption events
    this.consumptionEvents.push({ sessionId, timestamp: now });
    
    // Update session state
    const state = this.sessionPools.get(sessionId);
    if (state) {
      state.lastConsumedAt = now;
      state.isActive = true;
    } else {
      // New session, initialize state
      this.sessionPools.set(sessionId, {
        sessionId,
        userId,
        framesAvailable: 0,
        consumptionRate: 0,
        lastConsumedAt: now,
        isActive: true,
      });
    }
    
    // Clean up old consumption events
    const cutoff = now - POOL_CONFIG.CONSUMPTION_WINDOW_MS;
    this.consumptionEvents = this.consumptionEvents.filter(e => e.timestamp > cutoff);
  }
  
  /**
   * Update pool state for a session
   */
  async updateSessionPool(sessionId: string, userId: string): Promise<void> {
    try {
      // Get fresh frame count for this session
      const freshFrames = await this.storage.getFreshArtworks(sessionId, userId, 100);
      const framesAvailable = freshFrames.filter(f => f.imageUrl).length;
      
      // Calculate consumption rate
      const rate = this.calculateConsumptionRate(sessionId);
      
      // Update or create session state
      const state = this.sessionPools.get(sessionId) || {
        sessionId,
        userId,
        framesAvailable: 0,
        consumptionRate: 0,
        lastConsumedAt: 0,
        isActive: false,
      };
      
      state.framesAvailable = framesAvailable;
      state.consumptionRate = rate;
      
      // Check if session is still active
      const now = Date.now();
      state.isActive = (now - state.lastConsumedAt) < POOL_CONFIG.SESSION_INACTIVE_MS;
      
      this.sessionPools.set(sessionId, state);
      
    } catch (error) {
      console.error(`[PoolMonitor] Failed to update session pool for ${sessionId}:`, error);
    }
  }
  
  /**
   * Calculate consumption rate for a session
   */
  private calculateConsumptionRate(sessionId: string): number {
    const now = Date.now();
    const cutoff = now - POOL_CONFIG.CONSUMPTION_WINDOW_MS;
    
    const sessionEvents = this.consumptionEvents.filter(
      e => e.sessionId === sessionId && e.timestamp > cutoff
    );
    
    if (sessionEvents.length === 0) {
      return 0;
    }
    
    // Calculate rate per minute
    const windowMinutes = POOL_CONFIG.CONSUMPTION_WINDOW_MS / 60000;
    return sessionEvents.length / windowMinutes;
  }
  
  /**
   * Assess overall pool health and trigger pre-generation if needed
   */
  private async assessPoolHealth(): Promise<void> {
    try {
      // Clean up inactive sessions
      this.cleanupInactiveSessions();
      
      // Reset hourly pre-gen count if needed
      const now = Date.now();
      if (now - this.preGenCountResetTime > 3600000) {
        this.preGenCount = 0;
        this.preGenCountResetTime = now;
      }
      
      // Get active sessions
      const activeSessions = Array.from(this.sessionPools.values())
        .filter(s => s.isActive);
      
      if (activeSessions.length === 0) {
        return; // No active sessions, skip assessment
      }
      
      // Calculate metrics
      const metrics = await this.calculatePoolMetrics();
      
      // Log metrics
      telemetryService.recordEvent({
        event: 'pool_metrics',
        category: 'pool',
        severity: 'info',
        metrics: {
          coverage: metrics.poolCoveragePercentage,
          activeSessions: metrics.activeSessions,
          totalFrames: metrics.totalFramesAvailable,
          consumptionRate: metrics.consumptionRatePerMinute,
        }
      });
      
      // Emit metrics event
      this.emit('metrics', metrics);
      
      // Check thresholds
      if (metrics.poolCoveragePercentage >= POOL_CONFIG.CRITICAL_THRESHOLD) {
        console.error('[PoolMonitor] CRITICAL: Pool coverage at', metrics.poolCoveragePercentage);
        telemetryService.recordEvent({
          event: 'pool_critical',
          category: 'pool',
          severity: 'error',
          metrics: { coverage: metrics.poolCoveragePercentage }
        });
        
        // Trigger immediate pre-generation if possible
        await this.triggerEmergencyPreGeneration(metrics);
        
      } else if (metrics.poolCoveragePercentage >= POOL_CONFIG.PRE_GENERATION_THRESHOLD) {
        console.warn('[PoolMonitor] Pool coverage at', metrics.poolCoveragePercentage, '- triggering pre-generation');
        
        // Check if we can pre-generate (cooldown, circuit breaker, credits)
        if (this.canPreGenerate()) {
          await this.triggerPreGeneration(metrics);
        }
      }
      
    } catch (error) {
      console.error('[PoolMonitor] Failed to assess pool health:', error);
      telemetryService.recordEvent({
        event: 'pool_assessment_failed',
        category: 'pool',
        severity: 'error',
        metrics: { error: error.message }
      });
    }
  }
  
  /**
   * Calculate current pool metrics
   */
  async calculatePoolMetrics(): Promise<PoolMetrics> {
    const activeSessions = Array.from(this.sessionPools.values())
      .filter(s => s.isActive);
    
    const totalSessions = this.sessionPools.size;
    const activeSessionCount = activeSessions.length;
    
    // Calculate total frames and average
    let totalFrames = 0;
    activeSessions.forEach(s => {
      totalFrames += s.framesAvailable;
    });
    
    const averageFramesPerSession = activeSessionCount > 0 
      ? totalFrames / activeSessionCount 
      : 0;
    
    // Calculate pool coverage (how much of target is filled)
    const targetFrames = activeSessionCount * POOL_CONFIG.TARGET_POOL_SIZE;
    const poolCoveragePercentage = targetFrames > 0 
      ? 1 - (totalFrames / targetFrames)
      : 0;
    
    // Calculate overall consumption rate
    const consumptionRate = activeSessions.reduce((sum, s) => sum + s.consumptionRate, 0);
    
    // Predict exhaustion time
    let predictedExhaustionMinutes: number | null = null;
    if (consumptionRate > 0 && totalFrames > 0) {
      predictedExhaustionMinutes = totalFrames / consumptionRate;
    }
    
    return {
      timestamp: Date.now(),
      totalSessions,
      activeSessions: activeSessionCount,
      totalFramesAvailable: totalFrames,
      averageFramesPerSession,
      poolCoveragePercentage,
      consumptionRatePerMinute: consumptionRate,
      predictedExhaustionMinutes,
      preGenerationActive: false, // Will be set by queue service
      preGenerationQueued: 0, // Will be updated by queue service
    };
  }
  
  /**
   * Check if pre-generation is allowed
   */
  private canPreGenerate(): boolean {
    const now = Date.now();
    
    // Check cooldown
    if (now - this.lastPreGenTime < POOL_CONFIG.PRE_GEN_COOLDOWN_MS) {
      console.log('[PoolMonitor] Pre-generation on cooldown');
      return false;
    }
    
    // Check hourly limit
    if (this.preGenCount >= POOL_CONFIG.MAX_PRE_GEN_PER_HOUR) {
      console.log('[PoolMonitor] Hourly pre-generation limit reached');
      return false;
    }
    
    // Check cost limit
    const estimatedCost = this.preGenCount * POOL_CONFIG.COST_PER_GENERATION;
    if (estimatedCost >= POOL_CONFIG.MAX_HOURLY_SPEND) {
      console.log('[PoolMonitor] Hourly spend limit reached');
      return false;
    }
    
    // Check circuit breaker
    if (!this.generationHealth.shouldAttemptGeneration()) {
      console.log('[PoolMonitor] Circuit breaker preventing pre-generation');
      return false;
    }
    
    // Check credits if controller available
    if (this.creditController) {
      // TODO: Check if credits available for pre-generation
    }
    
    return true;
  }
  
  /**
   * Trigger pre-generation for low pool sessions
   */
  private async triggerPreGeneration(metrics: PoolMetrics): Promise<void> {
    console.log('[PoolMonitor] Considering pre-generation, coverage:', metrics.poolCoveragePercentage);
    
    // Check if we're suppressed
    const now = Date.now();
    if (this.suppressUntil > now) {
      console.log('[PoolMonitor] Pre-generation suppressed until', new Date(this.suppressUntil));
      return;
    }
    
    // If no PreGenerationManager, fall back to logging
    if (!this.preGenerationManager) {
      console.warn('[PoolMonitor] No PreGenerationManager configured, skipping pre-generation');
      return;
    }
    
    // Find sessions that need frames
    const needySessions = Array.from(this.sessionPools.values())
      .filter(s => s.isActive && s.framesAvailable < POOL_CONFIG.TARGET_POOL_SIZE)
      .sort((a, b) => a.framesAvailable - b.framesAvailable); // Prioritize emptiest pools
    
    if (needySessions.length === 0) {
      return;
    }
    
    // Select popular styles for diversity
    const popularStyles = await this.getPopularStyles();
    
    // Process only the neediest session to avoid flooding
    const session = needySessions[0];
    const needed = POOL_CONFIG.TARGET_POOL_SIZE - session.framesAvailable;
    const toGenerate = Math.min(needed, POOL_CONFIG.PRE_GEN_BATCH_SIZE);
    
    if (toGenerate > 0) {
      // Create intent for PreGenerationManager
      const intent: PreGenerationIntent = {
        sessionId: session.sessionId,
        userId: session.userId,
        styles: this.selectDiverseStyles(popularStyles, toGenerate),
        count: toGenerate,
        reason: `Pool at ${(metrics.poolCoveragePercentage * 100).toFixed(1)}% coverage`,
        urgency: metrics.poolCoveragePercentage > 0.9 ? 'high' : 'medium'
      };
      
      // Process through PreGenerationManager
      const result = await this.preGenerationManager.processIntent(intent);
      
      if (result.allowed) {
        console.log('[PoolMonitor] Pre-generation allowed and executed');
        
        // Update tracking
        this.lastPreGenTime = Date.now();
        this.preGenCount += toGenerate;
        
        telemetryService.recordEvent({
          event: 'pre_generation_triggered',
          category: 'pool',
          severity: 'info',
          metrics: {
            coverage: metrics.poolCoveragePercentage,
            sessionId: session.sessionId,
            frameCount: toGenerate,
            estimatedCost: toGenerate * POOL_CONFIG.COST_PER_GENERATION,
          }
        });
      } else {
        console.log('[PoolMonitor] Pre-generation denied:', result.reason);
        
        // Update suppression time if provided
        if (result.suppressUntil) {
          this.suppressUntil = result.suppressUntil;
          console.log('[PoolMonitor] Suppressing pre-generation until', new Date(this.suppressUntil));
        }
        
        telemetryService.recordEvent({
          event: 'pre_generation_denied',
          category: 'pool',
          severity: 'info',
          metrics: {
            coverage: metrics.poolCoveragePercentage,
            reason: result.reason,
            suppressUntil: result.suppressUntil
          }
        });
      }
    }
  }
  
  /**
   * Trigger emergency pre-generation for critical pool levels
   */
  private async triggerEmergencyPreGeneration(metrics: PoolMetrics): Promise<void> {
    console.error('[PoolMonitor] EMERGENCY pre-generation, coverage:', metrics.poolCoveragePercentage);
    
    // Override cooldown for emergency
    const requests: PreGenerationRequest[] = [];
    
    // Get all active sessions
    const activeSessions = Array.from(this.sessionPools.values())
      .filter(s => s.isActive && s.framesAvailable < POOL_CONFIG.MIN_POOL_SIZE);
    
    for (const session of activeSessions) {
      requests.push({
        sessionId: session.sessionId,
        userId: session.userId,
        styles: ['abstract', 'surrealism', 'impressionism'], // Quick fallback styles
        count: POOL_CONFIG.MIN_POOL_SIZE,
        priority: 10, // High priority for emergency
        reason: `EMERGENCY: Pool critical at ${(metrics.poolCoveragePercentage * 100).toFixed(1)}%`,
      });
    }
    
    if (requests.length > 0) {
      this.emit('emergency-generation', requests);
      
      telemetryService.recordEvent({
        event: 'emergency_generation_triggered',
        category: 'pool',
        severity: 'error',
        metrics: {
          coverage: metrics.poolCoveragePercentage,
          sessionCount: requests.length,
        }
      });
    }
  }
  
  /**
   * Get popular styles from recent generations
   */
  private async getPopularStyles(): Promise<string[]> {
    // TODO: Query database for most used styles in last hour
    // For now, return a diverse set of default styles
    return [
      'abstract', 'surrealism', 'impressionism', 'cyberpunk',
      'fantasy', 'minimalist', 'photorealism', 'vaporwave',
      'anime', 'gothic', 'psychedelic', 'art nouveau'
    ];
  }
  
  /**
   * Select diverse styles to avoid duplication
   */
  private selectDiverseStyles(availableStyles: string[], count: number): string[] {
    const selected: string[] = [];
    const stylesCopy = [...availableStyles];
    
    for (let i = 0; i < Math.min(count, stylesCopy.length); i++) {
      const randomIndex = Math.floor(Math.random() * stylesCopy.length);
      selected.push(stylesCopy[randomIndex]);
      stylesCopy.splice(randomIndex, 1); // Remove to avoid duplicates
    }
    
    // If we need more styles than available, cycle through again
    while (selected.length < count) {
      const randomStyle = availableStyles[Math.floor(Math.random() * availableStyles.length)];
      selected.push(randomStyle);
    }
    
    return selected;
  }
  
  /**
   * Clean up inactive sessions
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const cutoff = now - POOL_CONFIG.SESSION_INACTIVE_MS;
    
    for (const [sessionId, state] of this.sessionPools.entries()) {
      if (state.lastConsumedAt < cutoff) {
        this.sessionPools.delete(sessionId);
        console.log(`[PoolMonitor] Removed inactive session ${sessionId}`);
      }
    }
  }
  
  /**
   * Get current pool metrics snapshot
   */
  async getMetrics(): Promise<PoolMetrics> {
    return this.calculatePoolMetrics();
  }
  
  /**
   * Get session-specific pool state
   */
  getSessionState(sessionId: string): SessionPoolState | undefined {
    return this.sessionPools.get(sessionId);
  }
  
  /**
   * Force refresh pool state for a session
   */
  async refreshSession(sessionId: string, userId: string): Promise<void> {
    await this.updateSessionPool(sessionId, userId);
  }
}
