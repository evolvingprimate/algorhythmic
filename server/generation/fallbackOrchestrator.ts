import { identifyMusic } from "../music-service";
import { analyzeAudioFeatures } from "./audioAnalyzer";
import { storage } from "../storage";
import type { GenerationContext, AudioAnalysis, MusicIdentification } from "@shared/schema";

const ACRCLOUD_TIMEOUT_MS = 1500;
const AUDIO_ANALYSIS_TIMEOUT_MS = 500;
const GLOBAL_TIMEOUT_MS = 2000;

export async function generateWithFallback(
  userId: string,
  audioBuffer?: Buffer,
  sessionId?: string
): Promise<GenerationContext> {
  console.log('[Fallback] Starting generation with 3-tier fallback system...');
  
  const preferences = sessionId 
    ? await storage.getPreferencesBySession(sessionId)
    : undefined;
  const stylePreferences = {
    styles: preferences?.styles || [],
    autoGenerate: preferences?.dynamicMode || false,
  };
  
  let context: GenerationContext = {
    provenance: 'STYLE_ONLY',
    stylePreferences,
    timestamp: new Date(),
  };
  
  try {
    await Promise.race([
      (async () => {
        if (audioBuffer) {
          try {
            console.log('[Fallback] Tier 1: Attempting ACRCloud identification (1.5s timeout)...');
            const musicInfo = await Promise.race([
              identifyMusic(audioBuffer),
              timeout(ACRCLOUD_TIMEOUT_MS, 'ACRCloud timeout'),
            ]);
            
            if (musicInfo) {
              console.log('[Fallback] ✅ Tier 1 SUCCESS: Music identified -', musicInfo.title);
              context = {
                provenance: 'MUSIC_ID',
                musicInfo,
                stylePreferences,
                timestamp: new Date(),
              };
              return;
            }
            console.log('[Fallback] Tier 1 failed: No music match');
          } catch (e: any) {
            console.log('[Fallback] Tier 1 timeout/error:', e.message);
          }
          
          try {
            console.log('[Fallback] Tier 2: Attempting audio feature analysis (0.5s timeout)...');
            const audioAnalysis = await Promise.race([
              analyzeAudioFeatures(audioBuffer),
              timeout(AUDIO_ANALYSIS_TIMEOUT_MS, 'Audio analysis timeout'),
            ]);
            
            if (audioAnalysis && (audioAnalysis.confidence || 0) > 0.6) {
              console.log('[Fallback] ✅ Tier 2 SUCCESS: Audio analysis sufficient (confidence:', audioAnalysis.confidence, ')');
              context = {
                provenance: 'AUDIO_ONLY',
                audioAnalysis,
                stylePreferences,
                timestamp: new Date(),
              };
              return;
            }
            console.log('[Fallback] Tier 2 failed: Low confidence audio analysis');
          } catch (e: any) {
            console.log('[Fallback] Tier 2 timeout/error:', e.message);
          }
        }
        
        console.log('[Fallback] ⚠️ Tier 3 ACTIVATED: Using style preferences only');
        
        if (sessionId) {
          try {
            const votes = await storage.getVotesBySession(sessionId);
            if (votes && votes.length > 0) {
              const upvoted = votes.filter(v => v.vote > 0).map(v => v.artPrompt);
              const downvoted = votes.filter(v => v.vote < 0).map(v => v.artPrompt);
              context.stylePreferences.votingHistory = { upvoted, downvoted };
              console.log('[Fallback] Enhanced STYLE_ONLY with voting history:', upvoted.length, 'upvoted');
            }
          } catch (e) {
            console.warn('[Fallback] Could not fetch voting history:', e);
          }
        }
      })(),
      timeout(GLOBAL_TIMEOUT_MS, 'Global generation timeout'),
    ]);
  } catch (e) {
    console.warn('[Fallback] Global timeout reached, forcing STYLE_ONLY');
  }
  
  console.log(`[Fallback] 📊 Final provenance: ${context.provenance}`);
  logTelemetry(context, userId);
  
  return context;
}

export function resolveAutoMode(context: GenerationContext): string[] {
  const { autoGenerate, styles } = context.stylePreferences;
  
  if (!autoGenerate) {
    console.log('[AutoMode] Manual mode: Using user-selected styles');
    return styles.length > 0 ? styles : ['abstract', 'surreal'];
  }
  
  console.log('[AutoMode] Auto mode active, inferring from context...');
  
  switch (context.provenance) {
    case 'MUSIC_ID':
      return inferStyleFromMusic(context.musicInfo!);
    
    case 'AUDIO_ONLY':
      return inferStyleFromAudio(context.audioAnalysis!);
    
    case 'STYLE_ONLY':
      if (context.stylePreferences.votingHistory) {
        return inferStyleFromVotes(context.stylePreferences.votingHistory);
      }
      console.log('[AutoMode] No voting history, using eclectic mix');
      return ['abstract', 'surreal', 'impressionist', 'digital'];
  }
}

export function buildContextualPrompt(
  context: GenerationContext,
  styles: string[]
): string {
  let basePrompt = `Create artwork in ${styles.join(', ')} style. `;
  
  switch (context.provenance) {
    case 'MUSIC_ID':
      const { title, artist, album } = context.musicInfo!;
      basePrompt += `Inspired by "${title}" by ${artist}. `;
      if (album) basePrompt += `Album: ${album}. `;
      basePrompt += `Visual themes drawn from the song's mood and album artwork aesthetic. `;
      break;
    
    case 'AUDIO_ONLY':
      const { tempo, mood } = context.audioAnalysis!;
      basePrompt += `Audio characteristics: ${mood} mood, ${Math.round(tempo)} BPM tempo. `;
      basePrompt += `Energy level and visual dynamics reflect the audio intensity. `;
      break;
    
    case 'STYLE_ONLY':
      basePrompt += `Pure artistic interpretation focused on aesthetic coherence. `;
      const randomElements = [
        'dynamic composition',
        'bold color palette',
        'intricate details',
        'ethereal atmosphere',
        'striking contrast',
        'flowing movement',
      ];
      const randomElement = randomElements[Math.floor(Math.random() * randomElements.length)];
      basePrompt += `Emphasize ${randomElement}. `;
      
      if (context.stylePreferences.votingHistory) {
        basePrompt += `Incorporate elements from user's favorite artworks. `;
      }
      break;
  }
  
  return basePrompt;
}

function inferStyleFromMusic(musicInfo: MusicIdentification): string[] {
  const artist = musicInfo.artist.toLowerCase();
  const title = musicInfo.title.toLowerCase();
  
  if (artist.includes('bach') || artist.includes('mozart')) return ['baroque', 'classical'];
  if (artist.includes('pink floyd') || title.includes('psychedelic')) return ['surreal', 'psychedelic'];
  if (artist.includes('kraftwerk') || artist.includes('daft')) return ['digital', 'cyberpunk'];
  
  return ['abstract', 'surreal'];
}

function inferStyleFromAudio(audio: AudioAnalysis): string[] {
  const { tempo, mood } = audio;
  
  if (tempo > 140) return ['digital', 'cyberpunk'];
  if (tempo < 80) return ['impressionist', 'minimalist'];
  if (mood === 'energetic') return ['pop-art', 'digital'];
  if (mood === 'calm') return ['impressionist', 'watercolor'];
  if (mood === 'dramatic') return ['baroque', 'expressionist'];
  
  return ['abstract', 'surreal'];
}

function inferStyleFromVotes(history: { upvoted: string[], downvoted: string[] }): string[] {
  const upvoted = history.upvoted.join(' ').toLowerCase();
  const styles: string[] = [];
  
  if (upvoted.includes('surreal')) styles.push('surreal');
  if (upvoted.includes('abstract')) styles.push('abstract');
  if (upvoted.includes('digital')) styles.push('digital');
  if (upvoted.includes('impressionist')) styles.push('impressionist');
  if (upvoted.includes('cyberpunk')) styles.push('cyberpunk');
  
  return styles.length > 0 ? styles : ['abstract', 'surreal'];
}

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => 
    setTimeout(() => reject(new Error(message)), ms)
  );
}

function logTelemetry(context: GenerationContext, userId: string) {
  console.log(`[Telemetry] Generation complete:`, {
    provenance: context.provenance,
    timestamp: context.timestamp.toISOString(),
    userId,
    hadMusicInfo: !!context.musicInfo,
    hadAudioAnalysis: !!context.audioAnalysis,
    usedVotingHistory: !!context.stylePreferences.votingHistory,
    stylesCount: context.stylePreferences.styles.length,
  });
}
