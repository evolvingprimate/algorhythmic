/**
 * Style Relations Map
 * 
 * Defines adjacency relationships between artistic styles for the cascading fallback system.
 * When a user selects a style not in the library, we can show related styles instead.
 * 
 * Philosophy: Related styles should share visual or thematic qualities
 * - Visual: color palettes, textures, composition patterns
 * - Thematic: mood, subject matter, cultural context
 * 
 * Each style maps to 3-5 related styles for Tier 2 fallback.
 */

export type StyleRelations = Record<string, string[]>;

export const styleRelations: StyleRelations = {
  // CLASSIC MASTERS
  "surrealism": ["psychedelic", "abstract", "fantasy", "expressionism"],
  "impressionism": ["pointillism", "landscape", "colorfield", "vangogh"],
  "cubism": ["abstract", "opart", "optical-illusion", "minimalist"],
  "vangogh": ["impressionism", "expressionism", "psychedelic", "landscape"],
  "colorfield": ["abstract", "minimalist", "opart", "impressionism"],
  "renaissance": ["baroque", "portrait", "realism", "impressionism"],
  "baroque": ["renaissance", "gothic", "portrait", "realism"],
  "pointillism": ["impressionism", "opart", "abstract", "colorfield"],

  // MODERN DIGITAL
  "abstract": ["psychedelic", "colorfield", "surrealism", "minimalist"],
  "digital": ["cyberpunk", "glitch", "neon-noir", "holographic"],
  "8bit-pixel": ["glitch", "retro-futurism", "lowpoly", "vector"],
  "anime": ["cartoon", "fantasy", "digital", "vector"],
  "claymation": ["lowpoly", "cartoon", "minimalist", "vector"],
  "vector": ["lowpoly", "minimalist", "8bit-pixel", "digital"],
  "lowpoly": ["vector", "minimalist", "claymation", "digital"],
  "glitch": ["digital", "cyberpunk", "8bit-pixel", "dystopian"],

  // DREAM & MIND
  "psychedelic": ["abstract", "surrealism", "opart", "optical-illusion"],
  "italian-brain-rot": ["glitch", "psychedelic", "cartoon", "nyancat"],
  "cartoon": ["anime", "claymation", "8bit-pixel", "minimalist"],
  "expressionism": ["vangogh", "abstract", "psychedelic", "portrait"],
  "opart": ["optical-illusion", "psychedelic", "abstract", "cubism"],
  "fantasy": ["surrealism", "anime", "dark-fantasy", "scifi"],
  "optical-illusion": ["opart", "psychedelic", "abstract", "glitch"],
  "minimalist": ["vector", "lowpoly", "colorfield", "abstract"],

  // REALISM & NATURE
  "realism": ["photorealism", "hyperrealism", "portrait", "landscape"],
  "photorealism": ["hyperrealism", "realism", "portrait", "landscape"],
  "landscape": ["impressionism", "realism", "botanical", "wildlife"],
  "portrait": ["realism", "photorealism", "renaissance", "baroque"],
  "wildlife": ["landscape", "botanical", "realism", "photorealism"],
  "stilllife": ["realism", "botanical", "hyperrealism", "photorealism"],
  "hyperrealism": ["photorealism", "realism", "portrait", "stilllife"],
  "botanical": ["landscape", "wildlife", "stilllife", "impressionism"],

  // DARK & MOODY
  "horror": ["gothic", "dark-fantasy", "macabre", "halloween"],
  "gothic": ["dark-fantasy", "horror", "baroque", "noir"],
  "noir": ["neon-noir", "cyberpunk", "gothic", "dark-fantasy"],
  "dark-fantasy": ["gothic", "horror", "fantasy", "dystopian"],
  "vaporwave-dark": ["cyberpunk", "neon-noir", "retro-futurism", "dystopian"],
  "steampunk-shadows": ["dystopian", "gothic", "retro-futurism", "biotech"],
  "dystopian": ["cyberpunk", "apocalyptic", "dark-fantasy", "noir"],
  "macabre": ["horror", "gothic", "dark-fantasy", "halloween"],

  // SCI-FI & FUTURE
  "scifi": ["cyberpunk", "space-opera", "retro-futurism", "biotech"],
  "cyberpunk": ["neon-noir", "dystopian", "digital", "glitch"],
  "retro-futurism": ["scifi", "space-opera", "8bit-pixel", "vaporwave-dark"],
  "space-opera": ["scifi", "holographic", "retro-futurism", "fantasy"],
  "neon-noir": ["cyberpunk", "noir", "holographic", "vaporwave-dark"],
  "biotech": ["scifi", "holographic", "cyberpunk", "steampunk-shadows"],
  "holographic": ["biotech", "digital", "neon-noir", "space-opera"],
  "apocalyptic": ["dystopian", "horror", "cyberpunk", "dark-fantasy"],

  // SEASONAL & HOLIDAYS (group by theme/mood)
  "halloween": ["horror", "gothic", "macabre", "dark-fantasy"],
  "christmas": ["newyear", "thanksgiving", "easter", "landscape"],
  "newyear": ["christmas", "thanksgiving", "independence", "labor"],
  "mlk": ["juneteenth", "columbus", "memorial", "veterans"],
  "presidents": ["independence", "memorial", "veterans", "labor"],
  "memorial": ["veterans", "independence", "presidents", "mlk"],
  "juneteenth": ["mlk", "columbus", "memorial", "veterans"],
  "independence": ["presidents", "memorial", "veterans", "labor"],
  "labor": ["memorial", "veterans", "presidents", "thanksgiving"],
  "columbus": ["juneteenth", "thanksgiving", "memorial", "mlk"],
  "veterans": ["memorial", "independence", "presidents", "labor"],
  "thanksgiving": ["christmas", "newyear", "labor", "easter"],
  "ramadan": ["eid-fitr", "eid-adha", "diwali", "vesak"],
  "eid-fitr": ["ramadan", "eid-adha", "lunar-new-year", "diwali"],
  "eid-adha": ["ramadan", "eid-fitr", "diwali", "vesak"],
  "diwali": ["holi", "lunar-new-year", "vesak", "ramadan"],
  "lunar-new-year": ["diwali", "holi", "eid-fitr", "vesak"],
  "vesak": ["diwali", "ramadan", "eid-adha", "lunar-new-year"],
  "holi": ["diwali", "lunar-new-year", "easter", "vesak"],
  "easter": ["christmas", "thanksgiving", "newyear", "holi"],

  // MEME CULTURE (internet vibes)
  "nyancat": ["8bit-pixel", "italian-brain-rot", "cartoon", "glitch"],
  "distracted-bf": ["wojak", "pepe", "this-is-fine", "doge"],
  "this-is-fine": ["doge", "wojak", "distracted-bf", "pepe"],
  "expanding-brain": ["wojak", "pepe", "italian-brain-rot", "glitch"],
  "doge": ["pepe", "wojak", "nyancat", "this-is-fine"],
  "pepe": ["wojak", "doge", "distracted-bf", "expanding-brain"],
  "wojak": ["pepe", "doge", "this-is-fine", "expanding-brain"],
  "rickroll": ["nyancat", "8bit-pixel", "retro-futurism", "glitch"],
};

/**
 * Get related styles for a given style
 * @param style The style to find relations for
 * @returns Array of related style IDs (empty if no relations defined)
 */
export function getRelatedStyles(style: string): string[] {
  return styleRelations[style] || [];
}

/**
 * Expand a list of styles to include related styles
 * @param styles Array of style IDs to expand
 * @param maxRelated Maximum number of related styles to add per input style (default: all curated relations)
 * @returns Deduplicated array of original + related styles
 */
export function expandStyles(styles: string[], maxRelated?: number): string[] {
  const expanded = new Set<string>(styles);
  
  for (const style of styles) {
    const related = getRelatedStyles(style);
    const toAdd = maxRelated !== undefined ? related.slice(0, maxRelated) : related;
    toAdd.forEach(s => expanded.add(s));
  }
  
  return Array.from(expanded);
}

/**
 * Validate that all styles in the UI have at least 3 relations
 * and that all referenced styles actually exist
 * (Used for testing/validation)
 * 
 * @param canonicalStyles Optional array of valid style IDs from the UI
 */
export function validateStyleRelations(canonicalStyles?: string[]): { 
  valid: boolean; 
  errors: string[] 
} {
  const errors: string[] = [];
  const allStyleIds = new Set(Object.keys(styleRelations));
  
  // Check each style has enough relations
  for (const [style, relations] of Object.entries(styleRelations)) {
    if (relations.length < 3) {
      errors.push(`${style} has only ${relations.length} relations (minimum 3 required)`);
    }
    
    // If canonical list provided, verify all related styles exist
    if (canonicalStyles) {
      const canonicalSet = new Set(canonicalStyles);
      
      // Check if the style itself exists in canonical list
      if (!canonicalSet.has(style)) {
        errors.push(`${style} is not in canonical style list`);
      }
      
      // Check if all relations exist in canonical list
      for (const relatedStyle of relations) {
        if (!canonicalSet.has(relatedStyle)) {
          errors.push(`${style} references non-existent style: ${relatedStyle}`);
        }
      }
    } else {
      // Without canonical list, just check relations exist in the map
      for (const relatedStyle of relations) {
        if (!allStyleIds.has(relatedStyle)) {
          errors.push(`${style} references undefined style: ${relatedStyle}`);
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
