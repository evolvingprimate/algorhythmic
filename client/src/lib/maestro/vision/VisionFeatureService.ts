import type { SpawnAnchor } from "../control/MaestroControlStore";

/**
 * Vision analysis result from GPT-4o Vision
 */
interface VisionAnalysisResult {
  anchors: SpawnAnchor[];
  analysisTime: number;
  artworkId: string;
}

/**
 * LRU Cache entry for vision analysis
 */
interface CacheEntry {
  result: VisionAnalysisResult;
  timestamp: number;
  ttl: number;
}

/**
 * VisionFeatureService - GPT-4o Vision integration for intelligent spawn points
 * 
 * Features:
 *   - Canvas frame capture (WebGL readPixels)
 *   - GPT-4o Vision API calls for feature detection
 *   - LRU caching per artwork (10-min TTL)
 *   - 45s throttling between API calls
 *   - Normalized spawn anchor coordinates
 * 
 * Design:
 *   - Runs off the render thread (async)
 *   - Cost-conscious (max 1 call per 45s)
 *   - Returns spawn points for edges, focal points, high-contrast areas
 */
export class VisionFeatureService {
  private cache: Map<string, CacheEntry> = new Map();
  private lastApiCallTime: number = 0;
  private readonly API_THROTTLE_MS = 45 * 1000; // 45 seconds
  private readonly DEFAULT_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly MAX_CACHE_SIZE = 10; // LRU limit
  
  private apiCallsToday: number = 0;
  private apiCostToday: number = 0;
  
  constructor() {
    console.log("[VisionFeatureService] Initialized with 45s throttling and 10min TTL");
  }

  /**
   * Analyze canvas frame to extract spawn anchors
   * 
   * @param canvas - HTMLCanvasElement or OffscreenCanvas with current frame
   * @param artworkId - Unique identifier for the artwork (for caching)
   * @returns Spawn anchors or null if throttled/cached
   */
  async analyzeFrame(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    artworkId: string
  ): Promise<SpawnAnchor[] | null> {
    // Check cache first
    const cached = this.getFromCache(artworkId);
    if (cached) {
      console.log(`[VisionFeatureService] Cache hit for ${artworkId}`);
      return cached.anchors;
    }
    
    // Check throttling
    const now = performance.now();
    const timeSinceLastCall = now - this.lastApiCallTime;
    if (timeSinceLastCall < this.API_THROTTLE_MS) {
      const waitTime = Math.ceil((this.API_THROTTLE_MS - timeSinceLastCall) / 1000);
      console.log(
        `[VisionFeatureService] Throttled: wait ${waitTime}s before next API call`
      );
      return null;
    }
    
    // Capture frame as base64 image
    const base64Image = await this.captureFrameAsBase64(canvas);
    if (!base64Image) {
      console.error("[VisionFeatureService] Failed to capture canvas frame");
      return null;
    }
    
    // Call GPT-4o Vision API
    console.log(`[VisionFeatureService] Calling GPT-4o Vision for ${artworkId}...`);
    const startTime = performance.now();
    
    try {
      const anchors = await this.callVisionAPI(base64Image);
      const analysisTime = performance.now() - startTime;
      
      // Update metrics
      this.lastApiCallTime = now;
      this.apiCallsToday++;
      this.apiCostToday += 0.01; // Rough estimate: $0.01 per call
      
      console.log(
        `[VisionFeatureService] Vision analysis complete in ${analysisTime.toFixed(0)}ms ` +
        `(${anchors.length} anchors found, cost today: $${this.apiCostToday.toFixed(2)})`
      );
      
      // Cache the result
      const result: VisionAnalysisResult = {
        anchors,
        analysisTime,
        artworkId,
      };
      this.addToCache(artworkId, result);
      
      return anchors;
    } catch (error) {
      console.error("[VisionFeatureService] Vision API call failed:", error);
      return null;
    }
  }

  /**
   * Capture canvas frame as base64-encoded PNG
   */
  private async captureFrameAsBase64(
    canvas: HTMLCanvasElement | OffscreenCanvas
  ): Promise<string | null> {
    try {
      // For HTMLCanvasElement, use toDataURL
      if (canvas instanceof HTMLCanvasElement) {
        const dataUrl = canvas.toDataURL("image/png");
        // Strip the "data:image/png;base64," prefix
        return dataUrl.split(",")[1];
      }
      
      // For OffscreenCanvas, convert to Blob then to base64
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      
      // Convert to base64
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    } catch (error) {
      console.error("[VisionFeatureService] Failed to capture frame:", error);
      return null;
    }
  }

  /**
   * Call GPT-4o Vision API to detect spawn anchors
   */
  private async callVisionAPI(base64Image: string): Promise<SpawnAnchor[]> {
    const prompt = `Analyze this AI-generated artwork and identify 6-8 visually interesting points where particle effects could spawn.

Focus on:
- High-contrast edges
- Focal points or centers of interest
- Bright spots or highlights
- Intersections of shapes
- Areas with strong visual flow

Return ONLY a JSON array of spawn points in this exact format:
[
  {"x": 0.5, "y": 0.3, "type": "edge", "confidence": 0.9},
  {"x": 0.2, "y": 0.7, "type": "focal", "confidence": 0.85}
]

Where:
- x, y are normalized 0-1 coordinates (0,0 = top-left, 1,1 = bottom-right)
- type is one of: "edge", "focal", "dot", "contrast"
- confidence is 0-1 (how visually interesting this point is)

Limit to 6-8 points maximum. Choose the MOST visually compelling locations.`;

    const response = await fetch("/api/vision/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: base64Image,
        prompt,
      }),
    });

    if (!response.ok) {
      throw new Error(`Vision API failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Parse the GPT response
    // GPT-4o Vision returns text, we need to extract the JSON array
    const anchors = this.parseVisionResponse(data.analysis);
    
    return anchors;
  }

  /**
   * Parse GPT-4o Vision response to extract spawn anchors
   */
  private parseVisionResponse(responseText: string): SpawnAnchor[] {
    try {
      // Try to find JSON array in the response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn("[VisionFeatureService] No JSON array found in response");
        return this.getFallbackAnchors();
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      if (!Array.isArray(parsed)) {
        console.warn("[VisionFeatureService] Response is not an array");
        return this.getFallbackAnchors();
      }
      
      // Validate and add weights
      const anchors: SpawnAnchor[] = parsed
        .filter(item => {
          return (
            typeof item.x === "number" &&
            typeof item.y === "number" &&
            item.x >= 0 && item.x <= 1 &&
            item.y >= 0 && item.y <= 1 &&
            typeof item.type === "string" &&
            typeof item.confidence === "number"
          );
        })
        .map(item => ({
          x: item.x,
          y: item.y,
          type: item.type as "edge" | "focal" | "dot" | "contrast",
          confidence: item.confidence,
          weight: item.confidence, // Use confidence as emission weight
        }));
      
      if (anchors.length === 0) {
        console.warn("[VisionFeatureService] No valid anchors in response");
        return this.getFallbackAnchors();
      }
      
      return anchors;
    } catch (error) {
      console.error("[VisionFeatureService] Failed to parse vision response:", error);
      return this.getFallbackAnchors();
    }
  }

  /**
   * Get fallback spawn anchors if Vision API fails
   * Uses golden ratio / rule of thirds positioning
   */
  private getFallbackAnchors(): SpawnAnchor[] {
    const phi = 0.618; // Golden ratio
    
    return [
      { x: 1 - phi, y: 1 - phi, type: "focal", confidence: 0.6, weight: 0.6 },
      { x: phi, y: 1 - phi, type: "focal", confidence: 0.6, weight: 0.6 },
      { x: 1 - phi, y: phi, type: "focal", confidence: 0.6, weight: 0.6 },
      { x: phi, y: phi, type: "focal", confidence: 0.6, weight: 0.6 },
      { x: 0.5, y: 0.5, type: "focal", confidence: 0.8, weight: 0.8 },
      { x: 0.25, y: 0.75, type: "edge", confidence: 0.5, weight: 0.5 },
      { x: 0.75, y: 0.25, type: "edge", confidence: 0.5, weight: 0.5 },
    ];
  }

  /**
   * Get cached result if available and not expired
   */
  private getFromCache(artworkId: string): VisionAnalysisResult | null {
    const entry = this.cache.get(artworkId);
    if (!entry) return null;
    
    const age = performance.now() - entry.timestamp;
    if (age > entry.ttl) {
      this.cache.delete(artworkId);
      return null;
    }
    
    return entry.result;
  }

  /**
   * Add result to cache with LRU eviction
   */
  private addToCache(artworkId: string, result: VisionAnalysisResult): void {
    // LRU eviction: remove oldest if cache is full
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(artworkId, {
      result,
      timestamp: performance.now(),
      ttl: this.DEFAULT_TTL,
    });
  }

  /**
   * Clear all cached results
   */
  clearCache(): void {
    this.cache.clear();
    console.log("[VisionFeatureService] Cache cleared");
  }

  /**
   * Get diagnostic stats
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      apiCallsToday: this.apiCallsToday,
      apiCostToday: this.apiCostToday,
      lastApiCallTime: this.lastApiCallTime,
      throttleMs: this.API_THROTTLE_MS,
    };
  }
}
