import { useEffect, useRef } from 'react';
import type { MorphEngine } from '@/lib/morphEngine';
import type { DNAFrame } from '@/lib/dna';
import type { ArtSession } from '@shared/schema';

interface StyleTransitionRequest {
  sessionId: string;
  styleTags: string[];
  audioMeta?: {
    tempo?: number;
    energy?: number;
    mood?: string;
  };
  trackId?: string;
}

interface CatalogBridgeResult {
  type: 'catalog';
  artwork: ArtSession;
  score?: number;
}

interface ProceduralBridgeResult {
  type: 'procedural';
}

type BridgeResult = CatalogBridgeResult | ProceduralBridgeResult;

interface StyleTransitionResponse {
  bridge: BridgeResult;
  latency: number;
}

interface DynamicModeControllerProps {
  sessionId: string;
  styleTags: string[];
  currentTrackId?: string | null;
  audioMeta?: {
    tempo?: number;
    energy?: number;
    mood?: string;
  };
  morphEngine: MorphEngine | null;
  onProceduralBridge?: () => void;
  onCatalogBridge?: (artwork: ArtSession) => void;
  onTransitionStart?: () => void;
  onTransitionComplete?: (type: 'catalog' | 'procedural', latency: number) => void;
}

export function DynamicModeController({
  sessionId,
  styleTags,
  currentTrackId,
  audioMeta,
  morphEngine,
  onProceduralBridge,
  onCatalogBridge,
  onTransitionStart,
  onTransitionComplete,
}: DynamicModeControllerProps) {
  const lastStyleTagsRef = useRef<string>('');
  const lastTrackIdRef = useRef<string | null>(null);
  const isTransitioningRef = useRef<boolean>(false);

  useEffect(() => {
    // CRITICAL: Check morphEngine FIRST before updating refs
    // This ensures effect re-runs when engine becomes available
    if (!morphEngine) {
      console.log('[DynamicMode] morphEngine not ready, will retry when available');
      return;
    }

    if (styleTags.length === 0) {
      console.log('[DynamicMode] No styleTags, skipping transition');
      return;
    }

    if (isTransitioningRef.current) {
      console.log('[DynamicMode] Transition already in progress, skipping');
      return;
    }

    const currentStyleKey = [...styleTags].sort().join(',');
    const isInitialRun = lastStyleTagsRef.current === '' && lastTrackIdRef.current === null;
    const hasStyleChanged = lastStyleTagsRef.current !== '' && currentStyleKey !== lastStyleTagsRef.current;
    const hasTrackChanged = lastTrackIdRef.current !== null && currentTrackId !== lastTrackIdRef.current;

    // Fire transition if: (1) initial run with style selected, OR (2) style/track changed
    const shouldTransition = isInitialRun || hasStyleChanged || hasTrackChanged;

    if (!shouldTransition) {
      lastStyleTagsRef.current = currentStyleKey;
      lastTrackIdRef.current = currentTrackId ?? null;
      return;
    }

    console.log(`[DynamicMode] 🎵 Transition trigger - Initial: ${isInitialRun}, StyleChanged: ${hasStyleChanged}, TrackChanged: ${hasTrackChanged}`);
    
    lastStyleTagsRef.current = currentStyleKey;
    lastTrackIdRef.current = currentTrackId ?? null;
    isTransitioningRef.current = true;

    onTransitionStart?.();

    const request: StyleTransitionRequest = {
      sessionId,
      styleTags,
      audioMeta,
      trackId: currentTrackId ?? undefined,
    };

    fetch('/api/style-transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(request),
    })
      .then(res => {
        if (!res.ok) {
          throw new Error(`Style transition failed: ${res.statusText}`);
        }
        return res.json() as Promise<StyleTransitionResponse>;
      })
      .then(data => {
        const { bridge, latency } = data;
        
        console.log(`[DynamicMode] ✅ Bridge response: ${bridge.type}, latency: ${latency}ms`);

        if (bridge.type === 'catalog' && bridge.artwork) {
          const catalogFrame: DNAFrame = {
            imageUrl: bridge.artwork.imageUrl,
            dnaVector: bridge.artwork.dnaVector 
              ? (JSON.parse(bridge.artwork.dnaVector) as number[])
              : Array(50).fill(0.5),
            artworkId: bridge.artwork.id,
            prompt: bridge.artwork.prompt || 'Catalog bridge',
            explanation: bridge.artwork.generationExplanation || 'Bridge from catalog',
            musicInfo: bridge.artwork.musicTrack 
              ? {
                  title: bridge.artwork.musicTrack,
                  artist: bridge.artwork.musicArtist,
                  album: bridge.artwork.musicAlbum
                }
              : null,
            audioAnalysis: bridge.artwork.audioFeatures 
              ? JSON.parse(bridge.artwork.audioFeatures)
              : null,
          };

          morphEngine.insertFrameAfterCurrent(catalogFrame);
          console.log(`[DynamicMode] 🎨 Catalog bridge inserted (score: ${bridge.score?.toFixed(2)})`);
          
          onCatalogBridge?.(bridge.artwork);
        } else {
          console.log('[DynamicMode] ⚠️ Procedural bridge (no catalog match)');
          onProceduralBridge?.();
        }

        onTransitionComplete?.(bridge.type, latency);
      })
      .catch(error => {
        console.error('[DynamicMode] Transition error:', error);
        onProceduralBridge?.();
        onTransitionComplete?.('procedural', 0);
      })
      .finally(() => {
        isTransitioningRef.current = false;
      });
  }, [styleTags, currentTrackId, sessionId, audioMeta, morphEngine, onProceduralBridge, onCatalogBridge, onTransitionStart, onTransitionComplete]);

  return null;
}
