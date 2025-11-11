import OpenAI from "openai";
import { nanoid } from "nanoid";
import { generationHealthService } from "./generation-health";
import type { AudioAnalysis, MusicIdentification } from "@shared/schema";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper function to clamp DNA values to 0-3 range
function clampDNA(value: number): number {
  return Math.max(0, Math.min(3, value));
}

// Helper function to generate fallback DNA vector based on audio analysis
function generateFallbackDNA(audioAnalysis: AudioAnalysis, musicInfo: MusicIdentification | null, styleContext: string): number[] {
  const dna: number[] = [];
  
  // Points 1-12: Color & Palette (based on mood and audio characteristics)
  const moodColorMap: Record<string, number[]> = {
    energetic: [0.9, 0.8, 0.5, 1.5, 1.8, 0.7, 0.6, 0.8, 1.5, 0.6, 1.7, 1.9], // vibrant, high saturation
    calm: [0.4, 0.3, 0.7, 0.5, 0.4, 0.9, 0.8, 0.6, 0.8, 0.3, 0.9, 0.6], // soft pastels, low saturation
    dramatic: [0.2, 0.9, 0.3, 1.9, 1.2, 0.4, 0.5, 0.4, 1.7, 0.8, 1.5, 1.6], // intense contrasts
    playful: [0.7, 0.9, 0.6, 1.2, 1.9, 0.8, 0.7, 0.9, 1.4, 0.7, 1.6, 1.8], // bright, joyful
    melancholic: [0.3, 0.5, 0.4, 0.8, 0.6, 0.7, 0.6, 0.5, 1.0, 0.5, 1.2, 0.9], // muted tones
  };
  dna.push(...(moodColorMap[audioAnalysis.mood] || moodColorMap.calm).map(clampDNA));
  
  // Points 13-24: Texture & Style (based on bass level and frequency)
  const bassIntensity = Math.min(audioAnalysis.bassLevel / 100, 1);
  const trebleIntensity = Math.min(audioAnalysis.trebleLevel / 100, 1);
  dna.push(
    clampDNA(0.5 + bassIntensity * 0.5), // smoothness
    clampDNA(trebleIntensity * 2 + 0.5), // fractal_depth
    clampDNA(bassIntensity * 0.7), // noise_type
    clampDNA(trebleIntensity * 1.5), // grain_intensity
    clampDNA(bassIntensity * 1.8), // impasto_thickness
    clampDNA(1 - bassIntensity * 0.5), // veil_transparency
    clampDNA(1 + trebleIntensity), // detail_level
    clampDNA(0.6 + trebleIntensity * 0.4), // edge_definition
    clampDNA(bassIntensity * 0.8), // surface_roughness
    clampDNA(trebleIntensity * 1.5), // pattern_density
    clampDNA(bassIntensity * 0.6 + 0.3), // texture_variation
    clampDNA(1 + bassIntensity * 0.7) // material_quality
  );
  
  // Points 25-34: Composition (moderate defaults)
  dna.push(...[0.5, 1.2, 0.6, 0.6, 1.5, 1.0, 0.7, 1.3, 0.6, 1.1].map(clampDNA));
  
  // Points 35-44: Mood & Semantics (based on audio mood and energy)
  const energy = Math.min(audioAnalysis.amplitude / 100, 1);
  dna.push(
    clampDNA(energy), // emotional_valence
    clampDNA(0.6), // abstraction
    clampDNA(musicInfo ? 0.7 : 0.3), // cultural_specificity
    clampDNA(0.5), // light_direction
    clampDNA(1 + energy), // atmosphere_density
    clampDNA(musicInfo ? 0.8 : 0.4), // narrative_strength
    clampDNA(0.5 + energy * 0.8), // surreal_factor
    clampDNA(bassIntensity * 0.7), // organic_vs_geometric
    clampDNA(0.5), // time_of_day
    clampDNA(energy * 1.5) // weather_intensity
  );
  
  // Points 45-50: Morph Controls (will be audio-reactive, set moderate defaults)
  dna.push(
    clampDNA(1.0 + bassIntensity * 0.5), // warp_elasticity
    clampDNA(0.8 + energy * 0.7), // particle_density
    clampDNA(0.8 + audioAnalysis.tempo / 200), // dissolve_speed
    clampDNA(0.6 + energy * 0.5), // echo_trail
    clampDNA(0.4 + trebleIntensity * 0.4), // boundary_fuzz
    clampDNA(1.0 + energy * 0.3) // reactivity_gain
  );
  
  return dna;
}

interface ArtGenerationParams {
  audioAnalysis: AudioAnalysis;
  musicInfo?: MusicIdentification | null;
  styles: string[];
  artists: string[];
  dynamicMode?: boolean;
  previousVotes?: Array<{ prompt: string; vote: number }>;
}

interface ArtGenerationResult {
  prompt: string;
  explanation: string;
  dnaVector: number[];
}

export async function generateArtPrompt(params: ArtGenerationParams): Promise<ArtGenerationResult> {
  const { audioAnalysis, musicInfo, styles, artists, dynamicMode = false, previousVotes } = params;
  
  // Build context from user preferences or use dynamic mode
  let styleContext: string;
  let artistContext: string;
  
  if (dynamicMode) {
    // In dynamic mode, let the AI choose the style based on genre and album artwork
    styleContext = "";
    artistContext = "";
  } else {
    // Manual mode: use user-selected styles
    styleContext = styles.length > 0 
      ? `in the style of ${styles.join(", ")}` 
      : "in an abstract artistic style";
    
    artistContext = artists.length > 0
      ? `inspired by ${artists.join(", ")}`
      : "";
  }

  // Analyze previous votes to understand preferences
  const likedPrompts = previousVotes?.filter(v => v.vote === 1).map(v => v.prompt) || [];
  const dislikedPrompts = previousVotes?.filter(v => v.vote === -1).map(v => v.prompt) || [];
  
  let voteContext = "";
  if (likedPrompts.length > 0) {
    voteContext += `The user enjoyed artworks with these themes: ${likedPrompts.slice(0, 3).join("; ")}. `;
  }
  if (dislikedPrompts.length > 0) {
    voteContext += `Avoid themes similar to: ${dislikedPrompts.slice(0, 2).join("; ")}. `;
  }

  // Map audio characteristics to visual elements
  const moodMapping: Record<string, string> = {
    energetic: "vibrant colors, dynamic movement, explosive energy",
    calm: "soft pastels, gentle flows, serene atmosphere",
    dramatic: "intense contrasts, bold shapes, powerful composition",
    playful: "bright colors, whimsical forms, joyful energy",
    melancholic: "muted tones, flowing shapes, emotional depth",
  };

  // Build music context if available
  let musicContext = "";
  let musicDescription = "";
  if (musicInfo) {
    musicContext = `The identified music is "${musicInfo.title}" by ${musicInfo.artist}${musicInfo.album ? ` from the album "${musicInfo.album}"` : ""}.`;
    musicDescription = `\n\nIdentified Music:\n- Track: "${musicInfo.title}"\n- Artist: ${musicInfo.artist}${musicInfo.album ? `\n- Album: "${musicInfo.album}"` : ""}`;
  }

  const audioDescription = `
Audio characteristics: 
- Mood: ${audioAnalysis.mood} (${moodMapping[audioAnalysis.mood]})
- Energy level: ${audioAnalysis.amplitude > 70 ? "high" : audioAnalysis.amplitude > 40 ? "medium" : "low"}
- Tempo: ${audioAnalysis.tempo > 140 ? "fast-paced" : audioAnalysis.tempo > 90 ? "moderate" : "slow"}
- Bass emphasis: ${audioAnalysis.bassLevel > 60 ? "strong" : "subtle"}${musicDescription}
`;

  try {
    // Build messages array - use vision model if album artwork is available
    const messages: any[] = [
      {
        role: "system",
        content: `You are an expert art director creating prompts for DALL-E image generation. You deeply understand music, music videos, visual culture across genres, and the artistic intentions behind songs.

When music is identified, you MUST analyze it thoroughly before creating the prompt:

**GENRE VISUAL LANGUAGES:**
- Hip-Hop/Rap: Street photography, urban landscapes, neon cityscapes, graffiti culture, music video cinematography (wide angles, dramatic lighting), luxury aesthetics, street fashion, powerful poses, bold typography
- Rock: Concert energy, stage lighting, electric atmosphere, rebellion aesthetics, album cover art traditions
- Electronic/EDM: Synthwave visuals, digital glitches, vibrant neon, abstract patterns, futuristic elements
- Pop: Polished production, vibrant colors, fashion-forward, editorial photography
- Jazz: Smoky atmospheres, vintage aesthetics, intimate club settings, noir influences
- Classical: Grand concert halls, dramatic shadows, timeless elegance, flowing movements

**ALBUM ARTWORK ANALYSIS (when provided):**
When an album cover image is provided, analyze it as an inspirational muse:
• Visual Style: Color palette, composition, typography, photography/illustration style
• Artistic Techniques: Painting style, digital art, photography, mixed media, graphic design elements
• Mood & Atmosphere: Emotional tone conveyed through visual choices
• Symbolic Elements: Key imagery, metaphors, cultural references
${dynamicMode 
  ? '• DYNAMIC MODE: Choose the artistic style (surrealism, impressionism, cubism, abstract, realism, cartoon, horror, kids, trippy, digital, etc.) that BEST MATCHES the genre and album artwork aesthetic. Let the music and album art naturally determine the visual style.'
  : '• Use these insights to inform the DALL-E prompt while respecting user\'s selected art styles'
}

**OUTPUT FORMAT (REQUIRED):**

ARTISTIC CONTEXT:
[For identified music ONLY: Concisely analyze (≤40 words each):
• Artist Intent: What was the artist trying to express? What inspired this song? (backstory, personal experience, social commentary, etc.)
• Lyrical Themes: Extract 2-3 dominant themes/motifs from lyrics (e.g., "struggle & triumph", "lost love & nostalgia", "freedom & rebellion")
• Visual Metaphors: Map lyrical themes to visual imagery (e.g., "chains breaking" → "shattered metal fragments", "rising from darkness" → "light piercing shadows")
${musicInfo?.albumArtworkUrl ? '• Album Art Style: Describe the original album artwork\'s visual aesthetic, color palette, and artistic approach' : ''}
${dynamicMode ? '• Chosen Art Style: Name the artistic style you\'re using and why it matches this music/genre/album art' : ''}]

SONG INSIGHT:
[If music identified: First line must be "GENRE: [genre]" (e.g., "GENRE: Hip-Hop" or "GENRE: Rock"). Then analyze the specific song's music video aesthetic (if you know it exists), emotional tone, and cultural context. If music video doesn't exist, imaginatively reconstruct what it might look like based on the artist's style and the song's themes. If no music: Note "GENRE: Unknown" and describe audio mood]

VISUAL LANGUAGE:
[Translate the music/audio AND lyrical themes into specific visual elements: color palettes, composition style, lighting, mood, cultural references, artistic techniques, symbolic imagery from lyrics${musicInfo?.albumArtworkUrl ? ', and references to the album artwork aesthetic' : ''}]

DNA VECTOR:
[Generate a 50-point DNA vector (floating point values 0.0-3.0) that encodes this artwork's visual genome for procedural morphing:
• Points 1-12 (Color & Palette): dominant_hue(0-1), saturation(0-1), warmth(0-1), contrast(0-2), vibrancy(0-2), gradient_flow(0-1), harmony(0-1), brightness(0-1), color_complexity(0-2), tint_shift(0-1), palette_range(0-2), chromatic_intensity(0-2)
• Points 13-24 (Texture & Style): smoothness(0-1), fractal_depth(0-3), noise_type(0-1), grain_intensity(0-2), impasto_thickness(0-2), veil_transparency(0-1), detail_level(0-2), edge_definition(0-1), surface_roughness(0-1), pattern_density(0-2), texture_variation(0-1), material_quality(0-2)
• Points 25-34 (Composition): symmetry(0-1), focal_point_strength(0-2), negative_space(0-1), golden_ratio(0-1), depth_layers(0-3), perspective_intensity(0-2), balance(0-1), visual_weight(0-2), rhythm(0-1), tension(0-2)
• Points 35-44 (Mood & Semantics): emotional_valence(0-1), abstraction(0-1), cultural_specificity(0-1), light_direction(0-1), atmosphere_density(0-2), narrative_strength(0-1), surreal_factor(0-2), organic_vs_geometric(0-1), time_of_day(0-1), weather_intensity(0-2)
• Points 45-50 (Morph Controls - will be audio-reactive): warp_elasticity(0.5-2), particle_density(0.3-2), dissolve_speed(0.5-1.5), echo_trail(0.3-1.5), boundary_fuzz(0.2-1), reactivity_gain(0.8-1.5)

Output as JSON array: [0.7, 0.85, 0.3, ...] with exactly 50 values]

FINAL PROMPT:
[Concise DALL-E prompt under 400 characters incorporating artist intent, lyrical themes${musicInfo?.albumArtworkUrl ? ', and album artwork inspiration' : ''}, and all above insights]`
      }
    ];

    // If album artwork is available, use vision-capable model with image
    if (musicInfo?.albumArtworkUrl) {
      const userPrompt = dynamicMode 
        ? `DYNAMIC MODE: Choose the artistic style that best matches the genre and album artwork. ${musicContext}
          
${audioDescription}

${voteContext}

Deeply analyze "${musicInfo.title}" by ${musicInfo.artist}. Consider:
- Artist's intention: What inspired this song? What was the artist trying to express?
- Lyrical meaning: Analyze the lyrics for dominant themes, motifs, symbolism, and emotional narrative
- Visual metaphors: Translate lyrical themes into visual imagery
- Music video aesthetic (if one exists, or imagine what it would look like)
- Genre-specific visual culture
- The artist's creative visual identity
- IMPORTANT: Analyze the provided album artwork and use it as an inspirational muse for color palette, artistic style, and visual aesthetic
- SELECT the artistic style (surrealism, impressionism, cubism, abstract, realism, cartoon, horror, kids, trippy, digital, etc.) that naturally fits the genre, mood, and album artwork

Provide structured output with ARTISTIC CONTEXT (including your chosen art style), SONG INSIGHT, VISUAL LANGUAGE, DNA VECTOR, and FINAL PROMPT sections.`
        : `Create artwork ${styleContext} ${artistContext}. ${musicContext}
          
${audioDescription}

${voteContext}

Deeply analyze "${musicInfo.title}" by ${musicInfo.artist}. Consider:
- Artist's intention: What inspired this song? What was the artist trying to express?
- Lyrical meaning: Analyze the lyrics for dominant themes, motifs, symbolism, and emotional narrative
- Visual metaphors: Translate lyrical themes into visual imagery
- Music video aesthetic (if one exists, or imagine what it would look like)
- Genre-specific visual culture
- The artist's creative visual identity
- IMPORTANT: Analyze the provided album artwork and use it as an inspirational muse for color palette, artistic style, and visual aesthetic

Provide structured output with ARTISTIC CONTEXT, SONG INSIGHT, VISUAL LANGUAGE, and FINAL PROMPT sections.`;
      
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: userPrompt
          },
          {
            type: "image_url",
            image_url: {
              url: musicInfo.albumArtworkUrl
            }
          }
        ]
      });
    } else {
      // No album artwork - text only
      const userPrompt = dynamicMode && musicInfo
        ? `DYNAMIC MODE: Choose the artistic style that best matches the music genre. ${musicContext}
          
${audioDescription}

${voteContext}

Deeply analyze "${musicInfo.title}" by ${musicInfo.artist}. Consider:
- Artist's intention: What inspired this song? What was the artist trying to express?
- Lyrical meaning: Analyze the lyrics for dominant themes, motifs, symbolism, and emotional narrative
- Visual metaphors: Translate lyrical themes into visual imagery
- Music video aesthetic (if one exists, or imagine what it would look like)
- Genre-specific visual culture
- The artist's creative visual identity
- SELECT the artistic style (surrealism, impressionism, cubism, abstract, realism, cartoon, horror, kids, trippy, digital, etc.) that naturally fits the genre and mood

Provide structured output with ARTISTIC CONTEXT (including your chosen art style), SONG INSIGHT, VISUAL LANGUAGE, DNA VECTOR, and FINAL PROMPT sections.`
        : `Create artwork ${styleContext} ${artistContext}. ${musicContext}
          
${audioDescription}

${voteContext}

${musicInfo ? `Deeply analyze "${musicInfo.title}" by ${musicInfo.artist}. Consider:
- Artist's intention: What inspired this song? What was the artist trying to express?
- Lyrical meaning: Analyze the lyrics for dominant themes, motifs, symbolism, and emotional narrative
- Visual metaphors: Translate lyrical themes into visual imagery
- Music video aesthetic (if one exists, or imagine what it would look like)
- Genre-specific visual culture
- The artist's creative visual identity

Provide structured output with ARTISTIC CONTEXT, SONG INSIGHT, VISUAL LANGUAGE, DNA VECTOR, and FINAL PROMPT sections.` : "Translate the audio mood into visual art. Provide structured output with SONG INSIGHT, VISUAL LANGUAGE, DNA VECTOR, and FINAL PROMPT sections."}`;
      
      messages.push({
        role: "user",
        content: userPrompt
      });
    }

    let response = await openai.chat.completions.create({
      model: musicInfo?.albumArtworkUrl ? "gpt-4o" : "gpt-5", // Use gpt-4o for vision, gpt-5 for text-only
      messages,
    });

    let fullResponse = response.choices[0].message.content || "";
    
    // CRITICAL: Detect GPT refusals (common when analyzing copyrighted album artwork)
    const refusalPatterns = [
      /I'm sorry,?\s+(?:but\s+)?I\s+can't\s+(?:assist|help|provide|comply)/i,
      /I\s+cannot\s+(?:help|assist|provide|comply)/i,
      /I'm\s+not\s+able\s+to/i,
      /I\s+don't\s+have\s+access/i,
      /against\s+(?:my\s+)?(?:policy|guidelines)/i,
      /I\s+apologize,?\s+but\s+I\s+(?:can't|cannot)/i,
      /I'm\s+afraid\s+I\s+(?:can't|cannot)/i,
      /I'm\s+unable\s+to/i,
      /I\s+can't\s+(?:help|provide|assist|comply)\s+with/i,
      /I\s+cannot\s+provide\s+that/i,
      /not\s+able\s+to\s+(?:analyze|provide|assist|help)/i,
    ];
    
    const isRefusal = refusalPatterns.some(pattern => pattern.test(fullResponse));
    
    if (isRefusal && musicInfo?.albumArtworkUrl) {
      console.warn("[GPT Vision] Detected refusal when analyzing album artwork, falling back to text-only generation");
      console.log("[GPT Vision] Refusal response:", fullResponse);
      
      // Retry WITHOUT album artwork (text-only mode using gpt-5)
      const textOnlyMessages: any[] = messages.filter(msg => {
        // Remove any messages containing image_url
        if (typeof msg.content === 'object' && Array.isArray(msg.content)) {
          return false;
        }
        return true;
      });
      
      // Add a clean text-only user prompt
      textOnlyMessages.push({
        role: "user",
        content: dynamicMode
          ? `DYNAMIC MODE: Choose the artistic style that best matches the genre. ${musicContext}

${audioDescription}

${voteContext}

Deeply analyze "${musicInfo.title}" by ${musicInfo.artist}. Consider:
- Artist's intention: What inspired this song? What was the artist trying to express?
- Lyrical meaning: Analyze the lyrics for dominant themes, motifs, symbolism, and emotional narrative
- Visual metaphors: Translate lyrical themes into visual imagery
- Music video aesthetic (if one exists, or imagine what it would look like)
- Genre-specific visual culture
- The artist's creative visual identity
- SELECT the artistic style (surrealism, impressionism, cubism, abstract, realism, cartoon, horror, kids, trippy, digital, etc.) that naturally fits the genre and mood

Provide structured output with ARTISTIC CONTEXT (including your chosen art style), SONG INSIGHT, VISUAL LANGUAGE, DNA VECTOR, and FINAL PROMPT sections.`
          : `Create artwork ${styleContext} ${artistContext}. ${musicContext}
          
${audioDescription}

${voteContext}

Deeply analyze "${musicInfo.title}" by ${musicInfo.artist}. Consider:
- Artist's intention: What inspired this song? What was the artist trying to express?
- Lyrical meaning: Analyze the lyrics for dominant themes, motifs, symbolism, and emotional narrative
- Visual metaphors: Translate lyrical themes into visual imagery
- Music video aesthetic (if one exists, or imagine what it would look like)
- Genre-specific visual culture
- The artist's creative visual identity

Provide structured output with ARTISTIC CONTEXT, SONG INSIGHT, VISUAL LANGUAGE, DNA VECTOR, and FINAL PROMPT sections.`
      });
      
      response = await openai.chat.completions.create({
        model: "gpt-5", // Use gpt-5 for text-only fallback
        messages: textOnlyMessages,
      });
      
      fullResponse = response.choices[0].message.content || "";
      console.log("[GPT Vision] Text-only fallback complete");
    }
    
    // Parse structured response - accept markdown variants (##, **, etc.)
    const artisticContextMatch = fullResponse.match(/(?:#+\s*)?(?:\*\*)?ARTISTIC CONTEXT:?\*?\*?\s*\n?([\s\S]+?)(?=\n\n(?:#+\s*)?(?:\*\*)?SONG INSIGHT:|$)/i);
    const songInsightMatch = fullResponse.match(/(?:#+\s*)?(?:\*\*)?SONG INSIGHT:?\*?\*?\s*\n?([\s\S]+?)(?=\n\n(?:#+\s*)?(?:\*\*)?VISUAL LANGUAGE:|$)/i);
    const visualLanguageMatch = fullResponse.match(/(?:#+\s*)?(?:\*\*)?VISUAL LANGUAGE:?\*?\*?\s*\n?([\s\S]+?)(?=\n\n(?:#+\s*)?(?:\*\*)?DNA VECTOR:|$)/i);
    const dnaVectorMatch = fullResponse.match(/(?:#+\s*)?(?:\*\*)?DNA VECTOR:?\*?\*?\s*\n?([\s\S]+?)(?=\n\n(?:#+\s*)?(?:\*\*)?FINAL PROMPT:|$)/i);
    const finalPromptMatch = fullResponse.match(/(?:#+\s*)?(?:\*\*)?FINAL PROMPT:?\*?\*?\s*\n?([\s\S]+?)(?:\n\n|$)/i);
    
    const artisticContext = artisticContextMatch?.[1]?.trim() || "";
    const songInsight = songInsightMatch?.[1]?.trim() || "";
    const visualLanguage = visualLanguageMatch?.[1]?.trim() || "";
    const dnaVectorRaw = dnaVectorMatch?.[1]?.trim() || "";
    let artPrompt = finalPromptMatch?.[1]?.trim() || "";
    
    // Parse DNA vector from JSON array in response
    let dnaVector: number[] = [];
    if (dnaVectorRaw) {
      try {
        // Extract JSON array - look for [...] pattern
        const jsonMatch = dnaVectorRaw.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          dnaVector = JSON.parse(jsonMatch[0]);
          // Validate we have exactly 50 points
          if (!Array.isArray(dnaVector) || dnaVector.length !== 50) {
            console.warn(`DNA vector has ${dnaVector.length} points, expected 50. Using fallback.`);
            dnaVector = [];
          } else {
            // Validate all values are numbers and clamp to 0-3 range
            const isValid = dnaVector.every(v => typeof v === 'number' && !isNaN(v));
            if (!isValid) {
              console.warn("[DNA] DNA vector contains invalid values. Using fallback.");
              dnaVector = [];
            } else {
              // Clamp all values to 0-3 range
              dnaVector = dnaVector.map(clampDNA);
              console.log(`[DNA] Successfully parsed and clamped 50-point DNA vector`);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to parse DNA vector from GPT response:", e);
      }
    }
    
    // Generate fallback DNA vector if parsing failed
    if (dnaVector.length === 0) {
      console.log("[DNA] Generating fallback DNA vector based on audio analysis");
      dnaVector = generateFallbackDNA(audioAnalysis, musicInfo || null, styleContext);
    }
    
    // Validate and clean the final prompt
    if (!artPrompt) {
      console.warn("GPT response missing FINAL PROMPT section");
      console.log("Full GPT response for debugging:", fullResponse);
      
      // Improved fallback: look for lines that seem like image prompts (not analysis text)
      const lines = fullResponse.split('\n').map(l => l.trim()).filter(l => l.length > 30 && l.length < 500);
      
      // Filter out lines that are clearly analysis (contain certain keywords)
      const analysisKeywords = ['artist', 'inspired', 'song', 'lyric', 'theme', 'genre:', 'context:', 'insight:', 'language:'];
      const potentialPrompts = lines.filter(line => {
        const lower = line.toLowerCase();
        return !analysisKeywords.some(keyword => lower.includes(keyword)) && 
               !line.startsWith('•') && 
               !line.startsWith('-') &&
               !line.match(/^[A-Z\s]+:$/); // Avoid section headers
      });
      
      artPrompt = potentialPrompts[potentialPrompts.length - 1] || "";
      
      if (artPrompt) {
        console.log("Using fallback prompt:", artPrompt);
      }
    }
    
    // Enforce prompt constraints for DALL-E
    if (artPrompt.length > 400) {
      console.warn(`FINAL PROMPT too long (${artPrompt.length} chars), truncating to 400`);
      artPrompt = artPrompt.substring(0, 397) + "...";
    }
    
    // Remove potentially unsafe content from prompt
    const unsafePatterns = [
      /\b(gun|weapon|violence|blood|death|kill|murder|war|fight)\b/gi,
      /\b(explicit|nsfw|nude|naked|sexual)\b/gi,
    ];
    
    let cleanedPrompt = artPrompt;
    unsafePatterns.forEach(pattern => {
      if (pattern.test(cleanedPrompt)) {
        console.warn(`Removing potentially unsafe content from prompt: ${pattern}`);
        cleanedPrompt = cleanedPrompt.replace(pattern, '');
      }
    });
    
    // Clean up extra spaces after removal
    cleanedPrompt = cleanedPrompt.replace(/\s+/g, ' ').trim();
    
    if (cleanedPrompt !== artPrompt && cleanedPrompt.length > 20) {
      console.log(`Sanitized prompt from "${artPrompt}" to "${cleanedPrompt}"`);
      artPrompt = cleanedPrompt;
    }
    
    // CRITICAL: Final safety check - ensure we're not sending a refusal string to DALL-E
    const finalRefusalCheck = refusalPatterns.some(pattern => pattern.test(artPrompt));
    if (finalRefusalCheck) {
      console.error("CRITICAL: Detected refusal pattern in final prompt, using safe fallback");
      console.log("Blocked prompt:", artPrompt);
      artPrompt = `${moodMapping[audioAnalysis.mood]}, ${styleContext} ${artistContext}, dreamlike artistic composition`;
    }
    
    // Final fallback if still empty or too short
    if (!artPrompt || artPrompt.length < 20) {
      console.error("Could not parse valid prompt, using safe genre-aware fallback");
      artPrompt = `${moodMapping[audioAnalysis.mood]}, ${styleContext} ${artistContext}, dreamlike artistic composition`;
    }
    
    console.log(`[Art Generation] Final DALL-E prompt (${artPrompt.length} chars): "${artPrompt}"`);

    
    // Extract genre from SONG INSIGHT and verify genre-specific cues
    if (musicInfo && artPrompt && songInsight) {
      const genreMatch = songInsight.match(/GENRE:\s*([^\n]+)/i);
      const genre = genreMatch?.[1]?.trim().toLowerCase() || "";
      
      const lowerPrompt = artPrompt.toLowerCase();
      
      // Verify hip-hop/rap tracks include expected visual cues
      if (genre.includes('hip-hop') || genre.includes('hip hop') || genre.includes('rap')) {
        const hasHipHopCues = lowerPrompt.includes('urban') || 
                              lowerPrompt.includes('street') || 
                              lowerPrompt.includes('graffiti') ||
                              lowerPrompt.includes('neon') ||
                              lowerPrompt.includes('city') ||
                              lowerPrompt.includes('music video');
        
        if (!hasHipHopCues) {
          console.warn(`Hip-hop track "${musicInfo.title}" by ${musicInfo.artist} missing expected visual cues (urban/street/graffiti/neon/city/music video) in prompt: ${artPrompt}`);
        }
      }
    }

    // Build explanation from existing insights (no second API call needed)
    let explanation = "";
    if (musicInfo && artisticContext) {
      // Use the rich artistic context analysis (artist intent + lyrical themes)
      explanation = `${musicInfo.title} by ${musicInfo.artist}: ${artisticContext}`;
    } else if (musicInfo && visualLanguage) {
      // Fall back to visual language if artistic context not available
      explanation = `${musicInfo.title} by ${musicInfo.artist}: ${visualLanguage}`;
    } else if (songInsight && visualLanguage) {
      explanation = visualLanguage;
    } else {
      // Fallback explanation
      explanation = musicInfo 
        ? `Inspired by "${musicInfo.title}" by ${musicInfo.artist}, this artwork captures the ${audioAnalysis.mood} essence of the music.`
        : `This artwork reflects the ${audioAnalysis.mood} mood detected in the audio, expressed through ${styleContext}.`;
    }

    return { prompt: artPrompt, explanation, dnaVector };
  } catch (error) {
    console.error("Error generating art prompt:", error);
    // Fallback prompt and explanation based on audio mood
    const fallbackPrompt = `${moodMapping[audioAnalysis.mood]}, ${styleContext} ${artistContext}, dreamlike artistic composition`;
    const fallbackExplanation = musicInfo 
      ? `Inspired by "${musicInfo.title}" by ${musicInfo.artist}, this artwork captures the ${audioAnalysis.mood} essence of the music.`
      : `This artwork reflects the ${audioAnalysis.mood} mood detected in the audio, expressed through ${styleContext}.`;
    const fallbackDNA = generateFallbackDNA(audioAnalysis, musicInfo || null, styleContext);
    
    return { prompt: fallbackPrompt, explanation: fallbackExplanation, dnaVector: fallbackDNA };
  }
}

// Import required modules (add these at the top of the file)
// import { generationHealthService } from './generation-health';
// import { nanoid } from 'nanoid';

// Custom error classes for generation failures
export class GenerationTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationTimeout';
  }
}

export class GenerationFailure extends Error {
  constructor(
    public reason: 'timeout' | 'error' | 'unavailable',
    public details: { idempotencyKey?: string; error?: Error } = {}
  ) {
    super(`Generation failed: ${reason}`);
    this.name = 'GenerationFailure';
  }
}

/**
 * Generate art image with timeout, circuit breaker, and retry logic
 * Based on recommendations from Grok and ChatGPT:
 * - Adaptive timeout (P95 * 1.25, clamped to 45-90s)
 * - AbortController for cancellable jobs
 * - Exponential backoff retry (15s, 30s)
 * - Circuit breaker integration
 */
export async function generateArtImage(
  prompt: string,
  options?: {
    isProbe?: boolean;
    retryCount?: number;
    skipTextDirective?: boolean;
  }
): Promise<string> {
  const jobId = nanoid();
  const isProbe = options?.isProbe || false;
  const retryCount = options?.retryCount || 0;
  const maxRetries = 2;
  
  // Feature flag for circuit breaker - allows safe rollback if needed
  const breakerEnabled = process.env.GEN_BREAKER_ENABLED !== 'false';
  
  // Check circuit breaker state (only if enabled)
  if (breakerEnabled && !generationHealthService.shouldAttemptGeneration()) {
    console.log(`[GenerationHealth] Circuit breaker open, skipping DALL-E generation`);
    throw new GenerationFailure('unavailable', { idempotencyKey: jobId });
  }
  
  // Register job with health service
  generationHealthService.registerJob(jobId, isProbe);
  
  // Get adaptive timeout
  const timeout = generationHealthService.getTimeout();
  console.log(`[GenerationHealth] Attempting DALL-E generation with ${timeout}ms timeout (job: ${jobId})`);
  
  // Add "no text" directive unless explicitly skipped (for probes)
  const enhancedPrompt = options?.skipTextDirective 
    ? prompt
    : `${prompt} IMPORTANT: absolutely no text, no letters, no words, no typography, no signage, pure abstract visual art only.`;
  
  const startTime = Date.now();
  
  // Create AbortController for proper request cancellation
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;
  let abortSignalFired = false;
  
  // Track when the abort signal is triggered
  controller.signal.addEventListener('abort', () => {
    abortSignalFired = true;
    console.log(`[GenerationHealth] ✅ AbortSignal fired for job ${jobId} - HTTP request being cancelled`);
  });
  
  try {
    // Create a promise that aborts the request after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        // Abort the actual HTTP request
        console.log(`[GenerationHealth] Aborting DALL-E request for job ${jobId} after ${timeout}ms`);
        controller.abort();
        reject(new GenerationTimeout(`DALL-E generation timeout after ${timeout}ms`));
      }, timeout);
    });
    
    // Race between DALL-E call (with AbortSignal) and timeout
    const response = await Promise.race([
      openai.images.generate({
        model: "dall-e-3",
        prompt: enhancedPrompt,
        n: 1,
        size: "1024x1024",
        quality: "standard", // Use standard quality for all (probes and regular)
      }, {
        // Pass AbortSignal in options for OpenAI v4+
        signal: controller.signal
      }),
      timeoutPromise
    ]);
    
    // Clear timeout timer to avoid stray rejections
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    // Record success with health service
    const latency = Date.now() - startTime;
    generationHealthService.recordSuccess(latency, jobId);
    
    console.log(`[GenerationHealth] DALL-E generation successful in ${latency}ms`);
    
    // Check if result is still valid (not expired)
    if (!generationHealthService.isJobValid(jobId)) {
      console.warn(`[GenerationHealth] Job ${jobId} completed but expired, dropping result`);
      throw new GenerationFailure('timeout', { idempotencyKey: jobId });
    }
    
    return response.data?.[0]?.url || "";
    
  } catch (error: any) {
    // Clear timeout timer if it hasn't fired yet
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    const latency = Date.now() - startTime;
    
    // Handle timeout error or abort error
    if (error instanceof GenerationTimeout || 
        error.name === 'AbortError' || 
        error.constructor?.name === 'APIUserAbortError') {
      const wasAborted = abortSignalFired || error.name === 'AbortError' || error.constructor?.name === 'APIUserAbortError';
      console.error(`[GenerationHealth] DALL-E generation ${wasAborted ? 'ABORTED' : 'TIMEOUT'} after ${latency}ms (job: ${jobId})`);
      if (wasAborted) {
        console.log(`[GenerationHealth] ✅ Request was properly cancelled via AbortController`);
      }
      generationHealthService.recordTimeout(jobId, 'timeout');
      
      // Retry with exponential backoff if we haven't exceeded retry limit
      if (retryCount < maxRetries) {
        const backoffMs = (retryCount === 0 ? 15000 : 30000); // 15s, then 30s
        console.log(`[GenerationHealth] Retrying in ${backoffMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        
        return generateArtImage(prompt, {
          ...options,
          retryCount: retryCount + 1
        });
      }
      
      throw new GenerationFailure('timeout', { idempotencyKey: jobId });
    }
    
    // Handle other errors (API errors, network issues, etc.)
    console.error(`[GenerationHealth] DALL-E generation error:`, error);
    generationHealthService.recordTimeout(jobId, 'error');
    
    // Check for transient errors that should be retried
    const isTransient = 
      error.status === 429 || // Rate limited
      error.status >= 500 || // Server errors
      error.code === 'ECONNRESET' || // Connection reset
      error.code === 'ETIMEDOUT' || // Network timeout
      error.message?.includes('network'); // Network issues
    
    if (isTransient && retryCount < maxRetries) {
      const backoffMs = (retryCount === 0 ? 15000 : 30000);
      console.log(`[GenerationHealth] Retrying transient error in ${backoffMs}ms`);
      
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      
      return generateArtImage(prompt, {
        ...options,
        retryCount: retryCount + 1
      });
    }
    
    throw new GenerationFailure('error', { 
      idempotencyKey: jobId,
      error 
    });
  }
}
