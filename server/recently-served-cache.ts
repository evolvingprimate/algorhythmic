/**
 * Recently-Served Cache with LRU Eviction
 * 
 * Prevents duplicate artwork from being served to the same user session
 * within a time window (1 hour default). Used by fallback service and
 * API endpoints to ensure variety.
 * 
 * Architecture:
 * - Composite key tracking: Map<RecentKey, CacheEntry[]>
 * - RecentKey format: `${sessionId}:${userId}` or `${sessionId}:anonymous`
 * - LRU eviction when cache exceeds maxPerUser limit
 * - Automatic cleanup on access (lazy expiration)
 * - 1 hour TTL by default (configurable)
 * - Thread-safe for concurrent requests
 * 
 * Usage:
 *   const cache = new RecentlyServedCache();
 *   cache.addServed(sessionId, userId, ['artwork-id-1'], 'fresh');
 *   const filtered = cache.filterRecentlyServed(sessionId, userId, artworks);
 */

import type { ArtSession } from "../shared/schema";

// ============================================================================
// Types and Interfaces
// ============================================================================

export type RecentKey = string; // Format: `${sessionId}:${userId}` or `${sessionId}:anonymous`
export type Endpoint = 'bridge' | 'next' | 'other';
export type FallbackTier = 'fresh' | 'style' | 'global';

export interface CacheEntry {
  artworkId: string;
  servedAt: Date;
  tier: FallbackTier;
}

/**
 * Create a composite cache key to prevent cross-endpoint and cross-user collisions
 * Legacy function maintained for backward compatibility
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
// Main Cache Implementation
// ============================================================================

export interface IRecentlyServedCache {
  // Legacy methods for backward compatibility
  markRecent(key: RecentKey, artworkIds: string[], ttlMs?: number): void;
  isRecent(key: RecentKey, artworkId: string): boolean;
  getRecentIds(key: RecentKey): string[];
  
  // New methods for enhanced functionality
  getUserKey(sessionId: string, userId?: string): string;
  addServed(sessionId: string, userId: string | undefined, artworkIds: string[], tier: FallbackTier): void;
  filterRecentlyServed(sessionId: string, userId: string | undefined, artworks: ArtSession[]): ArtSession[];
  getStats(): { totalUsers: number; totalArtworks: number; oldestEntry: Date | null };
  cleanup(): number;
  clear(): void;
}

export class RecentlyServedCache implements IRecentlyServedCache {
  private cache: Map<RecentKey, CacheEntry[]>; // RecentKey -> CacheEntry[]
  private legacyCache: Map<RecentKey, Map<string, number>>; // Legacy format for backward compatibility
  private maxPerUser: number;
  private ttlMs: number; // Time to live for entries
  
  constructor(maxPerUser: number = 100, ttlMs: number = 60 * 60 * 1000) { // 1 hour TTL default
    this.cache = new Map();
    this.legacyCache = new Map();
    this.maxPerUser = maxPerUser;
    this.ttlMs = ttlMs;
  }
  
  /**
   * Generate a consistent cache key
   * @param sessionId - Session ID
   * @param userId - User ID or undefined for anonymous
   * @returns Cache key in format `${sessionId}:${userId}` or `${sessionId}:anonymous`
   */
  getUserKey(sessionId: string, userId?: string): string {
    return `${sessionId}:${userId || 'anonymous'}`;
  }
  
  /**
   * Add served artwork IDs to the cache with LRU eviction
   * @param sessionId - Session ID
   * @param userId - User ID or undefined for anonymous
   * @param artworkIds - Array of artwork IDs that were served
   * @param tier - Fallback tier where the artwork was served
   */
  addServed(sessionId: string, userId: string | undefined, artworkIds: string[], tier: FallbackTier): void {
    const key = this.getUserKey(sessionId, userId);
    let entries = this.cache.get(key) || [];
    const now = new Date();
    
    // Add new entries
    for (const artworkId of artworkIds) {
      // Remove existing entry for this artwork if it exists (update position for LRU)
      entries = entries.filter(e => e.artworkId !== artworkId);
      
      // Add to the end (most recently used)
      entries.push({
        artworkId,
        servedAt: now,
        tier
      });
    }
    
    // Apply LRU eviction if cache exceeds max size
    if (entries.length > this.maxPerUser) {
      // Sort by servedAt date (newest first) and keep only the most recent
      entries.sort((a, b) => b.servedAt.getTime() - a.servedAt.getTime());
      entries = entries.slice(0, this.maxPerUser);
    }
    
    this.cache.set(key, entries);
    
    console.log(`[RecentlyServedCache] Added ${artworkIds.length} artworks for ${key}, tier: ${tier}, total cached: ${entries.length}`);
  }
  
  /**
   * Filter out recently served artworks from a candidate list
   * @param sessionId - Session ID
   * @param userId - User ID or undefined for anonymous
   * @param artworks - Candidate artworks to filter
   * @returns Filtered list excluding recently served artworks
   */
  filterRecentlyServed(sessionId: string, userId: string | undefined, artworks: ArtSession[]): ArtSession[] {
    const key = this.getUserKey(sessionId, userId);
    const entries = this.cache.get(key) || [];
    const now = Date.now();
    
    // Clean up expired entries first
    const validEntries = entries.filter(e => {
      const age = now - e.servedAt.getTime();
      return age < this.ttlMs;
    });
    
    // Update cache with cleaned entries
    if (validEntries.length !== entries.length) {
      this.cache.set(key, validEntries);
    }
    
    // Create a Set of recently served artwork IDs for fast lookup
    const recentIds = new Set(validEntries.map(e => e.artworkId));
    
    // Filter out recently served artworks
    const filtered = artworks.filter(artwork => !recentIds.has(artwork.id));
    
    console.log(`[RecentlyServedCache] Filtered ${artworks.length} → ${filtered.length} artworks for ${key}`);
    
    return filtered;
  }
  
  /**
   * Get cache statistics for monitoring
   * @returns Statistics about the cache state
   */
  getStats(): { totalUsers: number; totalArtworks: number; oldestEntry: Date | null } {
    let totalArtworks = 0;
    let oldestEntry: Date | null = null;
    
    for (const entries of this.cache.values()) {
      totalArtworks += entries.length;
      
      for (const entry of entries) {
        if (!oldestEntry || entry.servedAt < oldestEntry) {
          oldestEntry = entry.servedAt;
        }
      }
    }
    
    return {
      totalUsers: this.cache.size,
      totalArtworks,
      oldestEntry
    };
  }
  
  /**
   * Clean up expired entries across all users
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let totalRemoved = 0;
    
    for (const [key, entries] of this.cache.entries()) {
      const validEntries = entries.filter(e => {
        const age = now - e.servedAt.getTime();
        return age < this.ttlMs;
      });
      
      const removed = entries.length - validEntries.length;
      totalRemoved += removed;
      
      if (validEntries.length === 0) {
        // Remove empty cache entries
        this.cache.delete(key);
      } else if (removed > 0) {
        this.cache.set(key, validEntries);
      }
    }
    
    if (totalRemoved > 0) {
      console.log(`[RecentlyServedCache] Cleaned up ${totalRemoved} expired entries`);
    }
    
    return totalRemoved;
  }
  
  // ============================================================================
  // Legacy Methods for Backward Compatibility
  // ============================================================================
  
  /**
   * Mark artworks as recently served for a cache key (legacy)
   * 
   * @param key - Composite cache key (use makeRecentKey helper)
   * @param artworkIds - Array of artwork IDs to mark
   * @param ttlMs - Optional TTL override (default: 1 hour)
   */
  markRecent(key: RecentKey, artworkIds: string[], ttlMs?: number): void {
    const ttl = ttlMs ?? this.ttlMs;
    const expiresAt = Date.now() + ttl;
    
    let sessionCache = this.legacyCache.get(key);
    if (!sessionCache) {
      sessionCache = new Map();
      this.legacyCache.set(key, sessionCache);
    }
    
    for (const artworkId of artworkIds) {
      sessionCache.set(artworkId, expiresAt);
    }
    
    // Lazy cleanup: remove expired entries for this key
    this.cleanupLegacySession(key);
  }
  
  /**
   * Check if artwork was recently served for a cache key
   * 
   * @param key - Composite cache key
   * @param artworkId - Artwork ID to check
   * @returns true if artwork was recently served
   */
  isRecent(key: RecentKey, artworkId: string): boolean {
    const sessionCache = this.legacyCache.get(key);
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
    const sessionCache = this.legacyCache.get(key);
    if (!sessionCache) {
      return [];
    }
    
    // Cleanup expired entries first
    this.cleanupLegacySession(key);
    
    return Array.from(sessionCache.keys());
  }
  
  /**
   * Remove expired entries for a specific cache key (legacy)
   */
  private cleanupLegacySession(key: RecentKey): void {
    const sessionCache = this.legacyCache.get(key);
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
      this.legacyCache.delete(key);
    }
  }
  
  /**
   * Clear all cache entries (for testing)
   */
  clear(): void {
    this.cache.clear();
    this.legacyCache.clear();
  }
  
  /**
   * Global cleanup: remove all expired entries across all sessions (legacy)
   * Call this periodically (e.g., every 60 seconds) to prevent memory leaks
   */
  cleanupAll(): number {
    // Clean up new cache
    const removedFromNew = this.cleanup();
    
    // Clean up legacy cache
    let removedFromLegacy = 0;
    for (const sessionId of Array.from(this.legacyCache.keys())) {
      const sizeBefore = this.legacyCache.get(sessionId)?.size ?? 0;
      this.cleanupLegacySession(sessionId);
      const sizeAfter = this.legacyCache.get(sessionId)?.size ?? 0;
      removedFromLegacy += sizeBefore - sizeAfter;
    }
    
    return removedFromNew + removedFromLegacy;
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
