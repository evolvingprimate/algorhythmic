/**
 * Validation script for style-relations.ts
 * Ensures all UI styles have relations and all references are valid
 */

import { styleRelations, validateStyleRelations } from '../shared/style-relations';

// Canonical style IDs from style-selector.tsx (as of 2025-11-11)
const canonicalStyles = [
  // CLASSIC MASTERS
  "surrealism", "impressionism", "cubism", "vangogh", "colorfield", "renaissance", "baroque", "pointillism",
  // MODERN DIGITAL
  "abstract", "digital", "8bit-pixel", "anime", "claymation", "vector", "lowpoly", "glitch",
  // DREAM & MIND
  "psychedelic", "italian-brain-rot", "cartoon", "expressionism", "opart", "fantasy", "optical-illusion", "minimalist",
  // REALISM & NATURE
  "realism", "photorealism", "landscape", "portrait", "wildlife", "stilllife", "hyperrealism", "botanical",
  // DARK & MOODY
  "horror", "gothic", "noir", "dark-fantasy", "vaporwave-dark", "steampunk-shadows", "dystopian", "macabre",
  // SCI-FI & FUTURE
  "scifi", "cyberpunk", "retro-futurism", "space-opera", "neon-noir", "biotech", "holographic", "apocalyptic",
  // SEASONAL & HOLIDAYS
  "halloween", "christmas", "newyear", "mlk", "presidents", "memorial", "juneteenth", "independence", "labor", "columbus", "veterans", "thanksgiving",
  "ramadan", "eid-fitr", "eid-adha", "diwali", "lunar-new-year", "vesak", "holi", "easter",
  // MEME CULTURE
  "nyancat", "distracted-bf", "this-is-fine", "expanding-brain", "doge", "pepe", "wojak", "rickroll",
];

console.log('🔍 Validating style relations map...\n');

// Run validation
const result = validateStyleRelations(canonicalStyles);

if (result.valid) {
  console.log('✅ All validations passed!');
  console.log(`   - ${Object.keys(styleRelations).length} styles mapped`);
  console.log(`   - ${canonicalStyles.length} canonical styles checked`);
} else {
  console.log('❌ Validation failed with errors:\n');
  result.errors.forEach(error => console.log(`   - ${error}`));
  process.exit(1);
}

// Check for missing styles
const mappedStyles = new Set(Object.keys(styleRelations));
const missingFromMap: string[] = [];

for (const style of canonicalStyles) {
  if (!mappedStyles.has(style)) {
    missingFromMap.push(style);
  }
}

if (missingFromMap.length > 0) {
  console.log('\n⚠️  Warning: Styles in UI but not in relations map:');
  missingFromMap.forEach(style => console.log(`   - ${style}`));
  process.exit(1);
}

console.log('\n✅ Coverage: 100% of UI styles have relations defined');
console.log('\n🎉 Style relations map is ready for production!');
