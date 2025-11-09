import type { ArtSession } from "@shared/schema";

export interface PoolCandidate {
  id: string;
  imageUrl: string;
  prompt: string;
  dna: number[]; // 50-point vector (0-1 normalized)
  motifs: string[];
  qualityScore: number; // 0-100
  sessionId: string;
  userId: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface FindBestOptions {
  requireQuality?: boolean; // Filter by minimum quality threshold
  k?: number; // Return top K matches (default 1)
  minQuality?: number; // Minimum quality score (0-100, default 35)
}

export interface PoolScore {
  artwork: PoolCandidate;
  score: number;
  breakdown: {
    dnaSimilarity: number;
    motifJaccard: number;
    quality: number;
  };
}

/**
 * ImagePool Service - Hybrid gen+retrieve system with DNA similarity scoring
 * 
 * Implements the storage pool strategy:
 * - Warm start: instant best-match while generator works
 * - Hard fallback: if all models fail, pull best match
 * - Cost control: reuse great frames when DNA is close enough
 */
export class ImagePoolService {
  private normalizedCache = new Map<string, { dna: number[]; motifs: Set<string> }>();
  private readonly CACHE_SIZE = 500;

  /**
   * Find best matching artwork from pool based on DNA, motifs, and quality
   * 
   * Scoring formula: 0.6·cosineDNA + 0.2·motifJaccard + 0.2·quality
   */
  async findBest(
    candidates: PoolCandidate[],
    targetDNA: number[],
    targetMotifs: string[],
    opts: FindBestOptions = {}
  ): Promise<PoolScore | null> {
    const { requireQuality = false, k = 1, minQuality = 35 } = opts;

    if (candidates.length === 0) return null;

    // Filter by quality if required
    const filtered = requireQuality
      ? candidates.filter((c) => c.qualityScore >= minQuality)
      : candidates;

    if (filtered.length === 0) return null;

    // Normalize target DNA and motifs
    const normalizedTarget = this.normalizeDNA(targetDNA);
    const targetMotifSet = new Set(targetMotifs);

    // Score all candidates
    const scored = filtered.map((candidate) => {
      const cached = this.getCached(candidate);
      
      const dnaSimilarity = this.cosineSimilarity(normalizedTarget, cached.dna);
      const motifJaccard = this.jaccardSimilarity(targetMotifSet, cached.motifs);
      const qualityNormalized = candidate.qualityScore / 100; // 0-1 scale

      // Hybrid scoring: 0.6·DNA + 0.2·motif + 0.2·quality
      const score = 0.6 * dnaSimilarity + 0.2 * motifJaccard + 0.2 * qualityNormalized;

      return {
        artwork: candidate,
        score,
        breakdown: {
          dnaSimilarity,
          motifJaccard,
          quality: qualityNormalized,
        },
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Return top match
    return scored[0] || null;
  }

  /**
   * Mark artwork as used (for LRU eviction)
   */
  markUsed(id: string, timestamp: Date = new Date()): void {
    // This will be called by storage layer after retrieval
    // Just updating cache timestamp for now
    const cached = this.normalizedCache.get(id);
    if (cached) {
      // Refresh cache entry
      this.normalizedCache.delete(id);
      this.normalizedCache.set(id, cached);
    }
  }

  /**
   * Clear cache for specific artwork (after update/delete)
   */
  invalidate(id: string): void {
    this.normalizedCache.delete(id);
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.normalizedCache.clear();
  }

  // ===== PRIVATE HELPERS =====

  /**
   * Get or compute normalized DNA and motif set for candidate
   */
  private getCached(candidate: PoolCandidate): { dna: number[]; motifs: Set<string> } {
    const cached = this.normalizedCache.get(candidate.id);
    if (cached) return cached;

    const normalized = {
      dna: this.normalizeDNA(candidate.dna),
      motifs: new Set(candidate.motifs),
    };

    // LRU cache: remove oldest if full
    if (this.normalizedCache.size >= this.CACHE_SIZE) {
      const firstKey = this.normalizedCache.keys().next().value;
      if (firstKey) {
        this.normalizedCache.delete(firstKey);
      }
    }

    this.normalizedCache.set(candidate.id, normalized);
    return normalized;
  }

  /**
   * Normalize DNA vector to unit length
   */
  private normalizeDNA(dna: number[]): number[] {
    const magnitude = Math.sqrt(dna.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return dna;
    return dna.map((val) => val / magnitude);
  }

  /**
   * Compute cosine similarity between two normalized vectors
   * Returns value in [0, 1] where 1 = identical
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    // Vectors already normalized, so dot product = cosine similarity
    // Clamp to [0, 1] range (should already be in [-1, 1] but normalize to [0, 1])
    return Math.max(0, Math.min(1, (dotProduct + 1) / 2));
  }

  /**
   * Compute Jaccard similarity between two sets
   * Returns value in [0, 1] where 1 = identical
   */
  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1; // Empty sets are identical
    if (a.size === 0 || b.size === 0) return 0;

    const aArray = Array.from(a);
    const bArray = Array.from(b);
    const intersection = aArray.filter((x) => b.has(x));
    const unionSet = new Set([...aArray, ...bArray]);

    return intersection.length / unionSet.size;
  }
}

// Singleton instance
export const imagePoolService = new ImagePoolService();
