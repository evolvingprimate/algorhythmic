import type { MusicIdentification } from "@shared/schema";

interface AudDResponse {
  status: string;
  result: {
    artist: string;
    title: string;
    album?: string;
    release_date?: string;
    label?: string;
    timecode?: string;
    song_link?: string;
    apple_music?: {
      previews?: Array<{ url: string }>;
      url?: string;
    };
    spotify?: {
      album?: { id: string };
      id?: string;
    };
  } | null;
}

export async function identifyMusic(audioBlob: Buffer): Promise<MusicIdentification | null> {
  if (!process.env.AUDD_API_KEY) {
    console.warn("AUDD_API_KEY not configured - skipping music identification");
    return null;
  }

  try {
    console.log(`[Music ID] Attempting to identify music from ${audioBlob.length} byte audio sample`);
    
    const FormData = (await import("form-data")).default;
    const formData = new FormData();
    
    formData.append("api_token", process.env.AUDD_API_KEY);
    formData.append("file", audioBlob, {
      filename: "audio.mp3",
      contentType: "audio/mpeg",
    });
    formData.append("return", "apple_music,spotify");

    const response = await fetch("https://api.audd.io/", {
      method: "POST",
      body: formData as any,
      headers: formData.getHeaders(),
    });

    if (!response.ok) {
      console.error("[Music ID] AudD API error:", response.status, response.statusText);
      const errorText = await response.text();
      console.error("[Music ID] Error details:", errorText);
      return null;
    }

    const data = await response.json() as AudDResponse;
    console.log("[Music ID] AudD API response:", JSON.stringify(data, null, 2));

    if (data.status === "success" && data.result) {
      const result = data.result;
      console.log(`[Music ID] ✅ Successfully identified: ${result.artist} - ${result.title}`);
      return {
        title: result.title,
        artist: result.artist,
        album: result.album,
        release_date: result.release_date,
        label: result.label,
        timecode: result.timecode,
        song_link: result.song_link,
        apple_music: result.apple_music,
        spotify: result.spotify,
      };
    }

    console.log("[Music ID] ❌ No music identified (AudD returned null result)");
    return null;
  } catch (error) {
    console.error("[Music ID] Error identifying music:", error);
    return null;
  }
}

export function extractGenreFromMusicInfo(musicInfo: MusicIdentification | null): string | null {
  if (!musicInfo) return null;
  
  // Genre extraction would typically come from additional API calls
  // or be included in the AudD response with appropriate plan
  // For now, we'll use artist style as a proxy
  return null;
}
