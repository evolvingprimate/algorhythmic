/**
 * Catalogue Enrichment Script - Analyze existing images and update metadata
 * Adds focal points, safe areas, and color palettes using GPT-4o Vision
 * 
 * Usage: npx tsx scripts/catalogue-enrich.ts --limit=100 --dry-run=false
 */

import { PostgresStorage } from "../server/storage";
import { VisionAnalyzer } from "../server/services/vision-analyzer";
import { PaletteExtractor } from "../server/services/palette-extractor";

interface EnrichOptions {
  limit?: number;
  dryRun?: boolean;
  skipExisting?: boolean;
}

class CatalogueEnrichRunner {
  private storage: PostgresStorage;
  private visionAnalyzer: VisionAnalyzer;
  private paletteExtractor: PaletteExtractor;
  private stats = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  constructor() {
    this.storage = new PostgresStorage();
    this.visionAnalyzer = new VisionAnalyzer();
    this.paletteExtractor = new PaletteExtractor();
  }

  /**
   * Enrich a single artwork with saliency metadata
   */
  private async enrichArtwork(artworkId: string, imageUrl: string, dryRun: boolean): Promise<void> {
    try {
      this.stats.total++;

      console.log(`[${this.stats.total}] Analyzing: ${artworkId}`);

      if (dryRun) {
        console.log(`  [DRY-RUN] Would analyze: ${imageUrl}`);
        this.stats.skipped++;
        return;
      }

      // Step 1: Vision analysis for focal points and safe area
      const visionResult = await this.visionAnalyzer.analyzeImage(imageUrl);

      // Step 2: Palette extraction (vision result already has colors)
      const palette = visionResult.dominantColors.length > 0
        ? visionResult.dominantColors
        : (await this.paletteExtractor.extractFromUrl(imageUrl)).colors;

      // Step 3: Update database
      await this.storage.updateArtSessionMetadata(artworkId, {
        focalPoints: visionResult.focalPoints,
        safeArea: visionResult.safeArea,
        sidefillPalette: palette,
      });

      this.stats.success++;
      console.log(`  ✅ Success - ${visionResult.focalPoints.length} focal points, ${palette.length} colors`);
    } catch (error: any) {
      this.stats.failed++;
      console.error(`  ❌ Failed: ${error.message}`);
    }
  }

  /**
   * Main entry point
   */
  async run(options: EnrichOptions = {}): Promise<void> {
    const {
      limit = 100,
      dryRun = false,
      skipExisting = true,
    } = options;

    console.log("\n🔍 Catalogue Enrichment Script");
    console.log("=".repeat(50));
    console.log(`Limit: ${limit}`);
    console.log(`Dry Run: ${dryRun ? "YES" : "NO"}`);
    console.log(`Skip Existing: ${skipExisting ? "YES" : "NO"}`);

    // Fetch library artworks needing enrichment
    const artworks = await this.storage.getLibraryArtworksNeedingEnrichment(limit, skipExisting);

    if (artworks.length === 0) {
      console.log("\n✅ No artworks need enrichment!");
      return;
    }

    console.log(`\nFound ${artworks.length} artworks to enrich\n`);

    // Process sequentially with rate limiting
    const startTime = Date.now();
    for (const artwork of artworks) {
      await this.enrichArtwork(artwork.id, artwork.imageUrl, dryRun);
      
      // Rate limiting: 1s between requests (GPT-4o Vision limit: 60 req/min)
      if (!dryRun) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    // Print summary
    console.log("\n" + "=".repeat(50));
    console.log("📈 Summary:");
    console.log(`  Total: ${this.stats.total}`);
    console.log(`  ✅ Success: ${this.stats.success}`);
    console.log(`  ❌ Failed: ${this.stats.failed}`);
    console.log(`  ⏭️  Skipped: ${this.stats.skipped}`);
    console.log(`  ⏱️  Duration: ${duration} mins`);
    console.log("=".repeat(50) + "\n");
  }
}

// CLI entry point
const args = process.argv.slice(2);
const limitArg = args.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
const skipExistingArg = args.find((arg) => arg.startsWith("--skip-existing="))?.split("=")[1];

const options: EnrichOptions = {
  limit: limitArg ? parseInt(limitArg) : 100,
  dryRun: args.includes("--dry-run") || args.includes("--dry-run=true"),
  skipExisting: skipExistingArg !== "false", // Default true
};

const runner = new CatalogueEnrichRunner();
runner.run(options).catch((error) => {
  console.error("\n❌ Enrichment script failed:", error);
  process.exit(1);
});
