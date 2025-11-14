/**
 * Bootstrap Module - Composition Root for Dependency Injection
 * This file wires up all dependencies to avoid circular dependency issues
 */

import { GenerationHealthService } from "./generation-health";
import { OpenAIService } from "./openai-service";
import { RecoveryManager } from "./recovery-manager";
import { QueueController } from "./queue-controller";
import { QueueService } from "./queue-service";
import { storage } from "./storage";
import { PoolMonitor } from "./pool-monitor";
import { PreGenerationManager } from "./pre-generation-manager";
import { setPoolMonitor } from "./fallback-service";
import { initializePredictiveEngine, PredictiveEngine } from "./predictive-engine";
import { CreditController } from "./generation/creditController";

// Create concrete instances in the correct order

// 1. Create GenerationHealthService first (no dependencies)
const generationHealthService = new GenerationHealthService();

// 2. Create OpenAIService with health service injected
const openAIService = new OpenAIService(generationHealthService);

// 3. Create CreditController with storage
const creditController = new CreditController(storage);

// 4. Create RecoveryManager with health service and generateArtImage function
const recoveryManager = new RecoveryManager(
  generationHealthService,
  (prompt, options) => openAIService.generateArtImage(prompt, options)
);

// 5. Create QueueController with health service and recovery manager
const queueController = new QueueController(
  generationHealthService,
  recoveryManager
);

// 6. Create QueueService for async DALL-E job processing with proper CreditController
const queueService = new QueueService(
  storage,
  generationHealthService,
  creditController,
  (params: any) => openAIService.generateArtPrompt(params),
  (prompt: string, options?: any) => openAIService.generateArtImage(prompt, options)
);

// 7. Create PoolMonitor for real-time pool tracking with CreditController
const poolMonitor = new PoolMonitor(
  storage,
  generationHealthService,
  creditController
);

// 8. Create PreGenerationManager to handle all pre-gen orchestration
const preGenerationManager = new PreGenerationManager(
  storage,
  generationHealthService,
  queueService, // Required dependency
  creditController
);

// 9. Wire PreGenerationManager to PoolMonitor
poolMonitor.setPreGenerationManager(preGenerationManager);

// 10. Wire up pool monitor with fallback service
setPoolMonitor(poolMonitor);

// Note: Removed legacy event listeners - PreGenerationManager now handles all pre-generation
console.log('[Bootstrap] PreGenerationManager wired to PoolMonitor for coordinated throttling');

// 9. Initialize predictive engine after queue service is created
const predictiveEngine = initializePredictiveEngine(storage, queueService, poolMonitor);

 // 10. Start recovery manager monitoring and pool monitor
recoveryManager.startMonitoring();
poolMonitor.startMonitoring();

// Conditionally start the async worker in the HTTP server process
if (process.env.START_WORKER_IN_SERVER === 'true') {
  console.log('[Bootstrap] Starting worker in HTTP server process');
  queueService.startWorker();
} else {
  console.log('[Bootstrap] Worker NOT started in HTTP server process. Run standalone worker with: npm run worker');
}

// Export all services as singletons
export {
  generationHealthService,
  openAIService,
  recoveryManager,
  queueController,
  queueService,
  poolMonitor,
  predictiveEngine
};

// Export individual functions for backward compatibility
export const generateArtImage = (prompt: string, options?: any) => 
  openAIService.generateArtImage(prompt, options);

export const generateArtPrompt = (params: any) =>
  openAIService.generateArtPrompt(params);
