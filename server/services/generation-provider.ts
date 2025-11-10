/**
 * GenerationProvider Interface - Provider-agnostic image generation
 * Supports swapping between fal.ai, Replicate, DALL-E, etc.
 */

export interface GenerationInput {
  prompt: string;
  width: number;
  height: number;
  model?: string;
  seed?: number;
}

export interface GenerationResult {
  imageUrl: string;
  imageBuffer?: Buffer;
  seed?: number;
  metadata?: Record<string, any>;
}

export interface GenerationProvider {
  name: string;
  generate(input: GenerationInput): Promise<GenerationResult>;
  estimateCost(input: GenerationInput): number;
}
