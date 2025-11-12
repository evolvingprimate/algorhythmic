/**
 * fal.ai Provider - SDXL Turbo implementation
 * ~$0.0007 per image, 20-30s generation time
 */

import { fal } from "@fal-ai/client";
import type { GenerationProvider, GenerationInput, GenerationResult } from "./generation-provider";
import { isUrlSafe, logSecurityEvent } from "../security";

export class FalAiProvider implements GenerationProvider {
  name = "fal.ai/fast-sdxl";

  constructor() {
    // Configure with API key from environment
    if (!process.env.FAL_KEY) {
      throw new Error("FAL_KEY environment variable not set");
    }
    
    fal.config({
      credentials: process.env.FAL_KEY,
    });
  }

  async generate(input: GenerationInput): Promise<GenerationResult> {
    const { prompt, width, height, seed } = input;
    
    console.log(`[FalAI] Generating ${width}x${height}: "${prompt.substring(0, 60)}..."`);
    
    try {
      const result = await fal.subscribe("fal-ai/fast-sdxl", {
        input: {
          prompt,
          image_size: {
            width,
            height,
          },
          num_inference_steps: 4, // Fast mode (Turbo)
          num_images: 1,
          seed: seed || undefined,
        },
        logs: false, // Disable verbose logging
        pollInterval: 2000, // Check status every 2s
      }) as any;

      // Response is wrapped in .data when using subscribe()
      const data = result.data || result;

      if (!data?.images?.[0]?.url) {
        throw new Error("No image URL in fal.ai response");
      }

      // SECURITY: Validate the returned image URL to prevent SSRF
      const imageUrl = data.images[0].url;
      
      if (!isUrlSafe(imageUrl)) {
        logSecurityEvent('ssrf.blocked', 'error', {
          source: 'fal-ai-response',
          url: imageUrl.substring(0, 100)
        });
        throw new Error('Invalid image URL returned from fal.ai');
      }
      
      // Fetch image buffer for local storage
      const response = await fetch(imageUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }

      const imageBuffer = Buffer.from(await response.arrayBuffer());

      return {
        imageUrl,
        imageBuffer,
        seed: data.seed,
        metadata: {
          timings: data.timings,
          hasNsfw: data.has_nsfw_concepts?.[0] || false,
        },
      };
    } catch (error: any) {
      console.error(`[FalAI] Generation failed:`, error.message);
      throw new Error(`fal.ai generation failed: ${error.message}`);
    }
  }

  estimateCost(input: GenerationInput): number {
    // fal.ai SDXL pricing: ~$0.00111 per compute second
    // Average 4-step SDXL Turbo: ~0.6s = $0.0007
    return 0.0007;
  }
}
