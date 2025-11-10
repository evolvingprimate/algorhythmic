/**
 * Catalogue Manager - Intelligent library artwork retrieval
 * Handles orientation-aware selection, preference matching, and coverage monitoring
 */

import type { PostgresStorage } from "../storage";
import type { ArtSession } from "@shared/schema";

export interface CatalogueRetrievalOptions {
  userId: string;
  orientation: "landscape" | "portrait" | "square";
  styleTags?: string[];
  limit?: number;
  excludeIds?: string[];
}

export interface CatalogueHealthReport {
  totalLibraryArtworks: number;
  byOrientation: {
    landscape: number;
    portrait: number;
    square: number;
  };
  needsEnrichment: number;
  belowThreshold: string[]; // Orientations below minimum threshold
  status: "healthy" | "warning" | "critical";
}

export class CatalogueManager {
  private storage: PostgresStorage;
  private readonly MINIMUM_PER_ORIENTATION = 200;
  private readonly CRITICAL_THRESHOLD = 50;

  constructor(storage: PostgresStorage) {
    this.storage = storage;
  }

  /**
   * Retrieve catalogue artwork with orientation-aware filtering and user preferences
   */
  async retrieveArtwork(options: CatalogueRetrievalOptions): Promise<ArtSession | null> {
    const { userId, orientation, styleTags, excludeIds } = options;

    console.log(`[CatalogueManager] Retrieving ${orientation} artwork for user ${userId}`);

    // Get library artworks matching preferences
    const candidates = await this.storage.getLibraryArtwork(
      userId,
      orientation,
      styleTags,
      100 // Retrieve up to 100 candidates for randomization
    );

    if (candidates.length === 0) {
      console.warn(`[CatalogueManager] No ${orientation} artworks in catalogue`);
      return null;
    }

    // Filter out already-viewed artworks (impressions check)
    const unseenCandidates = await this.filterUnseenArtworks(userId, candidates);

    if (unseenCandidates.length === 0) {
      console.warn(`[CatalogueManager] All ${orientation} artworks already viewed by user`);
      return null;
    }

    // Exclude specific IDs if provided
    const filtered = excludeIds && excludeIds.length > 0
      ? unseenCandidates.filter(art => !excludeIds.includes(art.id))
      : unseenCandidates;

    if (filtered.length === 0) {
      console.warn(`[CatalogueManager] No artworks remaining after filtering`);
      return null;
    }

    // Random selection from filtered candidates
    const selected = filtered[Math.floor(Math.random() * filtered.length)];

    console.log(`[CatalogueManager] Selected: ${selected.id} (${filtered.length} candidates)`);
    return selected;
  }

  /**
   * Filter artworks to exclude those already viewed by user
   */
  private async filterUnseenArtworks(
    userId: string,
    candidates: ArtSession[]
  ): Promise<ArtSession[]> {
    if (candidates.length === 0) return [];

    const artworkIds = candidates.map(art => art.id);
    const validIds = await this.storage.validateArtworkVisibility(userId, artworkIds);

    // Get user's viewed artwork IDs
    const viewedIds = new Set(
      (await this.storage.getUserArtImpressions(userId))
        .map(impression => impression.artworkId)
    );

    return candidates.filter(art => 
      validIds.includes(art.id) && !viewedIds.has(art.id)
    );
  }

  /**
   * Check catalogue health and coverage across orientations
   */
  async getHealthReport(): Promise<CatalogueHealthReport> {
    const stats = await this.storage.getCatalogueStats();

    const byOrientation = {
      landscape: stats.byOrientation.landscape || 0,
      portrait: stats.byOrientation.portrait || 0,
      square: stats.byOrientation.square || 0,
    };

    const belowThreshold: string[] = [];
    let status: "healthy" | "warning" | "critical" = "healthy";

    // Check each orientation against thresholds
    for (const [orientation, count] of Object.entries(byOrientation)) {
      if (count < this.CRITICAL_THRESHOLD) {
        belowThreshold.push(orientation);
        status = "critical";
      } else if (count < this.MINIMUM_PER_ORIENTATION) {
        belowThreshold.push(orientation);
        if (status === "healthy") status = "warning";
      }
    }

    return {
      totalLibraryArtworks: stats.total,
      byOrientation,
      needsEnrichment: stats.needsEnrichment || 0,
      belowThreshold,
      status,
    };
  }

  /**
   * Get orientations that need gap-filling generation
   */
  async getOrientationsNeedingRefill(): Promise<string[]> {
    const report = await this.getHealthReport();
    return report.belowThreshold;
  }

  /**
   * Check if user has exhausted catalogue for a specific orientation
   */
  async hasExhaustedCatalogue(
    userId: string,
    orientation: "landscape" | "portrait" | "square"
  ): Promise<boolean> {
    const totalInCatalogue = await this.storage.getLibraryArtworkCount(orientation);
    const viewedCount = await this.storage.getUserViewedLibraryCount(userId, orientation);

    const exhaustionThreshold = 0.95; // 95% viewed = exhausted
    return viewedCount / totalInCatalogue >= exhaustionThreshold;
  }

  /**
   * Get catalogue coverage percentage for an orientation
   */
  async getCoveragePercentage(orientation: "landscape" | "portrait" | "square"): Promise<number> {
    const count = await this.storage.getLibraryArtworkCount(orientation);
    return (count / this.MINIMUM_PER_ORIENTATION) * 100;
  }
}
