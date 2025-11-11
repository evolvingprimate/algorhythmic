/**
 * Catalogue Seed Script - Generate 1,400 library images with fal.ai SDXL Turbo
 * Cost: ~$1.00 | Runtime: ~30-45 mins | Concurrency: 12 workers
 * 
 * Usage: npm run catalogue:seed -- --count=1400 --dry-run=false --batch-size=12
 */

import { FalAiProvider } from "../server/services/fal-ai-provider";
import { ObjectStorageService } from "../server/objectStorage";
import { PostgresStorage } from "../server/storage";
import { v4 as uuidv4 } from "uuid";
import {
  calculateCounts,
  pickStyle,
  pickGenre,
  pickMood,
  SIZES,
  type Orientation,
  type CatalogueTier,
  DEFAULT_DISTRIBUTION,
} from "./catalogue-config";
import { generatePrompt } from "./prompt-generator";

interface GenerationJob {
  id: string;
  tier: CatalogueTier;
  orientation: Orientation;
  style: string;
  genre: string;
  mood: string;
  prompt: string;
}

interface SeedOptions {
  count?: number;
  dryRun?: boolean;
  batchSize?: number;
}

class CatalogueSeedRunner {
  private provider: FalAiProvider;
  private storage: PostgresStorage;
  private objectStorage: ObjectStorageService;
  private stats = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    totalCost: 0,
  };

  constructor() {
    this.provider = new FalAiProvider();
    this.storage = new PostgresStorage();
    this.objectStorage = new ObjectStorageService();
  }

  /**
   * Generate all jobs based on distribution
   */
  private createJobs(totalCount?: number): GenerationJob[] {
    const jobs: GenerationJob[] = [];
    const counts = calculateCounts(DEFAULT_DISTRIBUTION, totalCount);

    console.log("\n📊 Distribution Plan:");
    console.log(`  Dual-Native:   ${counts.dualArtworks} concepts × 2 = ${counts.dualFiles} files`);
    console.log(`  Square-Master: ${counts.squareFiles} files`);
    console.log(`  Landscape-Only: ${counts.landscapeFiles} files`);
    console.log(`  TOTAL: ${counts.totalFiles} files\n`);

    // A) Dual-native: generate BOTH orientations for same concept
    for (let i = 0; i < counts.dualArtworks; i++) {
      const genre = pickGenre();
      const mood = pickMood();
      const style = pickStyle("dual");

      // Portrait version
      jobs.push({
        id: uuidv4(),
        tier: "dual",
        orientation: "portrait",
        style,
        genre,
        mood,
        prompt: generatePrompt({ genre, mood, style, orientation: "portrait" }),
      });

      // Landscape version (same concept)
      jobs.push({
        id: uuidv4(),
        tier: "dual",
        orientation: "landscape",
        style,
        genre,
        mood,
        prompt: generatePrompt({ genre, mood, style, orientation: "landscape" }),
      });
    }

    // B) Square-master: single square files
    for (let i = 0; i < counts.squareFiles; i++) {
      const genre = pickGenre();
      const mood = pickMood();
      const style = pickStyle("square");

      jobs.push({
        id: uuidv4(),
        tier: "square",
        orientation: "square",
        style,
        genre,
        mood,
        prompt: generatePrompt({ genre, mood, style, orientation: "square" }),
      });
    }

    // C) Landscape-only: single landscape files
    for (let i = 0; i < counts.landscapeFiles; i++) {
      const genre = pickGenre();
      const mood = pickMood();
      const style = pickStyle("landscape");

      jobs.push({
        id: uuidv4(),
        tier: "landscape",
        orientation: "landscape",
        style,
        genre,
        mood,
        prompt: generatePrompt({ genre, mood, style, orientation: "landscape" }),
      });
    }

    return jobs;
  }

  /**
   * Process single generation job
   */
  private async processJob(job: GenerationJob, dryRun: boolean): Promise<void> {
    const size = SIZES[job.orientation];

    try {
      this.stats.total++;

      console.log(
        `[${this.stats.total}/${this.stats.total + this.stats.success + this.stats.failed}] ` +
        `${job.tier}/${job.orientation} - ${job.style}`
      );

      if (dryRun) {
        console.log(`  [DRY-RUN] Would generate: ${job.prompt.substring(0, 60)}...`);
        this.stats.skipped++;
        return;
      }

      // Step 1: Generate image with fal.ai
      const result = await this.provider.generate({
        prompt: job.prompt,
        width: size.width,
        height: size.height,
      });

      // Step 2: Upload to Object Storage
      const storagePath = `/library/${job.orientation}/${job.style}/${job.id}.png`;
      const publicUrl = await this.objectStorage.storeImageFromUrl(
        result.imageUrl,
        storagePath
      );

      // Step 3: Insert into artSessions with metadata stubs
      await this.storage.createArtSession({
        id: job.id,
        sessionId: "catalogue-seed",
        userId: "system",
        imageUrl: publicUrl,
        prompt: job.prompt,
        dnaVector: JSON.stringify(Array(50).fill(0.5)), // Stub
        qualityScore: 70,
        motifs: [job.style, job.genre, job.mood],
        
        // Style tags for filtering (CRITICAL FIX)
        styles: [job.style],
        
        // Catalogue metadata
        isLibrary: true,
        orientation: job.orientation,
        tier: job.tier,
        aspectRatio: size.aspectRatio,
        
        // Metadata stubs (Tasks 10-11 will enrich)
        safeArea: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, // Placeholder
        focalPoints: [{ x: 0.5, y: 0.4, r: 0.2 }], // Placeholder
        sidefillPalette: ["#000000", "#FFFFFF"], // Placeholder
      });

      // Update stats
      this.stats.success++;
      const cost = this.provider.estimateCost({ prompt: job.prompt, width: size.width, height: size.height });
      this.stats.totalCost += cost;

      console.log(`  ✅ Success - ${publicUrl}`);
    } catch (error: any) {
      this.stats.failed++;
      console.error(`  ❌ Failed: ${error.message}`);
    }
  }

  /**
   * Process jobs in batches with concurrency control
   */
  private async processBatch(
    jobs: GenerationJob[],
    batchSize: number,
    dryRun: boolean
  ): Promise<void> {
    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(jobs.length / batchSize);

      console.log(`\n🔄 Batch ${batchNum}/${totalBatches} (${batch.length} jobs)`);

      // Process batch in parallel
      await Promise.all(batch.map((job) => this.processJob(job, dryRun)));

      // Rate limiting: 2s delay between batches (fal.ai limit: 600 req/min)
      if (i + batchSize < jobs.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  /**
   * Main entry point
   */
  async run(options: SeedOptions = {}): Promise<void> {
    const {
      count,
      dryRun = false,
      batchSize = 12,
    } = options;

    console.log("\n🎨 Catalogue Seed Script");
    console.log("=" .repeat(50));
    console.log(`Provider: ${this.provider.name}`);
    console.log(`Batch Size: ${batchSize} concurrent`);
    console.log(`Dry Run: ${dryRun ? "YES" : "NO"}`);
    if (count) {
      console.log(`Custom Count: ${count} (overriding default 1400)`);
    }

    // Create generation jobs
    const jobs = this.createJobs(count);

    // Process in batches
    const startTime = Date.now();
    await this.processBatch(jobs, batchSize, dryRun);
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    // Print summary
    console.log("\n" + "=".repeat(50));
    console.log("📈 Summary:");
    console.log(`  Total Jobs: ${this.stats.total}`);
    console.log(`  ✅ Success: ${this.stats.success}`);
    console.log(`  ❌ Failed: ${this.stats.failed}`);
    console.log(`  ⏭️  Skipped: ${this.stats.skipped}`);
    console.log(`  💰 Est. Cost: $${this.stats.totalCost.toFixed(2)}`);
    console.log(`  ⏱️  Duration: ${duration} mins`);
    console.log("=" .repeat(50) + "\n");
  }
}

// CLI entry point
const args = process.argv.slice(2);
const countArg = args.find((arg) => arg.startsWith("--count="))?.split("=")[1];
const batchSizeArg = args.find((arg) => arg.startsWith("--batch-size="))?.split("=")[1];

const options: SeedOptions = {
  count: countArg ? parseInt(countArg) : undefined,
  dryRun: args.includes("--dry-run") || args.includes("--dry-run=true"),
  batchSize: batchSizeArg ? parseInt(batchSizeArg) : 12,
};

const runner = new CatalogueSeedRunner();
runner.run(options).catch((error) => {
  console.error("\n❌ Seed script failed:", error);
  process.exit(1);
});
