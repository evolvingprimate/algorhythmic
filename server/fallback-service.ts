// Emergency Fallback Service - Clean 3-tier fallback system for artwork retrieval
import type { ArtSession } from "../shared/schema";
import type { IStorage } from "./storage";

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
  } = {}
): Promise<FallbackResult> {
  const { 
    orientation, 
    styleTags, 
    artistTags, 
    recentlyServedIds = new Set(),
    minFrames = 2 // MorphEngine requires at least 2 frames
  } = options;

  console.log(`[Fallback] Starting 3-tier fallback for user ${userId}, session ${sessionId}`);
  
  // Tier 1: Fresh Generated Frames (never seen by user)
  if (sessionId) {
    try {
      const freshArtworks = await storage.getFreshArtworks(sessionId, userId, 20);
      const validFresh = filterValidImageUrls(freshArtworks);
      
      // Apply recently-served filter but ensure we have enough frames
      const filteredFresh = validFresh.filter(a => !recentlyServedIds.has(a.id));
      
      if (filteredFresh.length >= minFrames) {
        console.log(`[Fallback] Tier 1 SUCCESS: ${filteredFresh.length} fresh frames`);
        return {
          artworks: filteredFresh,
          tier: 'fresh',
          reason: 'Fresh generated frames available',
          bypassedCache: false
        };
      }
      
      // If filtering leaves too few, use unfiltered to prevent glitch
      if (validFresh.length >= minFrames) {
        console.warn(`[Fallback] Tier 1 PARTIAL: Using unfiltered fresh (bypassing cache)`);
        return {
          artworks: validFresh.slice(0, Math.max(minFrames, filteredFresh.length)),
          tier: 'fresh',
          reason: 'Fresh frames with cache bypass',
          bypassedCache: true
        };
      }
    } catch (error) {
      console.error(`[Fallback] Tier 1 failed:`, error);
    }
  }

  // Tier 2: Style-Matched Round-Robin (from catalog)
  if (styleTags && styleTags.length > 0) {
    try {
      const styleMatched = await storage.getCatalogCandidates(userId, styleTags, 50);
      const validStyled = filterValidImageUrls(styleMatched);
      
      // For Tier 2, we relax the recently-served restriction
      // Use LRU ordering instead of hard filter
      const sortedByLRU = validStyled.sort((a, b) => {
        const aRecent = recentlyServedIds.has(a.id) ? 1 : 0;
        const bRecent = recentlyServedIds.has(b.id) ? 1 : 0;
        return aRecent - bRecent; // Non-recent first
      });
      
      if (sortedByLRU.length >= minFrames) {
        console.log(`[Fallback] Tier 2 SUCCESS: ${sortedByLRU.length} style-matched frames`);
        return {
          artworks: sortedByLRU.slice(0, 20),
          tier: 'style-matched',
          reason: 'Style-matched catalog frames',
          bypassedCache: true // Tier 2 always bypasses strict cache
        };
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
    
    const validGlobal = filterValidImageUrls(globalArtworks);
    
    if (validGlobal.length >= minFrames) {
      console.log(`[Fallback] Tier 3 SUCCESS: ${validGlobal.length} global frames`);
      return {
        artworks: validGlobal.slice(0, 20),
        tier: 'global',
        reason: 'Global fallback pool',
        bypassedCache: true
      };
    }
    
    // Absolute last resort - try getRecentArt without any filters
    const recentArt = await storage.getRecentArt(50);
    const validRecent = filterValidImageUrls(recentArt);
    
    if (validRecent.length >= minFrames) {
      console.warn(`[Fallback] Tier 3 LAST RESORT: ${validRecent.length} recent artworks`);
      return {
        artworks: validRecent.slice(0, Math.max(minFrames, 10)),
        tier: 'global',
        reason: 'Last resort global pool',
        bypassedCache: true
      };
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