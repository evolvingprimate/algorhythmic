// Emergency Fallback Service - Clean 3-tier fallback system for artwork retrieval
import type { ArtSession } from "../shared/schema";
import type { IStorage } from "./storage";
import { recentlyServedCache } from "./recently-served-cache";
import { telemetryService } from "./telemetry-service";
import { GenerationFailure } from "./openai-service";
import type { PoolMonitor } from "./pool-monitor";

export interface FallbackResult {
  artworks: ArtSession[];
  tier: 'fresh' | 'style-matched' | 'global';
  reason: string;
  bypassedCache: boolean;
  bridgeMode?: 'combo' | 'proxy' | 'decoupled'; // Track bridge mode for telemetry
}

// Track handled idempotency keys to prevent double processing
const handledIdempotencyKeys = new Set<string>();

// Pool monitor instance (will be set from bootstrap)
let poolMonitor: PoolMonitor | null = null;

/**
 * Set the pool monitor instance for tracking consumption
 */
export function setPoolMonitor(monitor: PoolMonitor): void {
  poolMonitor = monitor;
}

/**
 * Mark an idempotency key as handled to prevent double processing of late results
 */
export function markIdempotencyHandled(idempotencyKey: string): void {
  handledIdempotencyKeys.add(idempotencyKey);
  
  // Clean up old keys after 5 minutes
  setTimeout(() => {
    handledIdempotencyKeys.delete(idempotencyKey);
  }, 300000);
}

/**
 * Check if an idempotency key has already been handled
 */
export function isIdempotencyHandled(idempotencyKey: string): boolean {
  return handledIdempotencyKeys.has(idempotencyKey);
}

// Validate artworks have imageUrl and are accessible
export function filterValidImageUrls(artworks: ArtSession[]): ArtSession[] {
  return artworks.filter(artwork => {
    if (!artwork.imageUrl) {
      console.error(`[Validation] Artwork ${artwork.id} missing imageUrl - skipping`);
      return false;
    }
    // Additional validation can be added here (e.g., object storage check)
    return true;
  });
}

/**
 * Resolves emergency fallback artworks using a clean 3-tier strategy
 * Guarantees to return at least 2 valid frames or throws an error
 * Integrates with RecentlyServed cache to prevent duplicates
 */
export async function resolveEmergencyFallback(
  storage: IStorage,
  sessionId: string | null,
  userId: string,
  options: {
    orientation?: string;
    styleTags?: string[];
    artistTags?: string[];
    recentlyServedIds?: Set<string>;
    minFrames?: number;
    useCache?: boolean; // Option to use the unified cache
  } = {}
): Promise<FallbackResult> {
  const { 
    orientation, 
    styleTags, 
    artistTags, 
    recentlyServedIds = new Set(),
    minFrames = 2, // MorphEngine requires at least 2 frames
    useCache = true // Use cache by default
  } = options;

  console.log(`[Fallback] Starting 3-tier fallback for user ${userId}, session ${sessionId}, cache: ${useCache}`);
  const startTime = Date.now(); // Track latency
  
  // Tier 1: Fresh Generated Frames (never seen by user)
  if (sessionId) {
    try {
      const freshArtworks = await storage.getFreshArtworks(sessionId, userId, 20);
      let validFresh = filterValidImageUrls(freshArtworks);
      
      // Use unified cache if enabled
      if (useCache && sessionId) {
        validFresh = recentlyServedCache.filterRecentlyServed(sessionId, userId, validFresh);
      }
      
      // Apply legacy recently-served filter as well if provided
      const filteredFresh = validFresh.filter(a => !recentlyServedIds.has(a.id));
      
      if (filteredFresh.length >= minFrames) {
        console.log(`[Fallback] Tier 1 SUCCESS: ${filteredFresh.length} fresh frames`);
        
        // Track served artworks in cache
        const result = {
          artworks: filteredFresh,
          tier: 'fresh' as const,
          reason: 'Fresh generated frames available',
          bypassedCache: false
        };
        
        if (useCache && sessionId) {
          const servedIds = result.artworks.map(a => a.id);
          recentlyServedCache.addServed(sessionId, userId, servedIds, 'fresh');
        }
        
        // Track consumption in pool monitor
        if (poolMonitor && sessionId) {
          poolMonitor.recordConsumption(sessionId, userId);
          // Update pool state after serving frames
          poolMonitor.refreshSession(sessionId, userId).catch(err => 
            console.error('[Fallback] Failed to update pool state:', err)
          );
        }
        
        // Track telemetry
        telemetryService.recordEvent({
          category: 'fallback',
          event: 'tier_selected',
          metrics: {
            tier: 'fresh',
            queueSize: result.artworks.length,
            latencyMs: Date.now() - startTime,
            bypassedCache: false
          },
          severity: 'info',
          sessionId,
          userId
        });
        
        return result;
      }
      
      // If filtering leaves too few, use unfiltered to prevent glitch
      if (validFresh.length >= minFrames) {
        console.warn(`[Fallback] Tier 1 PARTIAL: Using unfiltered fresh (bypassing cache)`);
        const result = {
          artworks: validFresh.slice(0, Math.max(minFrames, filteredFresh.length)),
          tier: 'fresh' as const,
          reason: 'Fresh frames with cache bypass',
          bypassedCache: true
        };
        
        if (useCache && sessionId) {
          const servedIds = result.artworks.map(a => a.id);
          recentlyServedCache.addServed(sessionId, userId, servedIds, 'fresh');
        }
        
        return result;
      }
    } catch (error) {
      console.error(`[Fallback] Tier 1 failed:`, error);
    }
  }

  // Tier 2: Style-Matched Round-Robin (from catalog)
  if (styleTags && styleTags.length > 0) {
    try {
      const styleMatched = await storage.getCatalogCandidates(userId, styleTags, 50);
      let validStyled = filterValidImageUrls(styleMatched);
      
      // Use unified cache if enabled (relax filtering with LRU ordering)
      if (useCache && sessionId) {
        // Filter but keep recently served at the end (LRU ordering)
        const filtered = recentlyServedCache.filterRecentlyServed(sessionId, userId, validStyled);
        const recentSet = new Set(validStyled.map(a => a.id));
        filtered.forEach(a => recentSet.delete(a.id));
        // Put filtered first, then recently served at the end
        validStyled = [...filtered, ...validStyled.filter(a => recentSet.has(a.id))];
      }
      
      // Apply legacy filter as secondary sorting
      const sortedByLRU = validStyled.sort((a, b) => {
        const aRecent = recentlyServedIds.has(a.id) ? 1 : 0;
        const bRecent = recentlyServedIds.has(b.id) ? 1 : 0;
        return aRecent - bRecent; // Non-recent first
      });
      
      if (sortedByLRU.length >= minFrames) {
        console.log(`[Fallback] Tier 2 SUCCESS: ${sortedByLRU.length} style-matched frames`);
        const result = {
          artworks: sortedByLRU.slice(0, 20),
          tier: 'style-matched' as const,
          reason: 'Style-matched catalog frames',
          bypassedCache: true // Tier 2 always bypasses strict cache
        };
        
        if (useCache && sessionId) {
          const servedIds = result.artworks.map(a => a.id);
          recentlyServedCache.addServed(sessionId, userId, servedIds, 'style');
        }
        
        // Track telemetry
        telemetryService.recordEvent({
          category: 'fallback',
          event: 'tier_selected',
          metrics: {
            tier: 'style-matched',
            queueSize: result.artworks.length,
            latencyMs: Date.now() - startTime,
            bypassedCache: true
          },
          severity: 'warning', // Style tier is less ideal
          sessionId,
          userId
        });
        
        return result;
      }
    } catch (error) {
      console.error(`[Fallback] Tier 2 failed:`, error);
    }
  }

  // Tier 3: Global Round-Robin (any valid artwork)
  try {
    // Use getRecentArt() or getEmergencyFallbackArtworks() for variety
    const globalArtworks = await storage.getEmergencyFallbackArtworks(userId, {
      limit: 100,
      orientation
    });
    
    let validGlobal = filterValidImageUrls(globalArtworks);
    
    // Use unified cache if enabled (with relaxed filtering for Tier 3)
    if (useCache && sessionId) {
      const filtered = recentlyServedCache.filterRecentlyServed(sessionId, userId, validGlobal);
      // If we have enough filtered, use them. Otherwise use all
      if (filtered.length >= minFrames) {
        validGlobal = filtered;
      }
    }
    
    if (validGlobal.length >= minFrames) {
      console.log(`[Fallback] Tier 3 SUCCESS: ${validGlobal.length} global frames`);
      const result = {
        artworks: validGlobal.slice(0, 20),
        tier: 'global' as const,
        reason: 'Global fallback pool',
        bypassedCache: true
      };
      
      if (useCache && sessionId) {
        const servedIds = result.artworks.map(a => a.id);
        recentlyServedCache.addServed(sessionId, userId, servedIds, 'global');
      }
      
      // Track telemetry
      telemetryService.recordEvent({
        category: 'fallback',
        event: 'tier_selected',
        metrics: {
          tier: 'global',
          queueSize: result.artworks.length,
          latencyMs: Date.now() - startTime,
          bypassedCache: true
        },
        severity: 'warning', // Global tier indicates generation issues
        sessionId,
        userId
      });
      
      return result;
    }
    
    // Absolute last resort - try getRecentArt without any filters
    const recentArt = await storage.getRecentArt(50);
    let validRecent = filterValidImageUrls(recentArt);
    
    // Even in last resort, try to respect cache if possible
    if (useCache && sessionId) {
      const filtered = recentlyServedCache.filterRecentlyServed(sessionId, userId, validRecent);
      if (filtered.length >= minFrames) {
        validRecent = filtered;
      }
    }
    
    if (validRecent.length >= minFrames) {
      console.warn(`[Fallback] Tier 3 LAST RESORT: ${validRecent.length} recent artworks`);
      const result = {
        artworks: validRecent.slice(0, Math.max(minFrames, 10)),
        tier: 'global' as const,
        reason: 'Last resort global pool',
        bypassedCache: true
      };
      
      if (useCache && sessionId) {
        const servedIds = result.artworks.map(a => a.id);
        recentlyServedCache.addServed(sessionId, userId, servedIds, 'global');
      }
      
      return result;
    }
  } catch (error) {
    console.error(`[Fallback] Tier 3 failed:`, error);
  }

  // If we get here, we couldn't find enough valid frames
  const errorMsg = `CRITICAL: Unable to find ${minFrames} valid artwork frames across all tiers`;
  console.error(`[Fallback] ${errorMsg}`);
  throw new Error(errorMsg);
}

// Helper to emit telemetry about fallback usage
export function emitFallbackTelemetry(result: FallbackResult, userId: string, sessionId: string | null) {
  const telemetry = {
    user_id: userId,
    session_id: sessionId,
    tier: result.tier,
    frame_count: result.artworks.length,
    bypassed_cache: result.bypassedCache,
    reason: result.reason,
    timestamp: new Date().toISOString()
  };
  
  // In production, send this to your metrics system
  console.log(`[Telemetry] Fallback usage:`, telemetry);
  
  // TODO: Send to metrics service
  // metrics.increment('fallback.usage', { tier: result.tier });
  // if (result.tier !== 'fresh') {
  //   metrics.increment('fallback.non_fresh_served');
  // }
}

/**
 * Handle generation failure by immediately triggering fallback
 * Integrates with circuit breaker and idempotency tracking
 * Based on Grok/ChatGPT recommendations for graceful degradation
 */
export async function handleGenerationFailure(
  storage: IStorage,
  userId: string,
  sessionId: string | null,
  failure: GenerationFailure,
  options: {
    orientation?: string;
    styleTags?: string[];
    artistTags?: string[];
  } = {}
): Promise<FallbackResult> {
  // Check if this failure was already handled (prevent double processing)
  const idempotencyKey = failure.details.idempotencyKey;
  if (idempotencyKey && isIdempotencyHandled(idempotencyKey)) {
    console.log(`[FallbackHandler] Idempotency key ${idempotencyKey} already handled, skipping`);
    throw new Error('Failure already handled');
  }
  
  // Mark as handled to prevent double processing
  if (idempotencyKey) {
    markIdempotencyHandled(idempotencyKey);
  }
  
  // Log the failure
  console.error(`[FallbackHandler] Handling generation failure: ${failure.reason}`, {
    userId,
    sessionId,
    idempotencyKey,
    reason: failure.reason
  });
  
  // Record telemetry about the failure
  telemetryService.recordEvent({
    event: 'generation_failed_fallback_triggered',
    category: 'fallback',
    severity: 'warning',
    metrics: {
      failure_reason: failure.reason,
      idempotency_key: idempotencyKey || 'none',
      has_session: !!sessionId,
      user_id: userId
    },
    sessionId: sessionId || undefined,
    userId
  });
  
  // Immediately trigger emergency fallback (skip Tier 1 fresh generation)
  try {
    const result = await resolveEmergencyFallback(storage, sessionId, userId, {
      ...options,
      useCache: true,
      minFrames: 2 // Ensure we get at least 2 frames for morphing
    });
    
    // Add bridge mode to indicate we're in decoupled mode due to failure
    result.bridgeMode = 'decoupled';
    result.reason = `Fallback due to ${failure.reason}: ${result.reason}`;
    
    // Track distinct users impacted by degraded mode
    telemetryService.recordEvent({
      event: 'user_impacted_degraded_mode',
      category: 'fallback',
      severity: 'warning',
      metrics: {
        trigger_reason: failure.reason,
        fallback_tier: result.tier,
        frame_count: result.artworks.length,
        bridge_mode: 'decoupled'
      },
      sessionId: sessionId || undefined,
      userId
    });
    
    console.log(`[FallbackHandler] Successfully resolved fallback with ${result.artworks.length} frames from tier: ${result.tier}`);
    
    return result;
    
  } catch (error) {
    // Critical failure - couldn't even get fallback frames
    console.error(`[FallbackHandler] CRITICAL: Failed to resolve fallback after generation failure`, error);
    
    telemetryService.recordEvent({
      event: 'fallback_resolution_failed',
      category: 'fallback',
      severity: 'critical',
      metrics: {
        original_failure: failure.reason,
        fallback_error: error instanceof Error ? error.message : 'unknown',
        user_id: userId
      },
      sessionId: sessionId || undefined,
      userId
    });
    
    throw error;
  }
}