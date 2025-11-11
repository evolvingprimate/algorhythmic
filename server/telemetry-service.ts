/**
 * Telemetry Service - Comprehensive monitoring and alerting
 * Tracks key metrics across the Algorhythmic platform to ensure:
 * - Zero black frames
 * - <100ms display latency
 * - <5% time in fallback mode
 */

export interface TelemetryEvent {
  timestamp: Date;
  category: 'generation' | 'display' | 'fallback' | 'websocket' | 'system';
  event: string;
  metrics: Record<string, any>;
  severity: 'info' | 'warning' | 'error' | 'critical';
  sessionId?: string;
  userId?: string;
}

export interface Alert {
  condition: string;
  message: string;
  severity: 'warning' | 'critical';
  value: number;
  threshold: number;
  timestamp: Date;
}

export interface MetricsSummary {
  // Frame Generation Metrics
  generationSuccessRate: number;
  generationFailureRate: number;
  avgGenerationLatency: number;
  queueDepth: {
    current: number;
    min: number;
    max: number;
    avg: number;
  };
  fallbackUsage: {
    fresh: number;
    style: number;
    global: number;
    total: number;
    rate: number; // Percentage of total requests
  };
  placeholderUsage: number;
  
  // Display Performance Metrics
  blackFrameCount: number;
  avgTransitionLatency: number;
  morphCycleCompletionRate: number;
  schedulerStateTransitions: number;
  frameBufferSizes: {
    fresh: number;
    style: number;
    global: number;
    total: number;
  };
  
  // System Health Metrics
  websocketConnections: {
    active: number;
    disconnected: number;
    reconnected: number;
    stability: number; // Percentage
  };
  ackSuccessRate: number;
  heartbeatResponseRate: number;
  memoryUsage: {
    eventBuffer: number;
    metricsMap: number;
    estimatedMB: number;
  };
  
  // Time Range
  timeRange: {
    start: Date;
    end: Date;
    durationMs: number;
  };
}

// Alert thresholds
const ALERT_CONDITIONS = {
  BLACK_FRAME: {
    threshold: 0, // Zero tolerance
    message: 'Black frame detected!',
    severity: 'critical' as const
  },
  FALLBACK_RATE: {
    threshold: 0.05, // 5% max
    message: 'High fallback usage detected',
    severity: 'warning' as const
  },
  GENERATION_LATENCY: {
    threshold: 60000, // 60s max
    message: 'Generation taking too long',
    severity: 'warning' as const
  },
  WEBSOCKET_DISCONNECTS: {
    threshold: 5, // per minute
    message: 'WebSocket instability detected',
    severity: 'warning' as const
  },
  QUEUE_UNDERFLOW: {
    threshold: 2, // MIN_FRAMES
    message: 'Queue below minimum threshold',
    severity: 'critical' as const
  },
  PLACEHOLDER_USAGE: {
    threshold: 1, // Any usage is concerning
    message: 'Emergency placeholder in use',
    severity: 'critical' as const
  },
  TRANSITION_LATENCY: {
    threshold: 1500, // 1500ms max
    message: 'Frame transitions too slow',
    severity: 'warning' as const
  },
  ACK_FAILURE: {
    threshold: 0.9, // 90% success rate minimum
    message: 'WebSocket ACK failure rate high',
    severity: 'warning' as const
  }
};

export class TelemetryService {
  private events: TelemetryEvent[] = [];
  private readonly MAX_EVENTS = 10000;
  private metrics: Map<string, number> = new Map();
  private startTime: Date = new Date();
  
  // Specific counters for critical metrics
  private counters = {
    blackFrames: 0,
    placeholderUsage: 0,
    fallbackFresh: 0,
    fallbackStyle: 0,
    fallbackGlobal: 0,
    generationSuccess: 0,
    generationFailure: 0,
    websocketConnects: 0,
    websocketDisconnects: 0,
    websocketReconnects: 0,
    ackSuccess: 0,
    ackFailure: 0,
    heartbeatSuccess: 0,
    heartbeatMissed: 0,
    morphCyclesCompleted: 0,
    morphCyclesStarted: 0,
    schedulerTransitions: 0
  };
  
  // Latency tracking
  private latencies = {
    generation: [] as number[],
    transition: [] as number[],
    fallback: [] as number[],
    websocket: [] as number[]
  };
  
  // Queue depth tracking
  private queueDepths: number[] = [];
  
  // Frame buffer tracking
  private frameBufferSizes = {
    fresh: 0,
    style: 0,
    global: 0
  };
  
  // Singleton instance
  private static instance: TelemetryService;
  
  private constructor() {
    console.log('[TelemetryService] Initialized with monitoring for success criteria');
  }
  
  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }
  
  /**
   * Record a telemetry event
   */
  public recordEvent(event: Omit<TelemetryEvent, 'timestamp'>): void {
    const fullEvent: TelemetryEvent = {
      ...event,
      timestamp: new Date()
    };
    
    // Store event
    this.events.push(fullEvent);
    
    // Process event for specific metrics
    this.processEventMetrics(fullEvent);
    
    // Trim events if exceeding max
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }
    
    // Log critical events
    if (event.severity === 'critical') {
      console.error(`[CRITICAL] ${event.category}/${event.event}:`, event.metrics);
    } else if (event.severity === 'error') {
      console.error(`[ERROR] ${event.category}/${event.event}:`, event.metrics);
    }
  }
  
  /**
   * Process event for specific metric tracking
   */
  private processEventMetrics(event: TelemetryEvent): void {
    // Track black frames
    if (event.event === 'black_frame_detected') {
      this.counters.blackFrames++;
    }
    
    // Track placeholder usage
    if (event.event === 'placeholder_used') {
      this.counters.placeholderUsage++;
    }
    
    // Track fallback tiers
    if (event.category === 'fallback' && event.event === 'tier_selected') {
      const tier = event.metrics.tier;
      if (tier === 'fresh') this.counters.fallbackFresh++;
      else if (tier === 'style-matched') this.counters.fallbackStyle++;
      else if (tier === 'global') this.counters.fallbackGlobal++;
      
      // Track fallback latency
      if (event.metrics.latencyMs) {
        this.latencies.fallback.push(event.metrics.latencyMs);
      }
    }
    
    // Track generation metrics
    if (event.category === 'generation') {
      if (event.event === 'generation_success') {
        this.counters.generationSuccess++;
        if (event.metrics.latencyMs) {
          this.latencies.generation.push(event.metrics.latencyMs);
        }
      } else if (event.event === 'generation_failure') {
        this.counters.generationFailure++;
      } else if (event.event === 'queue_state_change') {
        this.counters.schedulerTransitions++;
        if (event.metrics.queueSize !== undefined) {
          this.queueDepths.push(event.metrics.queueSize);
        }
      }
    }
    
    // Track display metrics
    if (event.category === 'display') {
      if (event.event === 'frame_transition') {
        if (event.metrics.latencyMs) {
          this.latencies.transition.push(event.metrics.latencyMs);
        }
      } else if (event.event === 'morph_cycle_complete') {
        this.counters.morphCyclesCompleted++;
      } else if (event.event === 'morph_cycle_started') {
        this.counters.morphCyclesStarted++;
      }
    }
    
    // Track WebSocket metrics
    if (event.category === 'websocket') {
      if (event.event === 'connection_established') {
        this.counters.websocketConnects++;
      } else if (event.event === 'connection_lost') {
        this.counters.websocketDisconnects++;
      } else if (event.event === 'connection_restored') {
        this.counters.websocketReconnects++;
      } else if (event.event === 'ack_success') {
        this.counters.ackSuccess++;
      } else if (event.event === 'ack_failure') {
        this.counters.ackFailure++;
      } else if (event.event === 'heartbeat_success') {
        this.counters.heartbeatSuccess++;
      } else if (event.event === 'heartbeat_missed') {
        this.counters.heartbeatMissed++;
      }
      
      if (event.metrics.latencyMs) {
        this.latencies.websocket.push(event.metrics.latencyMs);
      }
    }
    
    // Track system metrics
    if (event.category === 'system' && event.event === 'frame_buffer_update') {
      if (event.metrics.fresh !== undefined) this.frameBufferSizes.fresh = event.metrics.fresh;
      if (event.metrics.style !== undefined) this.frameBufferSizes.style = event.metrics.style;
      if (event.metrics.global !== undefined) this.frameBufferSizes.global = event.metrics.global;
    }
  }
  
  /**
   * Increment a counter metric
   */
  public incrementCounter(metric: string, value: number = 1): void {
    const current = this.metrics.get(metric) || 0;
    this.metrics.set(metric, current + value);
  }
  
  /**
   * Record latency for a metric
   */
  public recordLatency(metric: string, startTime: number): void {
    const latency = Date.now() - startTime;
    const key = `${metric}_latency`;
    const latencies = this.metrics.get(key) || 0;
    const count = this.metrics.get(`${key}_count`) || 0;
    
    // Update running average
    this.metrics.set(key, (latencies * count + latency) / (count + 1));
    this.metrics.set(`${key}_count`, count + 1);
  }
  
  /**
   * Check for alert conditions
   */
  public checkAlerts(): Alert[] {
    const alerts: Alert[] = [];
    const summary = this.getMetricsSummary();
    
    // Check black frames (zero tolerance)
    if (summary.blackFrameCount > ALERT_CONDITIONS.BLACK_FRAME.threshold) {
      alerts.push({
        condition: 'BLACK_FRAME',
        message: ALERT_CONDITIONS.BLACK_FRAME.message,
        severity: ALERT_CONDITIONS.BLACK_FRAME.severity,
        value: summary.blackFrameCount,
        threshold: ALERT_CONDITIONS.BLACK_FRAME.threshold,
        timestamp: new Date()
      });
    }
    
    // Check fallback rate
    if (summary.fallbackUsage.rate > ALERT_CONDITIONS.FALLBACK_RATE.threshold) {
      alerts.push({
        condition: 'FALLBACK_RATE',
        message: ALERT_CONDITIONS.FALLBACK_RATE.message,
        severity: ALERT_CONDITIONS.FALLBACK_RATE.severity,
        value: summary.fallbackUsage.rate,
        threshold: ALERT_CONDITIONS.FALLBACK_RATE.threshold,
        timestamp: new Date()
      });
    }
    
    // Check generation latency
    if (summary.avgGenerationLatency > ALERT_CONDITIONS.GENERATION_LATENCY.threshold) {
      alerts.push({
        condition: 'GENERATION_LATENCY',
        message: ALERT_CONDITIONS.GENERATION_LATENCY.message,
        severity: ALERT_CONDITIONS.GENERATION_LATENCY.severity,
        value: summary.avgGenerationLatency,
        threshold: ALERT_CONDITIONS.GENERATION_LATENCY.threshold,
        timestamp: new Date()
      });
    }
    
    // Check transition latency
    if (summary.avgTransitionLatency > ALERT_CONDITIONS.TRANSITION_LATENCY.threshold) {
      alerts.push({
        condition: 'TRANSITION_LATENCY',
        message: ALERT_CONDITIONS.TRANSITION_LATENCY.message,
        severity: ALERT_CONDITIONS.TRANSITION_LATENCY.severity,
        value: summary.avgTransitionLatency,
        threshold: ALERT_CONDITIONS.TRANSITION_LATENCY.threshold,
        timestamp: new Date()
      });
    }
    
    // Check WebSocket disconnects rate
    const durationMinutes = (Date.now() - this.startTime.getTime()) / 60000;
    const disconnectsPerMinute = this.counters.websocketDisconnects / Math.max(1, durationMinutes);
    if (disconnectsPerMinute > ALERT_CONDITIONS.WEBSOCKET_DISCONNECTS.threshold) {
      alerts.push({
        condition: 'WEBSOCKET_DISCONNECTS',
        message: ALERT_CONDITIONS.WEBSOCKET_DISCONNECTS.message,
        severity: ALERT_CONDITIONS.WEBSOCKET_DISCONNECTS.severity,
        value: disconnectsPerMinute,
        threshold: ALERT_CONDITIONS.WEBSOCKET_DISCONNECTS.threshold,
        timestamp: new Date()
      });
    }
    
    // Check queue underflow
    if (summary.queueDepth.current < ALERT_CONDITIONS.QUEUE_UNDERFLOW.threshold) {
      alerts.push({
        condition: 'QUEUE_UNDERFLOW',
        message: ALERT_CONDITIONS.QUEUE_UNDERFLOW.message,
        severity: ALERT_CONDITIONS.QUEUE_UNDERFLOW.severity,
        value: summary.queueDepth.current,
        threshold: ALERT_CONDITIONS.QUEUE_UNDERFLOW.threshold,
        timestamp: new Date()
      });
    }
    
    // Check placeholder usage
    if (summary.placeholderUsage > ALERT_CONDITIONS.PLACEHOLDER_USAGE.threshold) {
      alerts.push({
        condition: 'PLACEHOLDER_USAGE',
        message: ALERT_CONDITIONS.PLACEHOLDER_USAGE.message,
        severity: ALERT_CONDITIONS.PLACEHOLDER_USAGE.severity,
        value: summary.placeholderUsage,
        threshold: ALERT_CONDITIONS.PLACEHOLDER_USAGE.threshold,
        timestamp: new Date()
      });
    }
    
    // Check ACK success rate
    if (summary.ackSuccessRate < ALERT_CONDITIONS.ACK_FAILURE.threshold) {
      alerts.push({
        condition: 'ACK_FAILURE',
        message: ALERT_CONDITIONS.ACK_FAILURE.message,
        severity: ALERT_CONDITIONS.ACK_FAILURE.severity,
        value: summary.ackSuccessRate,
        threshold: ALERT_CONDITIONS.ACK_FAILURE.threshold,
        timestamp: new Date()
      });
    }
    
    return alerts;
  }
  
  /**
   * Get overall health status
   */
  public getHealthStatus(): 'healthy' | 'degraded' | 'critical' {
    const alerts = this.checkAlerts();
    
    // Critical if any critical alerts
    if (alerts.some(a => a.severity === 'critical')) {
      return 'critical';
    }
    
    // Degraded if any warnings
    if (alerts.length > 0) {
      return 'degraded';
    }
    
    return 'healthy';
  }
  
  /**
   * Get metrics summary
   */
  public getMetricsSummary(): MetricsSummary {
    const now = new Date();
    const durationMs = now.getTime() - this.startTime.getTime();
    
    // Calculate averages
    const avgLatency = (values: number[]) => {
      if (values.length === 0) return 0;
      return values.reduce((a, b) => a + b, 0) / values.length;
    };
    
    // Calculate queue depth stats
    const queueStats = () => {
      if (this.queueDepths.length === 0) {
        return { current: 0, min: 0, max: 0, avg: 0 };
      }
      return {
        current: this.queueDepths[this.queueDepths.length - 1] || 0,
        min: Math.min(...this.queueDepths),
        max: Math.max(...this.queueDepths),
        avg: avgLatency(this.queueDepths)
      };
    };
    
    // Calculate fallback usage
    const totalFallbacks = this.counters.fallbackFresh + this.counters.fallbackStyle + this.counters.fallbackGlobal;
    const totalGenerations = this.counters.generationSuccess + this.counters.generationFailure + totalFallbacks;
    const fallbackRate = totalGenerations > 0 ? totalFallbacks / totalGenerations : 0;
    
    // Calculate success rates
    const totalAcks = this.counters.ackSuccess + this.counters.ackFailure;
    const ackSuccessRate = totalAcks > 0 ? this.counters.ackSuccess / totalAcks : 1;
    
    const totalHeartbeats = this.counters.heartbeatSuccess + this.counters.heartbeatMissed;
    const heartbeatRate = totalHeartbeats > 0 ? this.counters.heartbeatSuccess / totalHeartbeats : 1;
    
    const morphCompletionRate = this.counters.morphCyclesStarted > 0 
      ? this.counters.morphCyclesCompleted / this.counters.morphCyclesStarted 
      : 1;
    
    // Calculate WebSocket stability
    const totalConnections = this.counters.websocketConnects;
    const stability = totalConnections > 0 
      ? 1 - (this.counters.websocketDisconnects / totalConnections)
      : 1;
    
    return {
      generationSuccessRate: this.counters.generationSuccess / Math.max(1, totalGenerations),
      generationFailureRate: this.counters.generationFailure / Math.max(1, totalGenerations),
      avgGenerationLatency: avgLatency(this.latencies.generation),
      queueDepth: queueStats(),
      fallbackUsage: {
        fresh: this.counters.fallbackFresh,
        style: this.counters.fallbackStyle,
        global: this.counters.fallbackGlobal,
        total: totalFallbacks,
        rate: fallbackRate
      },
      placeholderUsage: this.counters.placeholderUsage,
      blackFrameCount: this.counters.blackFrames,
      avgTransitionLatency: avgLatency(this.latencies.transition),
      morphCycleCompletionRate: morphCompletionRate,
      schedulerStateTransitions: this.counters.schedulerTransitions,
      frameBufferSizes: {
        fresh: this.frameBufferSizes.fresh,
        style: this.frameBufferSizes.style,
        global: this.frameBufferSizes.global,
        total: this.frameBufferSizes.fresh + this.frameBufferSizes.style + this.frameBufferSizes.global
      },
      websocketConnections: {
        active: this.counters.websocketConnects - this.counters.websocketDisconnects,
        disconnected: this.counters.websocketDisconnects,
        reconnected: this.counters.websocketReconnects,
        stability: stability * 100
      },
      ackSuccessRate: ackSuccessRate,
      heartbeatResponseRate: heartbeatRate,
      memoryUsage: {
        eventBuffer: this.events.length,
        metricsMap: this.metrics.size,
        estimatedMB: (this.events.length * 200 + this.metrics.size * 50) / 1048576 // Rough estimate
      },
      timeRange: {
        start: this.startTime,
        end: now,
        durationMs: durationMs
      }
    };
  }
  
  /**
   * Get events by category
   */
  public getEventsByCategory(category: string, limit: number = 100): TelemetryEvent[] {
    const filtered = this.events.filter(e => e.category === category);
    return filtered.slice(-limit);
  }
  
  /**
   * Export metrics in Prometheus format
   */
  public exportMetrics(): string {
    const summary = this.getMetricsSummary();
    const lines: string[] = [];
    
    // Add metric lines in Prometheus format
    lines.push('# HELP algorhythmic_black_frames Total number of black frames detected');
    lines.push('# TYPE algorhythmic_black_frames counter');
    lines.push(`algorhythmic_black_frames ${summary.blackFrameCount}`);
    
    lines.push('# HELP algorhythmic_fallback_rate Rate of fallback usage');
    lines.push('# TYPE algorhythmic_fallback_rate gauge');
    lines.push(`algorhythmic_fallback_rate ${summary.fallbackUsage.rate}`);
    
    lines.push('# HELP algorhythmic_generation_latency Average generation latency in ms');
    lines.push('# TYPE algorhythmic_generation_latency gauge');
    lines.push(`algorhythmic_generation_latency ${summary.avgGenerationLatency}`);
    
    lines.push('# HELP algorhythmic_transition_latency Average transition latency in ms');
    lines.push('# TYPE algorhythmic_transition_latency gauge');
    lines.push(`algorhythmic_transition_latency ${summary.avgTransitionLatency}`);
    
    lines.push('# HELP algorhythmic_queue_depth Current queue depth');
    lines.push('# TYPE algorhythmic_queue_depth gauge');
    lines.push(`algorhythmic_queue_depth ${summary.queueDepth.current}`);
    
    lines.push('# HELP algorhythmic_websocket_stability WebSocket connection stability percentage');
    lines.push('# TYPE algorhythmic_websocket_stability gauge');
    lines.push(`algorhythmic_websocket_stability ${summary.websocketConnections.stability}`);
    
    lines.push('# HELP algorhythmic_health_status Overall system health (0=healthy, 1=degraded, 2=critical)');
    lines.push('# TYPE algorhythmic_health_status gauge');
    const healthValue = this.getHealthStatus() === 'healthy' ? 0 : this.getHealthStatus() === 'degraded' ? 1 : 2;
    lines.push(`algorhythmic_health_status ${healthValue}`);
    
    return lines.join('\n');
  }
  
  /**
   * Clear all metrics and events (for testing)
   */
  public reset(): void {
    this.events = [];
    this.metrics.clear();
    this.counters = {
      blackFrames: 0,
      placeholderUsage: 0,
      fallbackFresh: 0,
      fallbackStyle: 0,
      fallbackGlobal: 0,
      generationSuccess: 0,
      generationFailure: 0,
      websocketConnects: 0,
      websocketDisconnects: 0,
      websocketReconnects: 0,
      ackSuccess: 0,
      ackFailure: 0,
      heartbeatSuccess: 0,
      heartbeatMissed: 0,
      morphCyclesCompleted: 0,
      morphCyclesStarted: 0,
      schedulerTransitions: 0
    };
    this.latencies = {
      generation: [],
      transition: [],
      fallback: [],
      websocket: []
    };
    this.queueDepths = [];
    this.frameBufferSizes = {
      fresh: 0,
      style: 0,
      global: 0
    };
    this.startTime = new Date();
  }
}

// Export singleton instance
export const telemetryService = TelemetryService.getInstance();