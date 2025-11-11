/**
 * Recently-Served Cache
 * 
 * Prevents duplicate artwork from being served to the same user session
 * within a short time window (30s default). Used by catalogue bridge and
 * fresh generation endpoints to ensure variety.
 * 
 * Architecture:
 * - Per-session tracking: Map<sessionId, Map<artworkId, expiresAt>>
 * - Automatic cleanup on access (lazy expiration)
 * - 30s TTL by default (configurable)
 * - Thread-safe for concurrent requests
 */

interface RecentEntry {
  artworkId: string;
  expiresAt: number; // Unix timestamp in ms
}

export class RecentlyServedCache {
  private cache: Map<string, Map<string, number>>; // sessionId -> (artworkId -> expiresAt)
  private defaultTTL: number;
  
  constructor(defaultTTLMs: number = 30000) { // 30 seconds default
    this.cache = new Map();
    this.defaultTTL = defaultTTLMs;
  }
  
  /**
   * Mark artworks as recently served for a session
   */
  markRecent(sessionId: string, artworkIds: string[], ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTTL;
    const expiresAt = Date.now() + ttl;
    
    let sessionCache = this.cache.get(sessionId);
    if (!sessionCache) {
      sessionCache = new Map();
      this.cache.set(sessionId, sessionCache);
    }
    
    for (const artworkId of artworkIds) {
      sessionCache.set(artworkId, expiresAt);
    }
    
    // Lazy cleanup: remove expired entries for this session
    this.cleanupSession(sessionId);
  }
  
  /**
   * Check if artwork was recently served to this session
   */
  isRecent(sessionId: string, artworkId: string): boolean {
    const sessionCache = this.cache.get(sessionId);
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
   * Get all recent artwork IDs for a session (for NOT EXISTS queries)
   */
  getRecentIds(sessionId: string): string[] {
    const sessionCache = this.cache.get(sessionId);
    if (!sessionCache) {
      return [];
    }
    
    // Cleanup expired entries first
    this.cleanupSession(sessionId);
    
    return Array.from(sessionCache.keys());
  }
  
  /**
   * Remove expired entries for a specific session
   */
  private cleanupSession(sessionId: string): void {
    const sessionCache = this.cache.get(sessionId);
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
      this.cache.delete(sessionId);
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
export const recentlyServedCache = new RecentlyServedCache();

// Start periodic cleanup (every 60 seconds)
setInterval(() => {
  const removed = recentlyServedCache.cleanupAll();
  if (removed > 0) {
    console.log(`[RecentlyServedCache] Cleaned up ${removed} expired entries`);
  }
}, 60000);
