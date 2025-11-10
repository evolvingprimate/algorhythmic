/**
 * Catalogue Seed Configuration
 * Defines styles, moods, genres, and distribution logic for 1,400 library images
 */

export const GENRES = [
  "lofi", "ambient", "jazz", "rock", "hiphop",
  "classical", "edm", "pop", "world", "experimental"
] as const;

export const MOODS = [
  "calm", "melancholic", "dreamy", "energetic", "dark",
  "reflective", "playful", "aggressive", "uplifting", "mysterious"
] as const;

export const STYLES = {
  // Dual-native styles (40% - generate both portrait + landscape)
  dualNative: [
    "cyberpunk", "psychedelic", "space-opera", "vaporwave", "synthwave"
  ],
  
  // Square-master styles (45% - single 1:1 images)
  squareMaster: [
    "abstract", "ambient", "fractal", "minimal", "geometric"
  ],
  
  // Landscape-only styles (15% - single 16:9 images)
  landscapeOnly: [
    "experimental", "industrial", "glitch", "collage"
  ],
} as const;

export type Orientation = "landscape" | "portrait" | "square";
export type CatalogueTier = "dual" | "square" | "landscape";

export interface ImageSize {
  width: number;
  height: number;
  aspectRatio: string;
}

export const SIZES: Record<Orientation, ImageSize> = {
  landscape: { width: 1920, height: 1080, aspectRatio: "16:9" },
  portrait: { width: 1080, height: 1920, aspectRatio: "9:16" },
  square: { width: 1536, height: 1536, aspectRatio: "1:1" },
};

export interface DistributionConfig {
  totalArtworks: number;
  distribution: {
    dualNative: number;    // 40% - generates 2 files per concept
    squareMaster: number;  // 45% - generates 1 file per concept  
    landscapeOnly: number; // 15% - generates 1 file per concept
  };
}

export const DEFAULT_DISTRIBUTION: DistributionConfig = {
  totalArtworks: 1400,
  distribution: {
    dualNative: 0.40,   // 560 files (280 unique concepts × 2 orientations)
    squareMaster: 0.45, // 630 files
    landscapeOnly: 0.15 // 210 files
  },
};

/**
 * Calculate exact file counts from distribution config
 */
export function calculateCounts(config: DistributionConfig = DEFAULT_DISTRIBUTION) {
  const { totalArtworks, distribution } = config;
  
  // Dual-native creates 2 files per concept
  const dualArtworks = Math.round((totalArtworks * distribution.dualNative) / 2);
  const dualFiles = dualArtworks * 2;
  
  // Square and landscape create 1 file per concept
  const squareFiles = Math.round(totalArtworks * distribution.squareMaster);
  const landscapeFiles = Math.round(totalArtworks * distribution.landscapeOnly);
  
  const totalFiles = dualFiles + squareFiles + landscapeFiles;
  
  return {
    dualArtworks,    // Unique concepts (each generates 2 files)
    dualFiles,       // Actual files (2× dualArtworks)
    squareFiles,
    landscapeFiles,
    totalFiles,
  };
}

/**
 * Orientation-aware prompt suffixes optimized for SDXL
 */
export const PROMPT_SUFFIXES: Record<Orientation, string> = {
  landscape: "wide cinematic framing, panoramic vista, rule of thirds, 16:9 aspect ratio, dramatic perspective, professional photography",
  portrait: "vertical composition, subject centered in upper third, tall perspective, 9:16 aspect ratio, portrait orientation, magazine cover style",
  square: "balanced central composition, safe subject in middle 60%, 1:1 aspect ratio, symmetrical margins, Instagram-ready format",
};

/**
 * Generate random style based on tier
 */
export function pickStyle(tier: CatalogueTier): string {
  const styles = tier === "dual" ? STYLES.dualNative
    : tier === "square" ? STYLES.squareMaster
    : STYLES.landscapeOnly;
  
  return styles[Math.floor(Math.random() * styles.length)];
}

/**
 * Pick random genre and mood
 */
export function pickGenre() {
  return GENRES[Math.floor(Math.random() * GENRES.length)];
}

export function pickMood() {
  return MOODS[Math.floor(Math.random() * MOODS.length)];
}
