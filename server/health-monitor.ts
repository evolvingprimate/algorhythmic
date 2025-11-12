/**
 * Health Monitor Service
 * 
 * Tracks service health, performance metrics, and dependency status
 * for production observability and monitoring
 */

import os from 'os';
import { sql } from 'drizzle-orm';
import type { IStorage } from './storage';
import { wsSequence } from './websocket-sequence';
import { telemetryService } from './telemetry-service';
import { queueService } from './bootstrap';
import { readFileSync } from 'fs';
import { join } from 'path';

// Package version from package.json
let packageVersion = '1.0.0';
try {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  packageVersion = packageJson.version || '1.0.0';
} catch (error) {
  console.warn('[HealthMonitor] Could not read package.json version');
}

// Service start time for uptime calculation
const SERVICE_START_TIME = Date.now();

// Metrics tracking
interface HealthMetrics {
  requests: {
    total: number;
    errors: number;
    lastMinute: number[];
  };
  artworks: {
    generated: number;
    cached: number;
  };
  users: {
    active: Set<string>;
    sessions: number;
  };
  performance: {
    responseTimes: number[];
    memorySnapshots: number[];
    cpuSnapshots: number[];
  };
}

// Dependency health status
interface DependencyHealth {
  database: { status: 'ok' | 'error'; latency?: number; error?: string };
  openai: { status: 'ok' | 'error'; error?: string };
  storage: { status: 'ok' | 'error'; error?: string };
  websocket: { status: 'ok' | 'error'; connections?: number; error?: string };
}

export class HealthMonitor {
  private metrics: HealthMetrics = {
    requests: {
      total: 0,
      errors: 0,
      lastMinute: new Array(60).fill(0),
    },
    artworks: {
      generated: 0,
      cached: 0,
    },
    users: {
      active: new Set(),
      sessions: 0,
    },
    performance: {
      responseTimes: [],
      memorySnapshots: [],
      cpuSnapshots: [],
    },
  };
  
  private isShuttingDown = false;
  private metricsInterval: NodeJS.Timeout | null = null;
  private minuteIndex = 0;

  constructor(private storage: IStorage) {
    // Start metrics collection
    this.startMetricsCollection();
  }

  /**
   * Start collecting metrics periodically
   */
  private startMetricsCollection(): void {
    // Update metrics every second
    this.metricsInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.rotateMinuteMetrics();
    }, 1000);
  }

  /**
   * Stop metrics collection
   */
  public stopMetricsCollection(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  /**
   * Collect system metrics (memory, CPU)
   */
  private collectSystemMetrics(): void {
    // Memory usage
    const memUsage = process.memoryUsage();
    const memoryMB = memUsage.heapUsed / 1024 / 1024;
    this.metrics.performance.memorySnapshots.push(memoryMB);
    
    // Keep only last 60 seconds of data
    if (this.metrics.performance.memorySnapshots.length > 60) {
      this.metrics.performance.memorySnapshots.shift();
    }

    // CPU usage (simplified - more accurate would require os.cpus() sampling)
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    
    const cpuUsage = 100 - ~~(100 * totalIdle / totalTick);
    this.metrics.performance.cpuSnapshots.push(cpuUsage);
    
    // Keep only last 60 seconds of CPU data
    if (this.metrics.performance.cpuSnapshots.length > 60) {
      this.metrics.performance.cpuSnapshots.shift();
    }
  }

  /**
   * Rotate minute-based request metrics
   */
  private rotateMinuteMetrics(): void {
    this.minuteIndex = (this.minuteIndex + 1) % 60;
    this.metrics.requests.lastMinute[this.minuteIndex] = 0;
  }

  /**
   * Track a request
   */
  public trackRequest(isError: boolean = false, responseTime?: number): void {
    this.metrics.requests.total++;
    this.metrics.requests.lastMinute[this.minuteIndex]++;
    
    if (isError) {
      this.metrics.requests.errors++;
    }
    
    if (responseTime !== undefined) {
      this.metrics.performance.responseTimes.push(responseTime);
      
      // Keep only last 100 response times for performance calculation
      if (this.metrics.performance.responseTimes.length > 100) {
        this.metrics.performance.responseTimes.shift();
      }
    }
  }

  /**
   * Track artwork generation
   */
  public trackArtworkGenerated(): void {
    this.metrics.artworks.generated++;
  }

  /**
   * Track artwork served from cache
   */
  public trackArtworkCached(): void {
    this.metrics.artworks.cached++;
  }

  /**
   * Track active user
   */
  public trackActiveUser(userId: string): void {
    this.metrics.users.active.add(userId);
  }

  /**
   * Track new session
   */
  public trackSession(): void {
    this.metrics.users.sessions++;
  }

  /**
   * Mark service as shutting down
   */
  public setShuttingDown(value: boolean): void {
    this.isShuttingDown = value;
  }

  /**
   * Get basic health status
   */
  public getBasicHealth(): {
    status: 'healthy' | 'unhealthy';
    timestamp: string;
    uptime: number;
    version: string;
  } {
    const uptime = Math.floor((Date.now() - SERVICE_START_TIME) / 1000);
    
    return {
      status: this.isShuttingDown ? 'unhealthy' : 'healthy',
      timestamp: new Date().toISOString(),
      uptime,
      version: packageVersion,
    };
  }

  /**
   * Check database health
   */
  private async checkDatabase(): Promise<DependencyHealth['database']> {
    try {
      const start = Date.now();
      await this.storage.ping();
      const latency = Date.now() - start;
      
      return {
        status: 'ok',
        latency,
      };
    } catch (error: any) {
      console.error('[HealthMonitor] Database check failed:', error);
      return {
        status: 'error',
        error: error.message || 'Database connection failed',
      };
    }
  }

  /**
   * Check OpenAI service health
   */
  private async checkOpenAI(): Promise<DependencyHealth['openai']> {
    try {
      // Check if API key is configured
      if (!process.env.OPENAI_API_KEY) {
        return {
          status: 'error',
          error: 'OpenAI API key not configured',
        };
      }
      
      // Check generation health service state
      const { generationHealthService } = await import('./bootstrap');
      const state = generationHealthService.getCurrentState();
      
      if (state === 'open') {
        return {
          status: 'error',
          error: 'Circuit breaker open - too many failures',
        };
      }
      
      return {
        status: 'ok',
      };
    } catch (error: any) {
      console.error('[HealthMonitor] OpenAI check failed:', error);
      return {
        status: 'error',
        error: error.message || 'OpenAI service check failed',
      };
    }
  }

  /**
   * Check object storage health
   */
  private async checkStorage(): Promise<DependencyHealth['storage']> {
    try {
      // Check if object storage is configured
      const hasObjectStorage = process.env.PUBLIC_OBJECT_SEARCH_PATHS || 
                               process.env.PRIVATE_OBJECT_DIR;
      
      if (!hasObjectStorage) {
        return {
          status: 'error',
          error: 'Object storage not configured',
        };
      }
      
      // Try to import ObjectStorageService
      const { ObjectStorageService } = await import('./objectStorage');
      const storageService = new ObjectStorageService();
      
      // Basic availability check
      return {
        status: 'ok',
      };
    } catch (error: any) {
      console.error('[HealthMonitor] Storage check failed:', error);
      return {
        status: 'error',
        error: error.message || 'Storage service check failed',
      };
    }
  }

  /**
   * Check WebSocket health
   */
  private async checkWebSocket(): Promise<DependencyHealth['websocket']> {
    try {
      // Get WebSocket connection count
      const connections = wsSequence.getConnectionCount();
      
      return {
        status: 'ok',
        connections,
      };
    } catch (error: any) {
      console.error('[HealthMonitor] WebSocket check failed:', error);
      return {
        status: 'error',
        error: error.message || 'WebSocket service check failed',
      };
    }
  }

  /**
   * Get readiness status with dependency checks
   */
  public async getReadinessStatus(): Promise<{
    status: 'ready' | 'not_ready';
    checks: DependencyHealth;
    timestamp: string;
  }> {
    // Run all dependency checks in parallel
    const [database, openai, storage, websocket] = await Promise.all([
      this.checkDatabase(),
      this.checkOpenAI(),
      this.checkStorage(),
      this.checkWebSocket(),
    ]);
    
    const checks: DependencyHealth = {
      database,
      openai,
      storage,
      websocket,
    };
    
    // Service is ready if all critical dependencies are ok
    // Database is critical, others can be degraded
    const isReady = database.status === 'ok';
    
    return {
      status: isReady ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get liveness status
   */
  public getLivenessStatus(): {
    alive: boolean;
  } {
    return {
      alive: !this.isShuttingDown,
    };
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get queue depth from queue service
   */
  private async getQueueDepth(): Promise<number> {
    try {
      const { queueController } = await import('./bootstrap');
      const metrics = await queueController.getQueueMetrics();
      return metrics.pendingJobs;
    } catch (error) {
      console.error('[HealthMonitor] Failed to get queue depth:', error);
      return 0;
    }
  }

  /**
   * Get service metrics
   */
  public async getMetrics(): Promise<{
    requests: {
      total: number;
      rate: string;
      errors: number;
    };
    artworks: {
      generated: number;
      cached: number;
      queue_depth: number;
    };
    users: {
      active: number;
      sessions: number;
    };
    performance: {
      avg_response_time: number;
      p95_response_time: number;
      memory_usage: number;
      cpu_usage: number;
    };
  }> {
    // Calculate request rate (requests per minute)
    const requestsPerMinute = this.metrics.requests.lastMinute.reduce((a, b) => a + b, 0);
    
    // Calculate average response time
    const avgResponseTime = this.metrics.performance.responseTimes.length > 0
      ? this.metrics.performance.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.performance.responseTimes.length
      : 0;
    
    // Calculate P95 response time
    const p95ResponseTime = this.calculatePercentile(this.metrics.performance.responseTimes, 95);
    
    // Get latest memory usage
    const memoryUsage = this.metrics.performance.memorySnapshots.length > 0
      ? this.metrics.performance.memorySnapshots[this.metrics.performance.memorySnapshots.length - 1]
      : 0;
    
    // Calculate average CPU usage
    const avgCpuUsage = this.metrics.performance.cpuSnapshots.length > 0
      ? this.metrics.performance.cpuSnapshots.reduce((a, b) => a + b, 0) / this.metrics.performance.cpuSnapshots.length
      : 0;
    
    // Get queue depth
    const queueDepth = await this.getQueueDepth();
    
    return {
      requests: {
        total: this.metrics.requests.total,
        rate: `${requestsPerMinute}/min`,
        errors: this.metrics.requests.errors,
      },
      artworks: {
        generated: this.metrics.artworks.generated,
        cached: this.metrics.artworks.cached,
        queue_depth: queueDepth,
      },
      users: {
        active: this.metrics.users.active.size,
        sessions: this.metrics.users.sessions,
      },
      performance: {
        avg_response_time: Math.round(avgResponseTime),
        p95_response_time: Math.round(p95ResponseTime),
        memory_usage: Math.round(memoryUsage),
        cpu_usage: Math.round(avgCpuUsage),
      },
    };
  }

  /**
   * Reset user activity tracking (call periodically, e.g., every hour)
   */
  public resetUserActivity(): void {
    this.metrics.users.active.clear();
  }
}

// Export singleton instance
let healthMonitor: HealthMonitor | null = null;

export function initializeHealthMonitor(storage: IStorage): HealthMonitor {
  if (!healthMonitor) {
    healthMonitor = new HealthMonitor(storage);
  }
  return healthMonitor;
}

export function getHealthMonitor(): HealthMonitor {
  if (!healthMonitor) {
    throw new Error('Health monitor not initialized');
  }
  return healthMonitor;
}