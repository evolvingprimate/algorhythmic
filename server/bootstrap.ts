/**
 * Bootstrap Module - Composition Root for Dependency Injection
 * This file wires up all dependencies to avoid circular dependency issues
 */

import { GenerationHealthService } from "./generation-health";
import { OpenAIService } from "./openai-service";
import { RecoveryManager } from "./recovery-manager";
import { QueueController } from "./queue-controller";

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

// 5. Start recovery manager monitoring
recoveryManager.startMonitoring();

// Export all services as singletons
export {
  generationHealthService,
  openAIService,
  recoveryManager,
  queueController
};

// Export individual functions for backward compatibility
export const generateArtImage = (prompt: string, options?: any) => 
  openAIService.generateArtImage(prompt, options);

export const generateArtPrompt = (params: any) =>
  openAIService.generateArtPrompt(params);