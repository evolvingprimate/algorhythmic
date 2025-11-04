import OpenAI from "openai";
import type { AudioAnalysis } from "@shared/schema";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ArtGenerationParams {
  audioAnalysis: AudioAnalysis;
  styles: string[];
  artists: string[];
  previousVotes?: Array<{ prompt: string; vote: number }>;
}

export async function generateArtPrompt(params: ArtGenerationParams): Promise<string> {
  const { audioAnalysis, styles, artists, previousVotes } = params;
  
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

  const audioDescription = `
Audio characteristics: 
- Mood: ${audioAnalysis.mood} (${moodMapping[audioAnalysis.mood]})
- Energy level: ${audioAnalysis.amplitude > 70 ? "high" : audioAnalysis.amplitude > 40 ? "medium" : "low"}
- Tempo: ${audioAnalysis.tempo > 140 ? "fast-paced" : audioAnalysis.tempo > 90 ? "moderate" : "slow"}
- Bass emphasis: ${audioAnalysis.bassLevel > 60 ? "strong" : "subtle"}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: "You are an expert art director creating prompts for DALL-E image generation. Create vivid, detailed prompts that translate audio characteristics into visual art. Focus on composition, color, mood, and artistic techniques. Keep prompts under 400 characters for optimal results."
        },
        {
          role: "user",
          content: `Create a detailed DALL-E prompt for generative artwork ${styleContext} ${artistContext}. 
          
${audioDescription}

${voteContext}

Generate a unique, captivating artwork prompt that captures the audio's essence while matching the user's artistic preferences. Focus on visual elements, composition, and artistic technique.`
        }
      ],
    });

    return response.choices[0].message.content || "Abstract dreamlike artwork with flowing colors and dynamic energy";
  } catch (error) {
    console.error("Error generating art prompt:", error);
    // Fallback prompt based on audio mood
    return `${moodMapping[audioAnalysis.mood]}, ${styleContext} ${artistContext}, dreamlike artistic composition`;
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

    return response.data[0].url || "";
  } catch (error) {
    console.error("Error generating art image:", error);
    throw new Error("Failed to generate artwork");
  }
}
