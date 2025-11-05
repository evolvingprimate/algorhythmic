import type { MusicIdentification } from "@shared/schema";

interface SpotifyAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SpotifyAlbumResponse {
  images: Array<{
    url: string;
    height: number;
    width: number;
  }>;
}

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getSpotifyAccessToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Spotify credentials not configured");
  }

  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`Spotify auth failed: ${response.statusText}`);
  }

  const data: SpotifyAuthResponse = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  
  return cachedToken;
}

export async function getAlbumArtwork(spotifyAlbumId: string): Promise<string | null> {
  try {
    const token = await getSpotifyAccessToken();
    
    const response = await fetch(`https://api.spotify.com/v1/albums/${spotifyAlbumId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.warn(`Spotify album lookup failed for ${spotifyAlbumId}: ${response.statusText}`);
      return null;
    }

    const data: SpotifyAlbumResponse = await response.json();
    
    // Return the largest image (first in array is usually largest)
    if (data.images && data.images.length > 0) {
      return data.images[0].url;
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching album artwork from Spotify:', error);
    return null;
  }
}
