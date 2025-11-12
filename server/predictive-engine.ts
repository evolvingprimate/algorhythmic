/**
 * Predictive Pre-Generation Engine
 * 
 * Analyzes user patterns and triggers pre-generation of artwork
 * to ensure smooth playback and optimal user experience
 */

import type { IStorage } from "./storage";
import type { QueueService } from "./queue-service";
import { telemetryService } from "./telemetry-service";
import type { PoolMonitor } from "./pool-monitor";

// Pool thresholds for pre-generation triggers
const POOL_THRESHOLDS = {
  CRITICAL: 2,  // Minimum frames needed for playback
  LOW: 5,       // Trigger pre-generation
  OPTIMAL: 10,  // Ideal pool size
  MAX: 20       // Maximum frames to pre-generate
};

// Pre-generation counts based on trigger reason
const PRE_GENERATION_COUNTS = {
  style_preference_update: 3,
  positive_vote_signal: 2,
  session_start: 5,
  music_genre_detected: 3,
  pool_low: 5,
  pool_critical: 10
};

// Time segments for session pattern analysis
export function getCurrentTimeSegment(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function getCurrentDayOfWeek(): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date().getDay()];
}

export class PredictiveEngine {
  private sessionStartTimes = new Map<string, number>();
  private lastPreGenerationTime = new Map<string, number>();
  private MIN_PRE_GEN_INTERVAL = 30000; // 30 seconds between pre-generation batches

  constructor(
    private storage: IStorage,
    private queueService: QueueService,
    private poolMonitor: PoolMonitor
  ) {}

  /**
   * Analyze pool health and trigger pre-generation if needed
   */
  async analyzePoolHealth(userId: string, sessionId: string): Promise<void> {
    try {
      const poolSize = await this.poolMonitor.getUserPoolSize(userId);
      
      console.log(`[PredictiveEngine] Pool health check for user ${userId}: ${poolSize} frames`);
      
      if (poolSize <= POOL_THRESHOLDS.CRITICAL) {
        // Critical: Immediate pre-generation needed
        await this.triggerPreGeneration(
          userId,
          sessionId,
          PRE_GENERATION_COUNTS.pool_critical,
          'pool_critical',
          10  // High priority
        );
      } else if (poolSize <= POOL_THRESHOLDS.LOW) {
        // Low: Standard pre-generation
        await this.triggerPreGeneration(
          userId,
          sessionId,
          PRE_GENERATION_COUNTS.pool_low,
          'pool_low',
          0   // Normal priority
        );
      }
    } catch (error) {
      console.error('[PredictiveEngine] Pool health analysis failed:', error);
    }
  }

  /**
   * Handle style preference update
   */
  async handleStylePreferenceUpdate(
    userId: string,
    sessionId: string,
    styles: string[],
    artists: string[]
  ): Promise<void> {
    try {
      // Pre-generate frames for newly selected styles
      const count = PRE_GENERATION_COUNTS.style_preference_update;
      
      await this.queueService.enqueuePreGenerationJob(
        userId,
        sessionId,
        styles,
        count,
        'style_preference_update'
      );
      
      telemetryService.recordEvent({
        event: 'predictive_style_preference_trigger',
        category: 'predictive_engine',
        severity: 'info',
        metrics: {
          userId,
          sessionId,
          styles: styles.join(','),
          count
        }
      });
    } catch (error) {
      console.error('[PredictiveEngine] Style preference pre-generation failed:', error);
    }
  }

  /**
   * Handle positive vote signal
   */
  async handlePositiveVote(
    userId: string,
    sessionId: string,
    artworkId: string
  ): Promise<void> {
    try {
      // Get the artwork details to extract style information
      const artwork = await this.storage.getArtwork(artworkId);
      if (!artwork) {
        console.warn(`[PredictiveEngine] Artwork ${artworkId} not found`);
        return;
      }

      // Extract styles from the prompt (simplified - could be enhanced)
      const styles = this.extractStylesFromPrompt(artwork.prompt);
      
      if (styles.length > 0) {
        await this.queueService.enqueuePreGenerationJob(
          userId,
          sessionId,
          styles,
          PRE_GENERATION_COUNTS.positive_vote_signal,
          `positive_vote_signal_${artworkId}`
        );
        
        telemetryService.recordEvent({
          event: 'predictive_vote_trigger',
          category: 'predictive_engine',
          severity: 'info',
          metrics: {
            userId,
            sessionId,
            artworkId,
            styles: styles.join(',')
          }
        });
      }
    } catch (error) {
      console.error('[PredictiveEngine] Vote-based pre-generation failed:', error);
    }
  }

  /**
   * Handle session start
   */
  async handleSessionStart(
    userId: string,
    sessionId: string
  ): Promise<void> {
    try {
      // Record session start time
      this.sessionStartTimes.set(sessionId, Date.now());
      
      // Get user's historical preferences
      const preferences = await this.storage.getArtPreferences(userId);
      if (!preferences || preferences.styles.length === 0) {
        console.log('[PredictiveEngine] No preferences found for session start pre-generation');
        return;
      }

      // Analyze session context
      const timeSegment = getCurrentTimeSegment();
      const dayOfWeek = getCurrentDayOfWeek();
      
      // Pre-generate based on historical patterns
      await this.queueService.enqueuePreGenerationJob(
        userId,
        sessionId,
        preferences.styles,
        PRE_GENERATION_COUNTS.session_start,
        `session_start_${timeSegment}_${dayOfWeek}`
      );
      
      telemetryService.recordEvent({
        event: 'predictive_session_start_trigger',
        category: 'predictive_engine',
        severity: 'info',
        metrics: {
          userId,
          sessionId,
          timeSegment,
          dayOfWeek,
          styles: preferences.styles.join(',')
        }
      });
    } catch (error) {
      console.error('[PredictiveEngine] Session start pre-generation failed:', error);
    }
  }

  /**
   * Handle music genre detection
   */
  async handleMusicGenreDetection(
    userId: string,
    sessionId: string,
    genre: string,
    artist?: string
  ): Promise<void> {
    try {
      // Map genre to visual styles
      const styles = this.mapGenreToStyles(genre);
      
      if (styles.length > 0) {
        await this.queueService.enqueuePreGenerationJob(
          userId,
          sessionId,
          styles,
          PRE_GENERATION_COUNTS.music_genre_detected,
          `music_genre_${genre}${artist ? `_${artist}` : ''}`
        );
        
        telemetryService.recordEvent({
          event: 'predictive_music_genre_trigger',
          category: 'predictive_engine',
          severity: 'info',
          metrics: {
            userId,
            sessionId,
            genre,
            artist: artist || 'unknown',
            styles: styles.join(',')
          }
        });
      }
    } catch (error) {
      console.error('[PredictiveEngine] Music genre pre-generation failed:', error);
    }
  }

  /**
   * Check if pre-generation should be throttled
   */
  private shouldThrottle(userId: string): boolean {
    const lastTime = this.lastPreGenerationTime.get(userId);
    if (!lastTime) return false;
    
    const timeSinceLastPreGen = Date.now() - lastTime;
    return timeSinceLastPreGen < this.MIN_PRE_GEN_INTERVAL;
  }

  /**
   * Trigger pre-generation with throttling
   */
  private async triggerPreGeneration(
    userId: string,
    sessionId: string,
    count: number,
    reason: string,
    priority: number = 0
  ): Promise<void> {
    // Check throttling
    if (this.shouldThrottle(userId)) {
      console.log(`[PredictiveEngine] Throttling pre-generation for user ${userId}`);
      return;
    }

    // Get user preferences for style selection
    const preferences = await this.storage.getArtPreferences(userId);
    const styles = preferences?.styles || ['abstract'];

    // Trigger pre-generation
    await this.queueService.enqueuePreGenerationJob(
      userId,
      sessionId,
      styles,
      count,
      reason
    );

    // Update last pre-generation time
    this.lastPreGenerationTime.set(userId, Date.now());
  }

  /**
   * Extract styles from artwork prompt
   */
  private extractStylesFromPrompt(prompt: string): string[] {
    const styles: string[] = [];
    
    // Common style keywords to look for
    const styleKeywords = [
      'surrealism', 'impressionism', 'cubism', 'abstract',
      'realism', 'expressionism', 'minimalist', 'baroque',
      'digital art', 'cyberpunk', 'fantasy', 'sci-fi'
    ];
    
    const lowerPrompt = prompt.toLowerCase();
    for (const keyword of styleKeywords) {
      if (lowerPrompt.includes(keyword)) {
        styles.push(keyword);
      }
    }
    
    // Default to abstract if no styles found
    return styles.length > 0 ? styles : ['abstract'];
  }

  /**
   * Map music genre to visual styles
   */
  private mapGenreToStyles(genre: string): string[] {
    const genreStyleMap: Record<string, string[]> = {
      'hip-hop': ['cyberpunk', 'urban', 'graffiti'],
      'rap': ['cyberpunk', 'urban', 'graffiti'],
      'rock': ['abstract', 'expressionism', 'dark'],
      'electronic': ['digital art', 'cyberpunk', 'abstract'],
      'edm': ['digital art', 'neon', 'abstract'],
      'pop': ['vibrant', 'colorful', 'modern'],
      'jazz': ['impressionism', 'noir', 'abstract'],
      'classical': ['baroque', 'renaissance', 'realism'],
      'ambient': ['minimal', 'abstract', 'surrealism'],
      'metal': ['dark', 'gothic', 'horror'],
      'indie': ['minimalist', 'vintage', 'dreamy'],
      'folk': ['pastoral', 'watercolor', 'impressionism'],
      'r&b': ['smooth', 'urban', 'modern'],
      'soul': ['vintage', 'warm', 'expressive'],
      'country': ['pastoral', 'realism', 'landscape'],
      'reggae': ['vibrant', 'tropical', 'colorful'],
      'blues': ['noir', 'vintage', 'moody']
    };
    
    const lowerGenre = genre.toLowerCase();
    
    // Find matching genre
    for (const [key, styles] of Object.entries(genreStyleMap)) {
      if (lowerGenre.includes(key)) {
        return styles;
      }
    }
    
    // Default styles if genre not recognized
    return ['abstract', 'digital art'];
  }

  /**
   * Get session duration in milliseconds
   */
  getSessionDuration(sessionId: string): number {
    const startTime = this.sessionStartTimes.get(sessionId);
    if (!startTime) return 0;
    return Date.now() - startTime;
  }

  /**
   * Clean up old session data
   */
  cleanupOldSessions(): void {
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    
    // Clean up sessions older than 1 hour
    for (const [sessionId, startTime] of this.sessionStartTimes.entries()) {
      if (now - startTime > ONE_HOUR) {
        this.sessionStartTimes.delete(sessionId);
      }
    }
    
    // Clean up throttle data older than 1 hour  
    for (const [userId, lastTime] of this.lastPreGenerationTime.entries()) {
      if (now - lastTime > ONE_HOUR) {
        this.lastPreGenerationTime.delete(userId);
      }
    }
  }
}

// Export singleton instance
export let predictiveEngine: PredictiveEngine | null = null;

export function initializePredictiveEngine(
  storage: IStorage,
  queueService: QueueService,
  poolMonitor: PoolMonitor
): PredictiveEngine {
  if (!predictiveEngine) {
    predictiveEngine = new PredictiveEngine(storage, queueService, poolMonitor);
    
    // Set up periodic cleanup
    setInterval(() => {
      predictiveEngine?.cleanupOldSessions();
    }, 60 * 60 * 1000); // Every hour
  }
  return predictiveEngine;
}