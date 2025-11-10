/**
 * Vision Analyzer - GPT-4o Vision integration for image saliency detection
 * Detects focal points, edges, and anchor regions for particle spawning
 */

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface FocalPoint {
  x: number; // 0-1 normalized
  y: number; // 0-1 normalized
  r: number; // Radius 0-1
  confidence?: number; // 0-1
  label?: string; // "face", "edge", "contrast", etc.
}

export interface SafeArea {
  x: number; // 0-1 normalized left offset
  y: number; // 0-1 normalized top offset
  w: number; // 0-1 normalized width
  h: number; // 0-1 normalized height
}

export interface VisionAnalysisResult {
  focalPoints: FocalPoint[];
  safeArea: SafeArea;
  dominantColors: string[];
  description?: string;
}

export class VisionAnalyzer {
  /**
   * Analyze image for focal points and safe areas using GPT-4o Vision
   */
  async analyzeImage(imageUrl: string): Promise<VisionAnalysisResult> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this image for visual composition:

1. **Focal Points**: Identify 3-5 regions of high visual interest (faces, edges, high contrast areas, compositional focal points). For each, provide:
   - x, y coordinates (0-1 normalized, where 0,0 is top-left)
   - r (radius 0-1, how large the region is)
   - label (type: "face", "edge", "contrast", "subject", etc.)

2. **Safe Area**: Define a rectangular region containing the main subject that should remain visible during Ken Burns zoom effects. Avoid edges where content might be cropped. Provide:
   - x, y (0-1 normalized top-left corner)
   - w, h (0-1 normalized width/height)

3. **Dominant Colors**: Extract 3-5 dominant colors as hex codes (e.g., #FF5733).

Return ONLY valid JSON in this exact format:
{
  "focalPoints": [
    {"x": 0.5, "y": 0.3, "r": 0.15, "label": "subject"},
    {"x": 0.2, "y": 0.7, "r": 0.1, "label": "edge"}
  ],
  "safeArea": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8},
  "dominantColors": ["#1A1A2E", "#16213E", "#0F3460", "#533483", "#E94560"]
}`,
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 500,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from GPT-4o Vision");
      }

      const result = JSON.parse(content) as VisionAnalysisResult;

      // Validate and clamp values to 0-1 range
      result.focalPoints = result.focalPoints.map((fp) => ({
        x: Math.max(0, Math.min(1, fp.x)),
        y: Math.max(0, Math.min(1, fp.y)),
        r: Math.max(0.05, Math.min(0.3, fp.r)), // Clamp radius to 5-30%
        label: fp.label,
        confidence: 0.8, // Default confidence
      }));

      // Validate safe area
      result.safeArea = {
        x: Math.max(0, Math.min(0.5, result.safeArea.x)),
        y: Math.max(0, Math.min(0.5, result.safeArea.y)),
        w: Math.max(0.5, Math.min(1, result.safeArea.w)),
        h: Math.max(0.5, Math.min(1, result.safeArea.h)),
      };

      // Ensure safe area stays within bounds
      if (result.safeArea.x + result.safeArea.w > 1) {
        result.safeArea.w = 1 - result.safeArea.x;
      }
      if (result.safeArea.y + result.safeArea.h > 1) {
        result.safeArea.h = 1 - result.safeArea.y;
      }

      return result;
    } catch (error: any) {
      console.error("[VisionAnalyzer] Failed to analyze image:", error.message);
      
      // Return sensible defaults on failure
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Batch analyze multiple images with rate limiting
   */
  async analyzeImageBatch(imageUrls: string[]): Promise<VisionAnalysisResult[]> {
    const results: VisionAnalysisResult[] = [];
    
    for (let i = 0; i < imageUrls.length; i++) {
      console.log(`[VisionAnalyzer] Analyzing image ${i + 1}/${imageUrls.length}`);
      
      const result = await this.analyzeImage(imageUrls[i]);
      results.push(result);
      
      // Rate limiting: 60 req/min for GPT-4o
      if (i < imageUrls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  /**
   * Default analysis for fallback
   */
  private getDefaultAnalysis(): VisionAnalysisResult {
    return {
      focalPoints: [
        { x: 0.5, y: 0.4, r: 0.2, label: "center", confidence: 0.5 },
        { x: 0.3, y: 0.3, r: 0.15, label: "upper-left", confidence: 0.4 },
        { x: 0.7, y: 0.6, r: 0.15, label: "lower-right", confidence: 0.4 },
      ],
      safeArea: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 },
      dominantColors: ["#1A1A2E", "#16213E", "#0F3460", "#533483", "#E94560"],
      description: "Default fallback analysis",
    };
  }
}
