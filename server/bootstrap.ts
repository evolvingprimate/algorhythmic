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
import { setPoolMonitor } from "./fallback-service";

// Create concrete instances in the correct order

// 1. Create GenerationHealthService first (no dependencies)
const generationHealthService = new GenerationHealthService();

// 2. Create OpenAIService with health service injected
const openAIService = new OpenAIService(generationHealthService);

// 3. Create RecoveryManager with health service and generateArtImage function
const recoveryManager = new RecoveryManager(
  generationHealthService,
  (prompt, options) => openAIService.generateArtImage(prompt, options)
);

// 4. Create QueueController with health service and recovery manager
const queueController = new QueueController(
  generationHealthService,
  recoveryManager
);

// 5. Create QueueService for async DALL-E job processing
const queueService = new QueueService(
  storage,
  generationHealthService,
  openAIService
);

// 6. Create PoolMonitor for real-time pool tracking
const poolMonitor = new PoolMonitor(
  storage,
  generationHealthService
  // Credit controller is optional, can be added later when implemented
);

// 7. Wire up pool monitor with fallback service
setPoolMonitor(poolMonitor);

// 8. Set up pool monitor event listeners for pre-generation
poolMonitor.on('pre-generation', async (requests) => {
  console.log('[Bootstrap] Pre-generation triggered:', requests.length, 'requests');
  for (const request of requests) {
    try {
      await queueService.enqueuePreGenerationJob(
        request.userId,
        request.sessionId,
        request.styles,
        request.count,
        request.reason
      );
    } catch (error) {
      console.error('[Bootstrap] Failed to enqueue pre-generation:', error);
    }
  }
});

poolMonitor.on('emergency-generation', async (requests) => {
  console.error('[Bootstrap] EMERGENCY generation triggered:', requests.length, 'requests');
  for (const request of requests) {
    try {
      // Use regular enqueue with high priority for emergency
      await queueService.enqueueJob(
        request.userId,
        {
          sessionId: request.sessionId,
          audioAnalysis: {
            tempo: 120,
            amplitude: 0.5,
            frequency: 440,
            bassLevel: 50,
            trebleLevel: 50,
            rhythmComplexity: 0.5,
            mood: 'calm',
            genre: 'ambient'
          },
          styles: request.styles,
          artists: [],
          orientation: 'landscape',
          isPreGeneration: true,
          preGenerationReason: request.reason
        },
        request.priority
      );
    } catch (error) {
      console.error('[Bootstrap] Failed to enqueue emergency generation:', error);
    }
  }
});

// 9. Start recovery manager monitoring, queue worker, and pool monitor
recoveryManager.startMonitoring();
queueService.startWorker();
poolMonitor.startMonitoring();

// Export all services as singletons
export {
  generationHealthService,
  openAIService,
  recoveryManager,
  queueController,
  queueService,
  poolMonitor
};

// Export individual functions for backward compatibility
export const generateArtImage = (prompt: string, options?: any) => 
  openAIService.generateArtImage(prompt, options);

export const generateArtPrompt = (params: any) =>
  openAIService.generateArtPrompt(params);