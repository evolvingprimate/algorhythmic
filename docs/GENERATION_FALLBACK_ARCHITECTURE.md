# Generation Fallback Architecture - Implementation Spec
**Algorhythmic Platform**  
**Date**: November 10, 2025  
**Status**: APPROVED BY GROK AI (100% Confidence)  
**Implementation**: Proposal 1 - Contextual State Machine

---

## Executive Summary

**Problem**: Generation pipeline halts when ACRCloud music identification fails, leaving users with exhausted pool and no fresh artwork.

**Solution**: 3-tier fallback system with guaranteed generation in <2s:
1. **MUSIC_ID** (1.5s timeout): ACRCloud + Spotify metadata
2. **AUDIO_ONLY** (0.5s timeout): Web Audio API analysis (frequency, tempo, mood)
3. **STYLE_ONLY** (guaranteed): User style preferences + voting history

**Result**: 100% generation success rate, preserves auto-mode intelligence, invisible to users.

---

## Architecture Overview

### GenerationContext Interface
```typescript
interface GenerationContext {
  provenance: 'MUSIC_ID' | 'AUDIO_ONLY' | 'STYLE_ONLY';
  
  // Tier 1: Music Identification (ACRCloud success)
  musicInfo?: {
    title: string;
    artist: string;
    album?: string;
    albumArtworkUrl?: string;
    genre?: string;
  };
  
  // Tier 2: Audio Analysis (ACRCloud failed, audio available)
  audioAnalysis?: {
    tempo: number;
    dominantFrequency: number;
    amplitude: number;
    spectralCentroid: number;
    mood: 'energetic' | 'calm' | 'melancholic' | 'upbeat' | 'neutral';
  };
  
  // Tier 3: Style Preferences (both failed)
  stylePreferences: {
    styles: string[];
    autoGenerate: boolean;
    votingHistory?: {
      upvoted: string[];
      downvoted: string[];
    };
  };
  
  timestamp: Date;
}
```

### Sequential Fallback Flow
```
┌─────────────────────────────────────────────────────────┐
│ generateWithFallback(userId, audioBuffer)               │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │ Tier 1: Try ACRCloud (1.5s)    │
        │ identifyMusic(audioBuffer)      │
        └────────────────────────────────┘
                         │
                ┌────────┴────────┐
                │ Success?        │
                └─────────────────┘
            YES │            │ NO (timeout or null)
                ▼            ▼
        ┌────────────┐  ┌─────────────────────────────┐
        │ MUSIC_ID   │  │ Tier 2: Try Audio (0.5s)   │
        │ Return     │  │ analyzeAudioFeatures()      │
        └────────────┘  └─────────────────────────────┘
                                   │
                          ┌────────┴────────┐
                          │ Sufficient?     │
                          └─────────────────┘
                      YES │            │ NO (low confidence)
                          ▼            ▼
                  ┌──────────────┐  ┌─────────────────────────┐
                  │ AUDIO_ONLY   │  │ Tier 3: Style Only      │
                  │ Return       │  │ getStylePreferences()   │
                  └──────────────┘  └─────────────────────────┘
                                              │
                                              ▼
                                    ┌──────────────────────┐
                                    │ STYLE_ONLY (GUARANTEED) │
                                    │ Always succeeds      │
                                    └──────────────────────┘
```

---

## Implementation Specifications

### 1. Fallback Orchestrator

**File**: `server/generation/fallbackOrchestrator.ts`

```typescript
import { identifyMusic } from "../music-service";
import { analyzeAudioFeatures } from "../audio-analyzer";
import { storage } from "../storage";
import type { GenerationContext, AudioAnalysis, MusicIdentification } from "@shared/schema";

const ACRCLOUD_TIMEOUT_MS = 1500; // Grok's recommendation
const AUDIO_ANALYSIS_TIMEOUT_MS = 500; // Grok's recommendation
const GLOBAL_TIMEOUT_MS = 2000; // Guaranteed completion

export async function generateWithFallback(
  userId: string,
  audioBuffer?: Buffer
): Promise<GenerationContext> {
  
  // Get user preferences for fallback tier
  const preferences = await storage.getUserPreferences(userId);
  const stylePreferences = {
    styles: preferences?.styles || [],
    autoGenerate: preferences?.dynamicMode || false,
  };
  
  // Default context (Tier 3 fallback)
  let context: GenerationContext = {
    provenance: 'STYLE_ONLY',
    stylePreferences,
    timestamp: new Date(),
  };
  
  // Wrap entire flow in global timeout
  try {
    await Promise.race([
      (async () => {
        // Tier 1: Try ACRCloud (1.5s timeout)
        if (audioBuffer) {
          try {
            console.log('[Fallback] Tier 1: Attempting ACRCloud identification...');
            const musicInfo = await Promise.race([
              identifyMusic(audioBuffer),
              timeout(ACRCLOUD_TIMEOUT_MS, 'ACRCloud timeout'),
            ]);
            
            if (musicInfo) {
              console.log('[Fallback] ✅ Tier 1 SUCCESS: Music identified');
              context = {
                provenance: 'MUSIC_ID',
                musicInfo,
                stylePreferences,
                timestamp: new Date(),
              };
              return; // Exit early with MUSIC_ID
            }
            console.log('[Fallback] Tier 1 failed: No music match');
          } catch (e) {
            console.log('[Fallback] Tier 1 timeout/error:', e);
          }
          
          // Tier 2: Try Audio Analysis (0.5s timeout)
          try {
            console.log('[Fallback] Tier 2: Attempting audio feature analysis...');
            const audioAnalysis = await Promise.race([
              analyzeAudioFeatures(audioBuffer),
              timeout(AUDIO_ANALYSIS_TIMEOUT_MS, 'Audio analysis timeout'),
            ]);
            
            // Check if analysis has sufficient confidence
            if (audioAnalysis && audioAnalysis.confidence > 0.6) {
              console.log('[Fallback] ✅ Tier 2 SUCCESS: Audio analysis sufficient');
              context = {
                provenance: 'AUDIO_ONLY',
                audioAnalysis,
                stylePreferences,
                timestamp: new Date(),
              };
              return; // Exit with AUDIO_ONLY
            }
            console.log('[Fallback] Tier 2 failed: Low confidence audio analysis');
          } catch (e) {
            console.log('[Fallback] Tier 2 timeout/error:', e);
          }
        }
        
        // Tier 3: Guaranteed fallback to style preferences
        console.log('[Fallback] ⚠️ Tier 3 ACTIVATED: Using style preferences only');
        
        // Enhance with voting history if available
        const votes = await storage.getVotesByUser(userId);
        if (votes && votes.length > 0) {
          const upvoted = votes.filter(v => v.vote > 0).map(v => v.artPrompt);
          const downvoted = votes.filter(v => v.vote < 0).map(v => v.artPrompt);
          context.stylePreferences.votingHistory = { upvoted, downvoted };
          console.log('[Fallback] Enhanced STYLE_ONLY with voting history');
        }
      })(),
      timeout(GLOBAL_TIMEOUT_MS, 'Global generation timeout'),
    ]);
  } catch (e) {
    // Global timeout - ensure we return STYLE_ONLY
    console.warn('[Fallback] Global timeout reached, forcing STYLE_ONLY');
  }
  
  // Log telemetry
  console.log(`[Fallback] 📊 Final provenance: ${context.provenance}`);
  return context;
}

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => 
    setTimeout(() => reject(new Error(message)), ms)
  );
}
```

### 2. Auto-Mode Resolution

**Function**: `resolveAutoMode(context: GenerationContext): string[]`

```typescript
export function resolveAutoMode(context: GenerationContext): string[] {
  const { autoGenerate, styles } = context.stylePreferences;
  
  // If user manually selected styles, use them directly
  if (!autoGenerate) {
    console.log('[AutoMode] Manual mode: Using user-selected styles');
    return styles.length > 0 ? styles : ['abstract', 'surreal'];
  }
  
  // Auto-mode active - infer styles based on provenance
  console.log('[AutoMode] Auto mode active, inferring from context...');
  
  switch (context.provenance) {
    case 'MUSIC_ID':
      return inferStyleFromMusic(context.musicInfo!);
    
    case 'AUDIO_ONLY':
      return inferStyleFromAudio(context.audioAnalysis!);
    
    case 'STYLE_ONLY':
      // Use voting history or balanced eclectic mix
      if (context.stylePreferences.votingHistory) {
        return inferStyleFromVotes(context.stylePreferences.votingHistory);
      }
      // Last resort: balanced eclectic mix (Grok's recommendation)
      console.log('[AutoMode] No voting history, using eclectic mix');
      return ['abstract', 'surreal', 'impressionist', 'digital'];
  }
}

function inferStyleFromMusic(musicInfo: any): string[] {
  // Genre-to-style mapping (simplified)
  const genre = musicInfo.genre?.toLowerCase() || '';
  if (genre.includes('jazz')) return ['impressionist', 'abstract'];
  if (genre.includes('classical')) return ['renaissance', 'baroque'];
  if (genre.includes('electronic')) return ['digital', 'cyberpunk'];
  if (genre.includes('rock')) return ['pop-art', 'graffiti'];
  return ['abstract', 'surreal']; // Default
}

function inferStyleFromAudio(audio: any): string[] {
  const { tempo, mood } = audio;
  if (tempo > 140) return ['digital', 'cyberpunk']; // Fast/energetic
  if (tempo < 80) return ['impressionist', 'minimalist']; // Slow/calm
  if (mood === 'energetic') return ['pop-art', 'digital'];
  if (mood === 'calm') return ['impressionist', 'watercolor'];
  return ['abstract', 'surreal']; // Default
}

function inferStyleFromVotes(history: any): string[] {
  // Analyze upvoted prompts for style keywords
  const upvoted = history.upvoted.join(' ').toLowerCase();
  const styles = [];
  if (upvoted.includes('surreal')) styles.push('surreal');
  if (upvoted.includes('abstract')) styles.push('abstract');
  if (upvoted.includes('digital')) styles.push('digital');
  return styles.length > 0 ? styles : ['abstract', 'surreal'];
}
```

### 3. Context-Aware Prompt Builder

**Function**: `buildContextualPrompt(context: GenerationContext, styles: string[]): string`

```typescript
export function buildContextualPrompt(
  context: GenerationContext,
  styles: string[]
): string {
  let basePrompt = `Create artwork in ${styles.join(', ')} style. `;
  
  // Add context-specific details
  switch (context.provenance) {
    case 'MUSIC_ID':
      const { title, artist, album } = context.musicInfo!;
      basePrompt += `Inspired by "${title}" by ${artist}. `;
      if (album) basePrompt += `Album: ${album}. `;
      basePrompt += `Visual themes drawn from the song's mood and album artwork aesthetic. `;
      break;
    
    case 'AUDIO_ONLY':
      const { tempo, mood } = context.audioAnalysis!;
      basePrompt += `Audio characteristics: ${mood} mood, ${tempo} BPM tempo. `;
      basePrompt += `Energy level and visual dynamics reflect the audio intensity. `;
      break;
    
    case 'STYLE_ONLY':
      basePrompt += `Pure artistic interpretation focused on aesthetic coherence. `;
      // Add randomness to avoid blandness (Grok's feedback)
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
      
      // Use voting history for personalization if available
      if (context.stylePreferences.votingHistory) {
        basePrompt += `Incorporate elements from user's favorite artworks. `;
      }
      break;
  }
  
  return basePrompt;
}
```

### 4. Telemetry & Monitoring

**Logging Requirements**:
```typescript
// After each generation, log:
console.log(`[Telemetry] Generation complete:`, {
  provenance: context.provenance,
  timestamp: context.timestamp,
  userId,
  stylesUsed: resolvedStyles,
  hadMusicInfo: !!context.musicInfo,
  hadAudioAnalysis: !!context.audioAnalysis,
  usedVotingHistory: !!context.stylePreferences.votingHistory,
});

// Track fallback tier distribution
// Target: <30% STYLE_ONLY tier
```

**Metrics to Track**:
- Provenance distribution (MUSIC_ID vs AUDIO_ONLY vs STYLE_ONLY)
- Average time-to-generation per tier
- ACRCloud quota exhaustion events (status code 429)
- User satisfaction (voting patterns by provenance)

---

## Integration Points

### Updated /api/generate-art Endpoint
```typescript
app.post("/api/generate-art", isAuthenticated, async (req: any, res) => {
  const { audioBuffer, sessionId } = req.body;
  const userId = req.user.claims.sub;
  
  // NEW: Use fallback orchestrator
  const context = await generateWithFallback(userId, audioBuffer);
  
  // NEW: Resolve styles based on context
  const styles = resolveAutoMode(context);
  
  // NEW: Build context-aware prompt
  const promptText = buildContextualPrompt(context, styles);
  
  // EXISTING: Generate prompt with GPT-4o Vision
  const result = await generateArtPrompt({
    customPrompt: promptText,
    audioAnalysis: context.audioAnalysis || createDefaultAudioAnalysis(),
    musicInfo: context.musicInfo || null,
    styles,
    // ... other params
  });
  
  // EXISTING: Generate DALL-E image, store, save to DB
  // ... rest of existing flow
  
  // NEW: Log telemetry
  console.log(`[Telemetry] Provenance: ${context.provenance}`);
});
```

---

## Testing Requirements

### Unit Tests
1. **Tier 1 Success**: ACRCloud returns valid music → MUSIC_ID
2. **Tier 1 Timeout**: ACRCloud takes >1.5s → Falls to Tier 2
3. **Tier 2 Success**: Audio analysis confidence >0.6 → AUDIO_ONLY
4. **Tier 2 Fail**: Audio analysis confidence <0.6 → Falls to Tier 3
5. **Tier 3 Guaranteed**: No audio buffer → STYLE_ONLY with voting history

### Integration Tests
1. **Full Flow**: Mock ACRCloud failure → Verify AUDIO_ONLY context
2. **Global Timeout**: All tiers take >2s → Verify STYLE_ONLY fallback
3. **Auto-Mode Downgrade**: Test style inference from votes

### E2E Tests
1. **Real ACRCloud Fail**: Play music, trigger generation, verify fresh artwork
2. **Telemetry Validation**: Check logs show correct provenance
3. **Quality Check**: STYLE_ONLY art has randomness, not bland

---

## Success Criteria (from Grok)

✅ **100% generation success** in <2s max  
✅ **No halts, no old frames** (pool always replenished)  
✅ **Preserves auto-mode magic** via voting history  
✅ **Provenance tracking** for debugging (invisible to users)  
✅ **Fallback quality** with randomness in STYLE_ONLY  
✅ **Telemetry logging** shows tier distribution

---

## Deployment Checklist

- [ ] Create `server/generation/fallbackOrchestrator.ts`
- [ ] Create `server/generation/audioAnalyzer.ts` (stub for now)
- [ ] Define `GenerationContext` in `shared/schema.ts`
- [ ] Update `/api/generate-art` endpoint in `server/routes.ts`
- [ ] Add telemetry logging
- [ ] Write unit tests
- [ ] Run E2E smoke test
- [ ] Monitor fallback tier distribution in production
- [ ] Set up alert: STYLE_ONLY >70% = investigate ACRCloud

---

## Grok's Final Recommendations

1. **Timeout Values**: 1.5s ACR + 0.5s audio = 2s total (configurable via env vars)
2. **STYLE_ONLY Prompts**: Add randomness + voting history for quality
3. **Error Handling**: Wrap in `Promise.race` with global timeout
4. **Provenance UI**: Keep invisible (internal logging only)
5. **Auto-Mode**: Use voting history when audio unavailable
6. **ACRCloud Quota**: Monitor 429 status codes, add exponential backoff

---

**Status**: Ready for Implementation  
**Estimated Time**: 10-12 hours  
**Approval**: Grok AI (100% confidence)  
**Next**: Switch to Build mode and implement Task 2-10
