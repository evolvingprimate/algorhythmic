/**
 * Prompt Generator - Creates SDXL-optimized prompts with orientation awareness
 */

import type { Orientation } from "./catalogue-config";
import { PROMPT_SUFFIXES } from "./catalogue-config";

export interface PromptMetadata {
  genre: string;
  mood: string;
  style: string;
  orientation: Orientation;
}

/**
 * Generate SDXL-optimized prompt from metadata
 */
export function generatePrompt(metadata: PromptMetadata): string {
  const { genre, mood, style, orientation } = metadata;
  
  // Core concept combining style, genre, and mood
  const corePrompt = `${style} ${genre} visual, ${mood} atmosphere, richly textured`;
  
  // Orientation-specific framing instructions
  const orientationSuffix = PROMPT_SUFFIXES[orientation];
  
  // Quality boosters for SDXL
  const qualityTerms = "highly detailed, 8k resolution, masterpiece, trending on artstation";
  
  return `${corePrompt}, ${orientationSuffix}, ${qualityTerms}`;
}

/**
 * Generate negative prompt (what to avoid)
 */
export function generateNegativePrompt(): string {
  return "blurry, low quality, pixelated, text, watermark, signature, border, frame, cropped, out of frame, worst quality, jpeg artifacts";
}

/**
 * Validate prompt length (SDXL has 77-token limit per CLIP encoder)
 */
export function validatePrompt(prompt: string): boolean {
  // Rough estimate: 1 token ≈ 4 characters
  const estimatedTokens = prompt.length / 4;
  
  if (estimatedTokens > 77) {
    console.warn(`[PromptGen] Warning: Prompt may exceed 77 tokens (${estimatedTokens.toFixed(0)} estimated)`);
    return false;
  }
  
  return true;
}
