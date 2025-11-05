import OpenAI from "openai";
import type { AudioAnalysis, MusicIdentification } from "@shared/schema";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ArtGenerationParams {
  audioAnalysis: AudioAnalysis;
  musicInfo?: MusicIdentification | null;
  styles: string[];
  artists: string[];
  previousVotes?: Array<{ prompt: string; vote: number }>;
}

interface ArtGenerationResult {
  prompt: string;
  explanation: string;
}

export async function generateArtPrompt(params: ArtGenerationParams): Promise<ArtGenerationResult> {
  const { audioAnalysis, musicInfo, styles, artists, previousVotes } = params;
  
  // Build context from user preferences
  const styleContext = styles.length > 0 
    ? `in the style of ${styles.join(", ")}` 
    : "in an abstract artistic style";
  
  const artistContext = artists.length > 0
    ? `inspired by ${artists.join(", ")}`
    : "";

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
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: `You are an expert art director creating prompts for DALL-E image generation. You deeply understand music, music videos, and visual culture across genres.

When music is identified, you MUST analyze it thoroughly before creating the prompt:

**GENRE VISUAL LANGUAGES:**
- Hip-Hop/Rap: Street photography, urban landscapes, neon cityscapes, graffiti culture, music video cinematography (wide angles, dramatic lighting), luxury aesthetics, street fashion, powerful poses, bold typography
- Rock: Concert energy, stage lighting, electric atmosphere, rebellion aesthetics, album cover art traditions
- Electronic/EDM: Synthwave visuals, digital glitches, vibrant neon, abstract patterns, futuristic elements
- Pop: Polished production, vibrant colors, fashion-forward, editorial photography
- Jazz: Smoky atmospheres, vintage aesthetics, intimate club settings, noir influences
- Classical: Grand concert halls, dramatic shadows, timeless elegance, flowing movements

**OUTPUT FORMAT (REQUIRED):**

SONG INSIGHT:
[If music identified: First line must be "GENRE: [genre]" (e.g., "GENRE: Hip-Hop" or "GENRE: Rock"). Then analyze the specific song's music video aesthetic (if you know it exists), lyrical themes, emotional tone, and cultural context. If music video doesn't exist, imaginatively reconstruct what it might look like based on the artist's style and the song's themes. If no music: Note "GENRE: Unknown" and describe audio mood]

VISUAL LANGUAGE:
[Translate the music/audio into specific visual elements: color palettes, composition style, lighting, mood, cultural references, artistic techniques]

FINAL PROMPT:
[Concise DALL-E prompt under 400 characters incorporating all above insights]`
        },
        {
          role: "user",
          content: `Create artwork ${styleContext} ${artistContext}. ${musicContext}
          
${audioDescription}

${voteContext}

${musicInfo ? `Deeply analyze "${musicInfo.title}" by ${musicInfo.artist}. Consider:
- Music video aesthetic (if one exists, or imagine what it would look like)
- Lyrical themes and emotional content
- Genre-specific visual culture
- The artist's creative visual identity` : "Translate the audio mood into visual art"}

Provide structured output with SONG INSIGHT, VISUAL LANGUAGE, and FINAL PROMPT sections.`
        }
      ],
    });

    const fullResponse = response.choices[0].message.content || "";
    
    // Parse structured response - accept markdown variants (##, **, etc.)
    const finalPromptMatch = fullResponse.match(/(?:#+\s*)?(?:\*\*)?FINAL PROMPT:?\*?\*?\s*\n?([\s\S]+?)(?:\n\n|$)/i);
    const songInsightMatch = fullResponse.match(/(?:#+\s*)?(?:\*\*)?SONG INSIGHT:?\*?\*?\s*\n?([\s\S]+?)(?=\n\n(?:#+\s*)?(?:\*\*)?VISUAL LANGUAGE:|$)/i);
    const visualLanguageMatch = fullResponse.match(/(?:#+\s*)?(?:\*\*)?VISUAL LANGUAGE:?\*?\*?\s*\n?([\s\S]+?)(?=\n\n(?:#+\s*)?(?:\*\*)?FINAL PROMPT:|$)/i);
    
    let artPrompt = finalPromptMatch?.[1]?.trim() || "";
    const songInsight = songInsightMatch?.[1]?.trim() || "";
    const visualLanguage = visualLanguageMatch?.[1]?.trim() || "";
    
    // Validate and clean the final prompt
    if (!artPrompt) {
      console.warn("GPT-5 response missing FINAL PROMPT section, using fallback parsing");
      // Try to extract last meaningful line as fallback
      const lines = fullResponse.split('\n').filter(l => l.trim().length > 20);
      artPrompt = lines[lines.length - 1]?.trim() || "";
    }
    
    // Enforce prompt constraints for DALL-E
    if (artPrompt.length > 400) {
      console.warn(`FINAL PROMPT too long (${artPrompt.length} chars), truncating to 400`);
      artPrompt = artPrompt.substring(0, 397) + "...";
    }
    
    // Final fallback if still empty
    if (!artPrompt || artPrompt.length < 10) {
      console.error("Could not parse valid prompt from GPT-5, using genre-aware fallback");
      artPrompt = `${moodMapping[audioAnalysis.mood]}, ${styleContext} ${artistContext}, dreamlike artistic composition`;
    }
    
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
    if (musicInfo && songInsight && visualLanguage) {
      // Use the rich analysis we already have from the first GPT call
      explanation = `${musicInfo.title} by ${musicInfo.artist}: ${visualLanguage}`;
    } else if (songInsight && visualLanguage) {
      explanation = visualLanguage;
    } else {
      // Fallback explanation
      explanation = musicInfo 
        ? `Inspired by "${musicInfo.title}" by ${musicInfo.artist}, this artwork captures the ${audioAnalysis.mood} essence of the music.`
        : `This artwork reflects the ${audioAnalysis.mood} mood detected in the audio, expressed through ${styleContext}.`;
    }

    return { prompt: artPrompt, explanation };
  } catch (error) {
    console.error("Error generating art prompt:", error);
    // Fallback prompt and explanation based on audio mood
    const fallbackPrompt = `${moodMapping[audioAnalysis.mood]}, ${styleContext} ${artistContext}, dreamlike artistic composition`;
    const fallbackExplanation = musicInfo 
      ? `Inspired by "${musicInfo.title}" by ${musicInfo.artist}, this artwork captures the ${audioAnalysis.mood} essence of the music.`
      : `This artwork reflects the ${audioAnalysis.mood} mood detected in the audio, expressed through ${styleContext}.`;
    
    return { prompt: fallbackPrompt, explanation: fallbackExplanation };
  }
}

export async function generateArtImage(prompt: string): Promise<string> {
  try {
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
    });

    return response.data?.[0]?.url || "";
  } catch (error) {
    console.error("Error generating art image:", error);
    throw new Error("Failed to generate artwork");
  }
}
