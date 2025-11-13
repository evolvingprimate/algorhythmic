/**
 * Network Detection Utilities
 * Provides network quality detection and adaptive timeout configuration
 * Based on navigator.connection API (if available) and online/offline status
 */

import { telemetryService } from '@/lib/maestro/telemetry/TelemetryService';

export enum NetworkQuality {
  OFFLINE = 'offline',
  SLOW = 'slow',
  MODERATE = 'moderate',
  GOOD = 'good',
  EXCELLENT = 'excellent',
}

export interface NetworkStatus {
  online: boolean;
  quality: NetworkQuality;
  effectiveType?: string;
  downlink?: number; // Mbps
  rtt?: number; // Round-trip time in ms
  saveData?: boolean;
  timestamp: number;
}

export interface TimeoutConfig {
  baseTimeout: number;
  maxTimeout: number;
  retryDelays: number[];
  maxRetries: number;
}

/**
 * Get current network status using navigator APIs
 */
export function getNetworkStatus(): NetworkStatus {
  const online = navigator.onLine;
  
  // Use Network Information API if available
  const connection = (navigator as any).connection || 
                    (navigator as any).mozConnection || 
                    (navigator as any).webkitConnection;
  
  let quality = NetworkQuality.MODERATE;
  let effectiveType: string | undefined;
  let downlink: number | undefined;
  let rtt: number | undefined;
  let saveData: boolean | undefined;
  
  if (!online) {
    quality = NetworkQuality.OFFLINE;
  } else if (connection) {
    effectiveType = connection.effectiveType;
    downlink = connection.downlink;
    rtt = connection.rtt;
    saveData = connection.saveData;
    
    // Determine quality based on effective type and metrics
    switch (effectiveType) {
      case 'slow-2g':
      case '2g':
        quality = NetworkQuality.SLOW;
        break;
      case '3g':
        quality = NetworkQuality.MODERATE;
        break;
      case '4g':
        quality = rtt && rtt < 100 ? NetworkQuality.EXCELLENT : NetworkQuality.GOOD;
        break;
      default:
        // Fall back to metrics-based detection
        if (downlink !== undefined) {
          if (downlink < 1) {
            quality = NetworkQuality.SLOW;
          } else if (downlink < 5) {
            quality = NetworkQuality.MODERATE;
          } else if (downlink < 10) {
            quality = NetworkQuality.GOOD;
          } else {
            quality = NetworkQuality.EXCELLENT;
          }
        } else if (rtt !== undefined) {
          if (rtt > 500) {
            quality = NetworkQuality.SLOW;
          } else if (rtt > 200) {
            quality = NetworkQuality.MODERATE;
          } else if (rtt > 100) {
            quality = NetworkQuality.GOOD;
          } else {
            quality = NetworkQuality.EXCELLENT;
          }
        }
    }
  }
  
  // Log network status for telemetry
  telemetryService.recordEvent({
    event: 'network_status_detected',
    category: 'network',
    severity: 'info',
    metrics: {
      online: online ? 1 : 0,
      quality,
      effectiveType,
      downlink,
      rtt,
      saveData: saveData ? 1 : 0,
    }
  });
  
  return {
    online,
    quality,
    effectiveType,
    downlink,
    rtt,
    saveData,
    timestamp: Date.now(),
  };
}

/**
 * Get adaptive timeout configuration based on network quality
 * @param quality - Network quality level
 * @param isGenerationRequest - Whether this is an AI generation request that needs longer timeout
 */
export function getAdaptiveTimeoutConfig(quality: NetworkQuality, isGenerationRequest: boolean = false): TimeoutConfig {
  // AI generation requests need much longer timeouts (backend uses 60s adaptive timeout)
  if (isGenerationRequest) {
    return {
      baseTimeout: 65000, // 65 seconds to accommodate backend's 60s timeout + buffer
      maxTimeout: 90000,  // Max 90 seconds
      retryDelays: [5000, 10000, 20000], // Longer delays between retries
      maxRetries: 2, // Fewer retries for expensive operations
    };
  }
  
  // Regular API requests use adaptive timeouts based on network quality
  switch (quality) {
    case NetworkQuality.OFFLINE:
      return {
        baseTimeout: 0, // Skip initial request when offline
        maxTimeout: 0,
        retryDelays: [], // No retries when offline
        maxRetries: 0,
      };
    
    case NetworkQuality.SLOW:
      return {
        baseTimeout: 15000, // 15 seconds for slow connections
        maxTimeout: 30000,  // Max 30 seconds
        retryDelays: [2000, 4000, 8000], // 2s, 4s, 8s
        maxRetries: 3,
      };
    
    case NetworkQuality.MODERATE:
      return {
        baseTimeout: 10000, // 10 seconds for moderate connections
        maxTimeout: 20000,  // Max 20 seconds
        retryDelays: [1500, 3000, 6000], // 1.5s, 3s, 6s
        maxRetries: 3,
      };
    
    case NetworkQuality.GOOD:
      return {
        baseTimeout: 5000,  // 5 seconds for good connections
        maxTimeout: 15000,  // Max 15 seconds
        retryDelays: [1000, 2000, 4000], // 1s, 2s, 4s
        maxRetries: 3,
      };
    
    case NetworkQuality.EXCELLENT:
      return {
        baseTimeout: 3000,  // 3 seconds for excellent connections
        maxTimeout: 10000,  // Max 10 seconds
        retryDelays: [500, 1000, 2000], // 0.5s, 1s, 2s
        maxRetries: 3,
      };
    
    default:
      // Default to moderate settings
      return {
        baseTimeout: 10000,
        maxTimeout: 20000,
        retryDelays: [1500, 3000, 6000],
        maxRetries: 3,
      };
  }
}

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoffDelay(
  attemptIndex: number,
  baseDelay: number,
  maxDelay: number = 30000
): number {
  // Exponential backoff: baseDelay * 2^attemptIndex
  const exponentialDelay = baseDelay * Math.pow(2, attemptIndex);
  
  // Add jitter (±25% randomness to prevent thundering herd)
  const jitter = 0.25;
  const jitterAmount = exponentialDelay * jitter;
  const delayWithJitter = exponentialDelay + (Math.random() * 2 - 1) * jitterAmount;
  
  // Clamp to maxDelay
  return Math.min(Math.max(0, delayWithJitter), maxDelay);
}

/**
 * Network quality observer that fires callbacks when quality changes
 */
export class NetworkQualityObserver {
  private listeners: Set<(status: NetworkStatus) => void> = new Set();
  private lastStatus: NetworkStatus | null = null;
  private checkInterval: number | null = null;
  
  constructor(private pollIntervalMs: number = 5000) {}
  
  start(): void {
    if (this.checkInterval) return;
    
    // Initial check
    this.checkAndNotify();
    
    // Set up polling
    this.checkInterval = window.setInterval(() => {
      this.checkAndNotify();
    }, this.pollIntervalMs);
    
    // Listen for online/offline events
    window.addEventListener('online', this.handleOnlineOffline);
    window.addEventListener('offline', this.handleOnlineOffline);
    
    // Listen for connection change events if available
    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', this.handleConnectionChange);
    }
  }
  
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    window.removeEventListener('online', this.handleOnlineOffline);
    window.removeEventListener('offline', this.handleOnlineOffline);
    
    const connection = (navigator as any).connection;
    if (connection) {
      connection.removeEventListener('change', this.handleConnectionChange);
    }
  }
  
  subscribe(callback: (status: NetworkStatus) => void): () => void {
    this.listeners.add(callback);
    
    // Immediately notify with current status
    const currentStatus = getNetworkStatus();
    callback(currentStatus);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }
  
  private checkAndNotify = (): void => {
    const status = getNetworkStatus();
    
    // Only notify if quality changed or online/offline status changed
    if (!this.lastStatus || 
        status.online !== this.lastStatus.online ||
        status.quality !== this.lastStatus.quality) {
      
      this.lastStatus = status;
      this.notifyListeners(status);
    }
  }
  
  private handleOnlineOffline = (): void => {
    // Immediate check when online/offline status changes
    this.checkAndNotify();
  }
  
  private handleConnectionChange = (): void => {
    // Check when connection properties change
    this.checkAndNotify();
  }
  
  private notifyListeners(status: NetworkStatus): void {
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('Error in network quality observer callback:', error);
      }
    });
  }
}

// Singleton instance
let networkObserver: NetworkQualityObserver | null = null;

/**
 * Get or create singleton network observer
 */
export function getNetworkObserver(): NetworkQualityObserver {
  if (!networkObserver) {
    networkObserver = new NetworkQualityObserver();
    networkObserver.start();
  }
  return networkObserver;
}

/**
 * Check if retries should be skipped based on circuit breaker state
 */
export async function shouldSkipRetry(): Promise<boolean> {
  try {
    const response = await fetch('/api/health/circuit-breaker-state', {
      credentials: 'include',
    });
    
    if (!response.ok) {
      // If we can't check, assume we should retry
      return false;
    }
    
    const data = await response.json();
    
    // Skip retries if circuit is open
    return data.state === 'open';
  } catch (error) {
    // If we can't check, assume we should retry
    console.warn('Failed to check circuit breaker state:', error);
    return false;
  }
}

/**
 * Adaptive retry delay function for TanStack Query
 * Combines network quality detection with exponential backoff
 */
export async function adaptiveRetryDelay(
  failureCount: number,
  error: any
): Promise<number> {
  // Check if we should skip retries due to circuit breaker
  const skipRetry = await shouldSkipRetry();
  if (skipRetry) {
    telemetryService.recordEvent({
      event: 'retry_skipped_circuit_open',
      category: 'network',
      severity: 'info',
      metrics: {
        failure_count: failureCount,
      }
    });
    // Return 0 to skip retry
    return 0;
  }
  
  // Get current network status
  const networkStatus = getNetworkStatus();
  
  // If offline, don't retry
  if (!networkStatus.online) {
    telemetryService.recordEvent({
      event: 'retry_skipped_offline',
      category: 'network',
      severity: 'info',
      metrics: {
        failure_count: failureCount,
      }
    });
    return 0;
  }
  
  // Get timeout config based on network quality
  const config = getAdaptiveTimeoutConfig(networkStatus.quality);
  
  // Check if we've exceeded max retries
  if (failureCount > config.maxRetries) {
    telemetryService.recordEvent({
      event: 'retry_limit_exceeded',
      category: 'network',
      severity: 'warning',
      metrics: {
        failure_count: failureCount,
        max_retries: config.maxRetries,
        network_quality: networkStatus.quality,
      }
    });
    return 0;
  }
  
  // Get base delay from config or calculate exponential backoff
  const baseDelay = config.retryDelays[failureCount - 1] || 
                    config.retryDelays[config.retryDelays.length - 1];
  
  // Calculate delay with exponential backoff and jitter
  const delay = calculateBackoffDelay(
    failureCount - 1,
    baseDelay,
    config.maxTimeout
  );
  
  telemetryService.recordEvent({
    event: 'retry_delay_calculated',
    category: 'network',
    severity: 'debug',
    metrics: {
      failure_count: failureCount,
      base_delay: baseDelay,
      calculated_delay: delay,
      network_quality: networkStatus.quality,
    }
  });
  
  return delay;
}