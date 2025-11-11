/**
 * Recently-Served Cache
 * 
 * Prevents duplicate artwork from being served to the same user session
 * within a short time window (30s default). Used by catalogue bridge and
 * fresh generation endpoints to ensure variety.
 * 
 * Architecture:
 * - Composite key tracking: Map<RecentKey, Map<artworkId, expiresAt>>
 * - RecentKey format: `${userId}:${sessionId}:${endpoint}` (prevents cross-endpoint/user bleed)
 * - Automatic cleanup on access (lazy expiration)
 * - 30s TTL by default (configurable)
 * - Thread-safe for concurrent requests
 * 
 * Usage:
 *   const key = makeRecentKey(userId, sessionId, 'bridge');
 *   recentlyServedCache.markRecent(key, ['artwork-id-1', 'artwork-id-2']);
 *   const excludeIds = recentlyServedCache.getRecentIds(key);
 */

// ============================================================================
// TASK FIX: Composite key type to prevent cross-route collisions
// ============================================================================

export type RecentKey = string; // Format: `${userId}:${sessionId}:${endpoint}`
export type Endpoint = 'bridge' | 'next' | 'other';

/**
 * Create a composite cache key to prevent cross-endpoint and cross-user collisions
 * 
 * @param userId - User ID from authentication
 * @param sessionId - Session ID (art session)
 * @param endpoint - Endpoint name (e.g., 'bridge', 'next')
 * @returns Composite key for cache isolation
 */
export function makeRecentKey(userId: string, sessionId: string, endpoint: Endpoint): RecentKey {
  return `${userId}:${sessionId}:${endpoint}`;
}

// ============================================================================
// TASK FIX: Explicit interface to prevent accidental re-instantiation
// ============================================================================

export interface IRecentlyServedCache {
  markRecent(key: RecentKey, artworkIds: string[], ttlMs?: number): void;
  isRecent(key: RecentKey, artworkId: string): boolean;
  getRecentIds(key: RecentKey): string[];
  cleanupAll(): number;
  clear(): void;
  getStats(): { sessions: number; totalEntries: number; avgEntriesPerSession: number };
}

interface RecentEntry {
  artworkId: string;
  expiresAt: number; // Unix timestamp in ms
}

export class RecentlyServedCache implements IRecentlyServedCache {
  private cache: Map<RecentKey, Map<string, number>>; // RecentKey -> (artworkId -> expiresAt)
  private defaultTTL: number;
  
  constructor(defaultTTLMs: number = 30000) { // 30 seconds default
    this.cache = new Map();
    this.defaultTTL = defaultTTLMs;
  }
  
  /**
   * Mark artworks as recently served for a cache key
   * 
   * @param key - Composite cache key (use makeRecentKey helper)
   * @param artworkIds - Array of artwork IDs to mark
   * @param ttlMs - Optional TTL override (default: 30s)
   */
  markRecent(key: RecentKey, artworkIds: string[], ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTTL;
    const expiresAt = Date.now() + ttl;
    
    let sessionCache = this.cache.get(key);
    if (!sessionCache) {
      sessionCache = new Map();
      this.cache.set(key, sessionCache);
    }
    
    for (const artworkId of artworkIds) {
      sessionCache.set(artworkId, expiresAt);
    }
    
    // Lazy cleanup: remove expired entries for this key
    this.cleanupSession(key);
  }
  
  /**
   * Check if artwork was recently served for a cache key
   * 
   * @param key - Composite cache key
   * @param artworkId - Artwork ID to check
   * @returns true if artwork was recently served
   */
  isRecent(key: RecentKey, artworkId: string): boolean {
    const sessionCache = this.cache.get(key);
    if (!sessionCache) {
      return false;
    }
    
    const expiresAt = sessionCache.get(artworkId);
    if (!expiresAt) {
      return false;
    }
    
    // Check if entry expired
    if (Date.now() >= expiresAt) {
      sessionCache.delete(artworkId);
      return false;
    }
    
    return true;
  }
  
  /**
   * Get all recent artwork IDs for a cache key (for NOT EXISTS queries)
   * 
   * @param key - Composite cache key
   * @returns Array of recently served artwork IDs
   */
  getRecentIds(key: RecentKey): string[] {
    const sessionCache = this.cache.get(key);
    if (!sessionCache) {
      return [];
    }
    
    // Cleanup expired entries first
    this.cleanupSession(key);
    
    return Array.from(sessionCache.keys());
  }
  
  /**
   * Remove expired entries for a specific cache key
   */
  private cleanupSession(key: RecentKey): void {
    const sessionCache = this.cache.get(key);
    if (!sessionCache) {
      return;
    }
    
    const now = Date.now();
    for (const [artworkId, expiresAt] of Array.from(sessionCache.entries())) {
      if (now >= expiresAt) {
        sessionCache.delete(artworkId);
      }
    }
    
    // Remove empty session caches
    if (sessionCache.size === 0) {
      this.cache.delete(key);
    }
  }
  
  /**
   * Global cleanup: remove all expired entries across all sessions
   * Call this periodically (e.g., every 60 seconds) to prevent memory leaks
   */
  cleanupAll(): number {
    let removedCount = 0;
    
    for (const sessionId of Array.from(this.cache.keys())) {
      const sizeBefore = this.cache.get(sessionId)?.size ?? 0;
      this.cleanupSession(sessionId);
      const sizeAfter = this.cache.get(sessionId)?.size ?? 0;
      removedCount += sizeBefore - sizeAfter;
    }
    
    return removedCount;
  }
  
  /**
   * Clear all cache entries (for testing)
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache stats (for monitoring)
   */
  getStats(): {
    sessions: number;
    totalEntries: number;
    avgEntriesPerSession: number;
  } {
    const sessions = this.cache.size;
    let totalEntries = 0;
    
    for (const sessionCache of Array.from(this.cache.values())) {
      totalEntries += sessionCache.size;
    }
    
    return {
      sessions,
      totalEntries,
      avgEntriesPerSession: sessions > 0 ? totalEntries / sessions : 0,
    };
  }
}

// Global singleton instance
export const recentlyServedCache: RecentlyServedCache = new RecentlyServedCache();

// Start periodic cleanup (every 60 seconds)
setInterval(() => {
  const removed = recentlyServedCache.cleanupAll();
  if (removed > 0) {
    console.log(`[RecentlyServedCache] Cleaned up ${removed} expired entries`);
  }
}, 60000);
