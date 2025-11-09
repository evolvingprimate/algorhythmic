/**
 * MaestroBrain - Phase 2: Intelligent Learning System
 * 
 * Responsibilities:
 * - Poll /api/trends/analyze for aggregated user behavior
 * - Generate smart parameter recommendations based on trends
 * - Provide API for MaestroLoop to query suggestions
 * - Respect user override (never fight manual adjustments)
 * 
 * Phase 2 MVP: Baseline trend polling and simple recommendation logic
 * Phase 3: Full ML-based prediction and personalization
 */

export interface TrendData {
  particles: {
    spawnRate: { mean: number; variance: number; adjustmentCount: number };
    velocity: { mean: number; variance: number; adjustmentCount: number };
    size: { mean: number; variance: number; adjustmentCount: number };
  };
  warp: {
    elasticity: { mean: number; variance: number; adjustmentCount: number };
    radius: { mean: number; variance: number; adjustmentCount: number };
  };
  mixer: {
    saturation: { mean: number; variance: number; adjustmentCount: number };
    brightness: { mean: number; variance: number; adjustmentCount: number };
    contrast: { mean: number; variance: number; adjustmentCount: number };
  };
  climaxFrequency: number;
  visionSuccessRate: number;
}

export interface Recommendation {
  parameter: string;
  suggestedValue: number;
  confidence: number; // 0-1, how confident the suggestion is
  reason: string;
}

export class MaestroBrain {
  private trendData: TrendData | null = null;
  private lastPollTime: number = 0;
  private pollInterval: number = 120000; // 2 minutes
  private isPolling: boolean = false;

  constructor(
    private userId?: string,
    private lookbackMinutes: number = 60
  ) {}

  /**
   * Start background trend polling
   */
  start(): void {
    if (this.isPolling) return;
    
    this.isPolling = true;
    console.log('[MaestroBrain] Starting trend polling');
    
    // Initial poll
    this.pollTrends();
    
    // Continue polling every 2 minutes
    this.schedulePoll();
  }

  /**
   * Stop background polling
   */
  stop(): void {
    this.isPolling = false;
    console.log('[MaestroBrain] Stopped trend polling');
  }

  /**
   * Schedule next poll
   */
  private schedulePoll(): void {
    if (!this.isPolling) return;
    
    setTimeout(() => {
      this.pollTrends();
      this.schedulePoll();
    }, this.pollInterval);
  }

  /**
   * Fetch latest trends from backend
   */
  private async pollTrends(): Promise<void> {
    try {
      const params = new URLSearchParams({
        lookbackMinutes: this.lookbackMinutes.toString(),
      });
      
      if (this.userId) {
        params.append('userId', this.userId);
      }

      const response = await fetch(`/api/trends/analyze?${params}`);
      
      if (!response.ok) {
        console.error('[MaestroBrain] Failed to fetch trends:', response.statusText);
        return;
      }

      const data = await response.json();
      
      if (data.success && data.trends) {
        this.trendData = data.trends;
        this.lastPollTime = Date.now();
        console.log('[MaestroBrain] Trends updated:', {
          timestamp: data.timestamp,
          climaxFrequency: data.trends.climaxFrequency,
        });
      }
    } catch (error) {
      console.error('[MaestroBrain] Error polling trends:', error);
    }
  }

  /**
   * Get smart recommendations based on current trends
   * 
   * Phase 2 MVP: Simple baseline recommendations
   * Phase 3: ML-based predictions using full telemetry history
   */
  getRecommendations(): Recommendation[] {
    if (!this.trendData) {
      return [];
    }

    const recommendations: Recommendation[] = [];

    // Example: If users frequently adjust particles down, suggest lower baseline
    if (this.trendData.particles.spawnRate.adjustmentCount > 5) {
      if (this.trendData.particles.spawnRate.mean < 0.8) {
        recommendations.push({
          parameter: 'particles.spawnRate',
          suggestedValue: this.trendData.particles.spawnRate.mean,
          confidence: 0.7,
          reason: 'Users tend to prefer lower particle spawn rates',
        });
      }
    }

    // More recommendations can be added in Phase 3
    return recommendations;
  }

  /**
   * Get current trend data (for debugging/monitoring)
   */
  getTrendData(): TrendData | null {
    return this.trendData;
  }

  /**
   * Check if brain has fresh data
   */
  hasFreshData(): boolean {
    if (!this.trendData) return false;
    const age = Date.now() - this.lastPollTime;
    return age < this.pollInterval * 2; // Within 4 minutes
  }
}
