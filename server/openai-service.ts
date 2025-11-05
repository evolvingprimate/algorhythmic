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
[If music identified: Analyze the specific song's music video aesthetic (if you know it exists), lyrical themes, emotional tone, and cultural context. If music video doesn't exist, imaginatively reconstruct what it might look like based on the artist's style and the song's themes. If no music: Note genre from audio mood]

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
    
    // Parse structured response (using [\s\S] for cross-line matching instead of 's' flag)
    const finalPromptMatch = fullResponse.match(/FINAL PROMPT:\s*\n?([\s\S]+?)(?:\n\n|$)/);
    const songInsightMatch = fullResponse.match(/SONG INSIGHT:\s*\n?([\s\S]+?)(?=\n\nVISUAL LANGUAGE:|$)/);
    const visualLanguageMatch = fullResponse.match(/VISUAL LANGUAGE:\s*\n?([\s\S]+?)(?=\n\nFINAL PROMPT:|$)/);
    
    const artPrompt = finalPromptMatch?.[1]?.trim() || fullResponse.split('\n').pop()?.trim() || "Abstract dreamlike artwork with flowing colors and dynamic energy";
    const songInsight = songInsightMatch?.[1]?.trim() || "";
    const visualLanguage = visualLanguageMatch?.[1]?.trim() || "";

    // Generate explanation using the song insight
    const explanationResponse = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "You are an art curator explaining the creative choices behind AI-generated artwork. Be concise but insightful."
        },
        {
          role: "user",
          content: `Explain in 2-3 sentences why this specific artwork was created based on these inputs:
          
${musicInfo ? `Music: "${musicInfo.title}" by ${musicInfo.artist}` : "No specific music identified"}
${songInsight ? `\nSong Analysis: ${songInsight}` : ""}
${visualLanguage ? `\nVisual Approach: ${visualLanguage}` : ""}
Audio mood: ${audioAnalysis.mood}
User preferences: ${styleContext} ${artistContext}
Generated prompt: ${artPrompt}

${musicInfo ? "Explain how the song's music video aesthetic, lyrical themes, and genre influenced the visual artwork." : "Explain the creative connection between the audio mood and the visual artwork."}`
        }
      ],
    });

    const explanation = explanationResponse.choices[0].message.content || 
      `This artwork was inspired by ${musicInfo ? `"${musicInfo.title}" by ${musicInfo.artist}` : "the audio's"} ${audioAnalysis.mood} mood, translated into ${styleContext}.`;

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
