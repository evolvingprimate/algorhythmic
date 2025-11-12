/**
 * Idempotency Cache for API Request Deduplication
 * 
 * Prevents duplicate processing of identical requests by caching responses
 * for a short TTL window. Used primarily for the /api/generate endpoint
 * to handle client retries and network issues gracefully.
 * 
 * Architecture:
 * - In-memory Map with automatic TTL expiration
 * - Configurable cleanup interval for expired entries
 * - Thread-safe for concurrent requests
 * - JSON serialization for response payloads
 * 
 * Usage:
 *   const cache = new IdempotencyCache();
 *   const cached = cache.getResponse(key);
 *   if (cached) return cached;
 *   // ... do expensive operation ...
 *   cache.setResponse(key, response, 300); // Cache for 5 minutes
 */

interface CacheEntry {
  response: any;
  expiresAt: number;
}

export class IdempotencyCache {
  private cache: Map<string, CacheEntry>;
  private cleanupInterval: NodeJS.Timeout | null;
  private readonly defaultTTL: number = 300; // 5 minutes default

  constructor(cleanupIntervalMs: number = 60000) { // Clean up every minute
    this.cache = new Map();
    this.cleanupInterval = null;
    
    // Start periodic cleanup
    this.startCleanup(cleanupIntervalMs);
  }

  /**
   * Get a cached response if it exists and hasn't expired
   * @param key - The idempotency key
   * @returns The cached response or null if not found/expired
   */
  getResponse(key: string): any | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    console.log(`[IdempotencyCache] Cache hit for key: ${key}`);
    return entry.response;
  }

  /**
   * Store a response in the cache
   * @param key - The idempotency key
   * @param response - The response object to cache
   * @param ttlSeconds - Time to live in seconds (default: 300)
   */
  setResponse(key: string, response: any, ttlSeconds?: number): void {
    const ttl = ttlSeconds || this.defaultTTL;
    const expiresAt = Date.now() + (ttl * 1000);
    
    this.cache.set(key, {
      response,
      expiresAt
    });
    
    console.log(`[IdempotencyCache] Cached response for key: ${key} (TTL: ${ttl}s)`);
  }

  /**
   * Check if a key exists in the cache (regardless of expiry)
   * @param key - The idempotency key
   * @returns true if the key exists
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a specific key from the cache
   * @param key - The idempotency key
   * @returns true if the key was deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    console.log('[IdempotencyCache] Cache cleared');
  }

  /**
   * Remove expired entries from the cache
   * @returns The number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`[IdempotencyCache] Cleaned up ${removed} expired entries`);
    }
    
    return removed;
  }

  /**
   * Start periodic cleanup of expired entries
   * @param intervalMs - Cleanup interval in milliseconds
   */
  private startCleanup(intervalMs: number): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  /**
   * Stop periodic cleanup (useful for testing)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get cache statistics
   * @returns Object with cache stats
   */
  getStats(): { size: number; entries: Array<{ key: string; expiresAt: Date }> } {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      expiresAt: new Date(entry.expiresAt)
    }));
    
    return {
      size: this.cache.size,
      entries
    };
  }

  /**
   * Create a composite cache key for idempotency
   * @param userId - User ID
   * @param idempotencyKey - Client-provided idempotency key
   * @returns Composite cache key
   */
  static makeKey(userId: string, idempotencyKey: string): string {
    return `idempotency:${userId}:${idempotencyKey}`;
  }
}

// Export singleton instance
export const idempotencyCache = new IdempotencyCache();