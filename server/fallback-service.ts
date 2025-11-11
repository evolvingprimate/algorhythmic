// Emergency Fallback Service - Clean 3-tier fallback system for artwork retrieval
import type { ArtSession } from "../shared/schema";
import type { IStorage } from "./storage";
import { recentlyServedCache } from "./recently-served-cache";

export interface FallbackResult {
  artworks: ArtSession[];
  tier: 'fresh' | 'style-matched' | 'global';
  reason: string;
  bypassedCache: boolean;
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