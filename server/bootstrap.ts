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

// 6. Start recovery manager monitoring and queue worker
recoveryManager.startMonitoring();
queueService.startWorker();

// Export all services as singletons
export {
  generationHealthService,
  openAIService,
  recoveryManager,
  queueController,
  queueService
};

// Export individual functions for backward compatibility
export const generateArtImage = (prompt: string, options?: any) => 
  openAIService.generateArtImage(prompt, options);

export const generateArtPrompt = (params: any) =>
  openAIService.generateArtPrompt(params);