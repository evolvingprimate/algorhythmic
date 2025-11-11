/**
 * Procedural Bridge Generator
 * 
 * Generates deterministic visual metadata (gradients, palettes) as Tier 3.5 fallback
 * when library artwork is unavailable. This provides instant visual feedback while
 * fresh generation happens in background.
 * 
 * Philosophy: Show *something* instantly rather than black screens.
 */

import { randomUUID } from "crypto";

export interface ProceduralBridgeData {
  type: 'gradient' | 'particles';
  palette: string[]; // Hex colors derived from style
  gradientParams?: {
    direction: number; // 0-360 degrees
    stops: Array<{ color: string; position: number }>; // 0-1
  };
  particleParams?: {
    count: number;
    speed: number;
    color: string;
  };
  styleHint: string; // Original style for context
}

/**
 * Style color palettes (curated for instant visual feedback)
 */
const stylePalettes: Record<string, string[]> = {
  // Dark & Moody
  "dark-fantasy": ["#1a0d1f", "#4a1942", "#7b2d5f", "#c04d8e"],
  "gothic": ["#0d0d0d", "#2d1b3a", "#4a2f52", "#8b5a7d"],
  "horror": ["#000000", "#1a0000", "#330000", "#660000"],
  "noir": ["#0a0a0a", "#1f1f1f", "#404040", "#808080"],
  "macabre": ["#1a0d0f", "#3d1f29", "#6b3447", "#a85872"],
  "dystopian": ["#1a1a1a", "#3a3a3a", "#5a5a5a", "#8a8a8a"],
  
  // Sci-Fi & Future
  "cyberpunk": ["#0d0221", "#511f73", "#ff006e", "#00f5ff"],
  "neon-noir": ["#0a0814", "#ff006e", "#00f5ff", "#8338ec"],
  "scifi": ["#0d1b2a", "#1b263b", "#415a77", "#778da9"],
  "holographic": ["#667eea", "#764ba2", "#f093fb", "#4facfe"],
  "retro-futurism": ["#ff6b35", "#f7931e", "#fdc500", "#c1d82f"],
  
  // Psychedelic & Dream
  "psychedelic": ["#ff006e", "#fb5607", "#ffbe0b", "#8338ec"],
  "abstract": ["#667eea", "#764ba2", "#f093fb", "#4facfe"],
  "surrealism": ["#8b2fc9", "#d946ef", "#fb7185", "#fbbf24"],
  
  // Nature & Realism
  "landscape": ["#134e4a", "#15803d", "#65a30d", "#fbbf24"],
  "botanical": ["#14532d", "#166534", "#16a34a", "#4ade80"],
  
  // Digital & Modern
  "glitch": ["#ff0080", "#00ff80", "#8000ff", "#ffff00"],
  "digital": ["#0ea5e9", "#06b6d4", "#14b8a6", "#10b981"],
  "vaporwave-dark": ["#ff71ce", "#01cdfe", "#05ffa1", "#b967ff"],
  
  // Default fallback
  "default": ["#667eea", "#764ba2", "#f093fb", "#4facfe"],
};

/**
 * Get color palette for a style
 */
function getPaletteForStyle(styleTags: string[]): string[] {
  // Try to find palette for first recognized style
  for (const style of styleTags) {
    if (style in stylePalettes) {
      return stylePalettes[style];
    }
  }
  
  // Fallback to default
  return stylePalettes.default;
}

/**
 * Generate deterministic gradient parameters from style tags
 */
function generateGradient(styleTags: string[]): ProceduralBridgeData {
  const palette = getPaletteForStyle(styleTags);
  
  // Deterministic direction based on style name hash
  const styleHash = styleTags.join('').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const direction = (styleHash % 360);
  
  // Create gradient stops from palette
  const stops = palette.map((color, index) => ({
    color,
    position: index / (palette.length - 1), // 0, 0.33, 0.66, 1.0
  }));
  
  return {
    type: 'gradient',
    palette,
    gradientParams: {
      direction,
      stops,
    },
    styleHint: styleTags[0] || 'abstract',
  };
}

/**
 * Generate procedural bridge data for given style tags
 * 
 * This provides instant visual feedback when no library artwork is available.
 * The frontend can render this as a gradient or particle system while waiting
 * for fresh generation.
 * 
 * @param styleTags User's selected styles
 * @param orientation Optional orientation hint
 * @returns Procedural bridge metadata for frontend rendering
 */
export function generateProceduralBridge(
  styleTags: string[],
  orientation?: string
): ProceduralBridgeData {
  // For now, always generate gradient (particles can be added later)
  return generateGradient(styleTags);
}

/**
 * Validate that procedural bridge data is well-formed
 */
export function validateProceduralBridge(data: ProceduralBridgeData): boolean {
  if (!data.type || !data.palette || data.palette.length === 0) {
    return false;
  }
  
  if (data.type === 'gradient' && data.gradientParams) {
    const { direction, stops } = data.gradientParams;
    if (direction < 0 || direction > 360) return false;
    if (!stops || stops.length === 0) return false;
    if (!stops.every(s => s.position >= 0 && s.position <= 1)) return false;
  }
  
  return true;
}
