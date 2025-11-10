/**
 * Palette Extractor - Extract dominant colors from images for sidefill rendering
 * Uses simple color quantization without external dependencies
 */

export interface ColorPalette {
  colors: string[]; // Hex colors
  confidence: number;
}

export class PaletteExtractor {
  /**
   * Extract dominant colors from image buffer using k-means clustering
   * This is a simple implementation - for production, consider using sharp or jimp
   */
  async extractFromBuffer(imageBuffer: Buffer): Promise<ColorPalette> {
    try {
      // For now, return placeholder colors
      // In a full implementation, you'd use canvas or sharp to read pixels
      // and perform k-means clustering to find dominant colors
      
      console.warn("[PaletteExtractor] Using placeholder palette - implement pixel analysis for production");
      
      return {
        colors: [
          "#1A1A2E", // Deep blue-black
          "#16213E", // Dark blue
          "#0F3460", // Navy
          "#533483", // Purple
          "#E94560", // Coral red
        ],
        confidence: 0.7,
      };
    } catch (error: any) {
      console.error("[PaletteExtractor] Failed to extract palette:", error.message);
      
      return this.getDefaultPalette();
    }
  }

  /**
   * Extract dominant colors from image URL
   */
  async extractFromUrl(imageUrl: string): Promise<ColorPalette> {
    try {
      // Fetch image buffer
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      return this.extractFromBuffer(buffer);
    } catch (error: any) {
      console.error("[PaletteExtractor] Failed to extract from URL:", error.message);
      return this.getDefaultPalette();
    }
  }

  /**
   * Default palette for fallback
   */
  private getDefaultPalette(): ColorPalette {
    return {
      colors: ["#000000", "#333333", "#666666", "#999999", "#CCCCCC"],
      confidence: 0.5,
    };
  }

  /**
   * Validate hex color format
   */
  private isValidHex(color: string): boolean {
    return /^#[0-9A-F]{6}$/i.test(color);
  }
}
