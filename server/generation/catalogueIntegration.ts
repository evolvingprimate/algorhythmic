/**
 * Catalogue Integration - Bridges credit controller with catalogue manager
 * Handles hybrid fresh-vs-library decision making
 */

import { CatalogueManager } from "../services/catalogue-manager";
import { CreditController } from "./creditController";
import { storage } from "../storage";
import { PostgresStorage } from "../storage";
import type { ArtSession } from "@shared/schema";

export interface CatalogueGenerationOptions {
  userId: string;
  sessionId: string;
  orientation: "landscape" | "portrait" | "square";
  styleTags?: string[];
}

export interface CatalogueGenerationResult {
  artwork: ArtSession | null;
  mode: "fresh" | "library";
  reason: string;
}

/**
 * Decide whether to generate fresh or retrieve from catalogue
 * Uses credit controller logic + catalogue manager retrieval
 */
export async function getArtworkWithCatalogueSupport(
  options: CatalogueGenerationOptions
): Promise<CatalogueGenerationResult> {
  const { userId, sessionId, orientation, styleTags } = options;

  // Type guard: Only works with PostgreSQL
  if (!(storage instanceof PostgresStorage)) {
    console.warn("[CatalogueIntegration] MemStorage in use - forcing fresh mode");
    return {
      artwork: null,
      mode: "fresh",
      reason: "catalogue_unavailable_memstorage",
    };
  }

  try {
    // Step 1: Consult credit controller
    const creditController = new CreditController(storage);
    const decision = await creditController.decideFreshOrLibrary(userId, orientation);

    console.log(
      `[CatalogueIntegration] Credit decision: ${decision.mode} (${decision.reason}) for ${orientation}`
    );

    // Step 2: If library mode, attempt catalogue retrieval
    if (decision.mode === "library") {
      const catalogueManager = new CatalogueManager(storage);
      
      const artwork = await catalogueManager.retrieveArtwork({
        userId,
        orientation,
        styleTags,
        limit: 100,
      });

      if (artwork) {
        console.log(`[CatalogueIntegration] ✅ Retrieved library artwork: ${artwork.id}`);
        
        // Mark as viewed (bridge impression)
        await storage.recordImpression(userId, artwork.id, true);
        
        return {
          artwork,
          mode: "library",
          reason: `credit_controller_${decision.reason}`,
        };
      } else {
        console.warn(`[CatalogueIntegration] ⚠️ No suitable library artwork found - falling back to fresh`);
        return {
          artwork: null,
          mode: "fresh",
          reason: "library_exhausted_fallback_fresh",
        };
      }
    }

    // Step 3: Fresh mode - return null (caller will generate)
    return {
      artwork: null,
      mode: "fresh",
      reason: decision.reason,
    };
  } catch (error: any) {
    console.error(`[CatalogueIntegration] Error:`, error.message);
    
    // Fallback to fresh on any error
    return {
      artwork: null,
      mode: "fresh",
      reason: "catalogue_error_fallback_fresh",
    };
  }
}

/**
 * Check if user has exhausted catalogue for a specific orientation
 */
export async function hasExhaustedCatalogue(
  userId: string,
  orientation: "landscape" | "portrait" | "square"
): Promise<boolean> {
  if (!(storage instanceof PostgresStorage)) {
    return false;
  }

  try {
    const catalogueManager = new CatalogueManager(storage);
    return await catalogueManager.hasExhaustedCatalogue(userId, orientation);
  } catch (error: any) {
    console.error(`[CatalogueIntegration] Error checking exhaustion:`, error.message);
    return false;
  }
}
