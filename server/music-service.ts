import type { MusicIdentification } from "@shared/schema";

interface ACRCloudResponse {
  status: {
    msg: string;
    code: number;
    version: string;
  };
  metadata?: {
    played_duration: number;
    music?: Array<{
      title: string;
      artists?: Array<{ name: string }>;
      album?: { name: string };
      release_date?: string;
      label?: string;
      external_metadata?: {
        spotify?: { track?: { id: string }; album?: { id: string } };
        youtube?: { vid?: string };
      };
      external_ids?: {
        isrc?: string;
      };
      genres?: Array<{ name: string }>;
    }>;
    timestamp_utc: string;
  };
  result_type?: number;
}

export async function identifyMusic(audioBlob: Buffer): Promise<MusicIdentification | null> {
  const host = process.env.ACRCLOUD_HOST;
  const accessKey = process.env.ACRCLOUD_ACCESS_KEY;
  const accessSecret = process.env.ACRCLOUD_ACCESS_SECRET;

  if (!host || !accessKey || !accessSecret) {
    console.warn("ACRCloud credentials not configured - skipping music identification");
    return null;
  }

  try {
    console.log(`[Music ID] Attempting ACRCloud identification from ${audioBlob.length} byte audio sample`);
    
    // @ts-ignore - ACRCloud is a CommonJS module without proper ESM types
    const ACRCloudModule = await import("acrcloud");
    const ACRCloud = ACRCloudModule.default || ACRCloudModule;
    
    const acr = new ACRCloud({
      host,
      access_key: accessKey,
      access_secret: accessSecret,
    });

    const result = await acr.identify(audioBlob);
    const data = result as ACRCloudResponse;
    
    console.log("[Music ID] ACRCloud API response:", JSON.stringify(data, null, 2));

    if (data.status?.code === 0 && data.metadata?.music && data.metadata.music.length > 0) {
      const track = data.metadata.music[0];
      const artist = track.artists?.[0]?.name || "Unknown Artist";
      const title = track.title || "Unknown Track";
      
      console.log(`[Music ID] ✅ Successfully identified: ${artist} - ${title}`);
      
      return {
        title,
        artist,
        album: track.album?.name,
        release_date: track.release_date,
        label: track.label,
        song_link: track.external_metadata?.youtube?.vid 
          ? `https://youtube.com/watch?v=${track.external_metadata.youtube.vid}`
          : undefined,
        spotify: track.external_metadata?.spotify?.track?.id 
          ? { id: track.external_metadata.spotify.track.id }
          : undefined,
      };
    }

    console.log("[Music ID] ❌ No music identified (ACRCloud returned no matches)");
    if (data.status) {
      console.log(`[Music ID] Status: ${data.status.msg} (code: ${data.status.code})`);
    }
    return null;
  } catch (error) {
    console.error("[Music ID] Error identifying music with ACRCloud:", error);
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
