/**
 * Client-side Telemetry Collection
 * Tracks display performance metrics and batches them to the server
 */

import { queryClient, apiRequest } from './queryClient';

export interface ClientTelemetryEvent {
  timestamp: Date;
  category: 'display' | 'system';
  event: string;
  metrics: Record<string, any>;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export class ClientTelemetry {
  private buffer: ClientTelemetryEvent[] = [];
  private readonly MAX_BUFFER_SIZE = 100;
  private flushInterval = 10000; // 10 seconds
  private flushTimer: NodeJS.Timer | null = null;
  private sessionStartTime: number = Date.now();
  
  // Performance tracking
  private frameDisplayCount = 0;
  private blackFrameCount = 0;
  private placeholderCount = 0;
  private transitionLatencies: number[] = [];
  private lastFrameUrl: string | null = null;
  private lastFrameTime: number = 0;
  
  // Singleton instance
  private static instance: ClientTelemetry;
  
  private constructor() {
    // Start auto-flush timer
    this.startAutoFlush();
    
    // Listen for page unload to flush pending events
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.flush();
      });
    }
    
    console.log('[ClientTelemetry] Initialized with auto-flush every 10s');
  }
  
  public static getInstance(): ClientTelemetry {
    if (!ClientTelemetry.instance) {
      ClientTelemetry.instance = new ClientTelemetry();
    }
    return ClientTelemetry.instance;
  }
  
  /**
   * Track frame display event
   */
  public trackFrameDisplay(frameUrl: string, latency?: number): void {
    this.frameDisplayCount++;
    
    // Calculate transition latency if we have a previous frame
    if (this.lastFrameTime > 0 && latency === undefined) {
      latency = Date.now() - this.lastFrameTime;
    }
    
    if (latency !== undefined) {
      this.transitionLatencies.push(latency);
    }
    
    // Record event
    this.recordEvent({
      category: 'display',
      event: 'frame_displayed',
      metrics: {
        frameUrl,
        latencyMs: latency,
        frameNumber: this.frameDisplayCount
      },
      severity: 'info'
    });
    
    // Update tracking
    this.lastFrameUrl = frameUrl;
    this.lastFrameTime = Date.now();
  }
  
  /**
   * Track frame transition with performance timing
   */
  public trackFrameTransition(fromUrl: string, toUrl: string, transitionTime: number): void {
    this.transitionLatencies.push(transitionTime);
    
    this.recordEvent({
      category: 'display',
      event: 'frame_transition',
      metrics: {
        fromUrl,
        toUrl,
        latencyMs: transitionTime,
        frameNumber: this.frameDisplayCount
      },
      severity: transitionTime > 1500 ? 'warning' : 'info'
    });
  }
  
  /**
   * Track black frame detection
   */
  public trackBlackFrame(): void {
    this.blackFrameCount++;
    
    this.recordEvent({
      category: 'display',
      event: 'black_frame_detected',
      metrics: {
        count: this.blackFrameCount,
        lastFrameUrl: this.lastFrameUrl,
        timeSinceLastFrame: Date.now() - this.lastFrameTime
      },
      severity: 'critical'
    });
    
    console.error('[CRITICAL] Black frame detected!', {
      count: this.blackFrameCount,
      lastFrame: this.lastFrameUrl
    });
  }
  
  /**
   * Track placeholder usage
   */
  public trackPlaceholderUsage(): void {
    this.placeholderCount++;
    
    this.recordEvent({
      category: 'display',
      event: 'placeholder_used',
      metrics: {
        count: this.placeholderCount,
        timeSinceLastFrame: Date.now() - this.lastFrameTime
      },
      severity: 'critical'
    });
    
    console.warn('[WARNING] Emergency placeholder in use', {
      count: this.placeholderCount
    });
  }
  
  /**
   * Track morph cycle metrics
   */
  public trackMorphCycle(
    cycleNumber: number,
    duration: number,
    framesUsed: number,
    completed: boolean
  ): void {
    this.recordEvent({
      category: 'display',
      event: completed ? 'morph_cycle_complete' : 'morph_cycle_started',
      metrics: {
        cycleNumber,
        duration,
        framesUsed,
        avgFrameDuration: duration / framesUsed
      },
      severity: 'info'
    });
  }
  
  /**
   * Track frame buffer state
   */
  public trackFrameBuffer(
    freshCount: number,
    styleCount: number,
    globalCount: number,
    totalCount: number
  ): void {
    this.recordEvent({
      category: 'system',
      event: 'frame_buffer_update',
      metrics: {
        fresh: freshCount,
        style: styleCount,
        global: globalCount,
        total: totalCount,
        hasPlaceholder: totalCount === 0
      },
      severity: totalCount === 0 ? 'warning' : 'info'
    });
  }
  
  /**
   * Track WebGL/canvas performance
   */
  public trackRenderPerformance(fps: number, frameTime: number): void {
    this.recordEvent({
      category: 'display',
      event: 'render_performance',
      metrics: {
        fps,
        frameTimeMs: frameTime,
        belowTarget: fps < 30
      },
      severity: fps < 30 ? 'warning' : 'info'
    });
  }
  
  /**
   * Track memory usage
   */
  public trackMemoryUsage(): void {
    if (typeof window !== 'undefined' && 'performance' in window) {
      const perf = window.performance as any;
      if (perf.memory) {
        const usedMB = perf.memory.usedJSHeapSize / 1048576;
        const totalMB = perf.memory.totalJSHeapSize / 1048576;
        const limitMB = perf.memory.jsHeapSizeLimit / 1048576;
        
        this.recordEvent({
          category: 'system',
          event: 'memory_usage',
          metrics: {
            usedMB,
            totalMB,
            limitMB,
            percentUsed: (usedMB / limitMB) * 100
          },
          severity: usedMB > limitMB * 0.9 ? 'warning' : 'info'
        });
      }
    }
  }
  
  /**
   * Record an event to the buffer
   */
  private recordEvent(event: Omit<ClientTelemetryEvent, 'timestamp'>): void {
    const fullEvent: ClientTelemetryEvent = {
      ...event,
      timestamp: new Date()
    };
    
    this.buffer.push(fullEvent);
    
    // Trim buffer if too large
    if (this.buffer.length > this.MAX_BUFFER_SIZE) {
      // Flush immediately if buffer is full
      this.flush();
    }
  }
  
  /**
   * Flush buffered events to the server
   */
  public async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }
    
    const eventsToSend = [...this.buffer];
    this.buffer = [];
    
    try {
      // Calculate summary metrics for this batch
      const avgTransitionLatency = this.transitionLatencies.length > 0
        ? this.transitionLatencies.reduce((a, b) => a + b, 0) / this.transitionLatencies.length
        : 0;
      
      const payload = {
        events: eventsToSend,
        summary: {
          sessionDuration: Date.now() - this.sessionStartTime,
          frameDisplayCount: this.frameDisplayCount,
          blackFrameCount: this.blackFrameCount,
          placeholderCount: this.placeholderCount,
          avgTransitionLatency,
          eventCount: eventsToSend.length
        }
      };
      
      // Send to server
      await apiRequest('POST', '/api/telemetry/client', payload);
      
      console.log(`[ClientTelemetry] Flushed ${eventsToSend.length} events to server`);
      
      // Clear accumulated latencies after successful flush
      this.transitionLatencies = [];
    } catch (error) {
      console.error('[ClientTelemetry] Failed to flush events:', error);
      // Re-add events to buffer on failure (up to max size)
      this.buffer = [...eventsToSend.slice(-this.MAX_BUFFER_SIZE / 2), ...this.buffer];
    }
  }
  
  /**
   * Start auto-flush timer
   */
  private startAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flushTimer = setInterval(() => {
      this.flush();
      // Also track memory periodically
      this.trackMemoryUsage();
    }, this.flushInterval);
  }
  
  /**
   * Stop auto-flush timer
   */
  public stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
  
  /**
   * Get current metrics summary
   */
  public getMetricsSummary() {
    const avgLatency = this.transitionLatencies.length > 0
      ? this.transitionLatencies.reduce((a, b) => a + b, 0) / this.transitionLatencies.length
      : 0;
    
    return {
      sessionDuration: Date.now() - this.sessionStartTime,
      frameDisplayCount: this.frameDisplayCount,
      blackFrameCount: this.blackFrameCount,
      placeholderCount: this.placeholderCount,
      avgTransitionLatency: avgLatency,
      bufferedEvents: this.buffer.length
    };
  }
  
  /**
   * Reset all metrics (for testing)
   */
  public reset(): void {
    this.buffer = [];
    this.frameDisplayCount = 0;
    this.blackFrameCount = 0;
    this.placeholderCount = 0;
    this.transitionLatencies = [];
    this.lastFrameUrl = null;
    this.lastFrameTime = 0;
    this.sessionStartTime = Date.now();
  }
}

// Export singleton instance
export const clientTelemetry = ClientTelemetry.getInstance();