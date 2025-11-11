import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  ThumbsUp, 
  ThumbsDown, 
  Settings, 
  Sparkles,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Heart,
  Info,
  Music,
  Brain,
  Clock,
  Zap,
  Bug,
  Palette
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StyleSelector } from "@/components/style-selector";
import { AudioSourceSelector } from "@/components/audio-source-selector";
import { DebugOverlay, type DebugStats } from "@/components/debug-overlay";
// EffectsControlMenu temporarily removed - requires MaestroControlStore/CommandBus refactor
// import { EffectsControlMenu } from "@/components/effects-control-menu";
import { useToast } from "@/hooks/use-toast";
import { useImpressionRecorder } from "@/hooks/useImpressionRecorder";
import { telemetryService } from "@/lib/maestro/telemetry/TelemetryService";
import { AudioAnalyzer } from "@/lib/audio-analyzer";
import { WebSocketClient } from "@/lib/websocket-client";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { MorphEngine } from "@/lib/morphEngine";
import { RendererManager } from "@/lib/RendererManager";
import { detectDeviceCapabilities } from "@/lib/deviceDetection";
import { parseDNAFromSession } from "@/lib/dna";
import { EffectLogger } from "@/lib/effectLogger";
import { EngineRegistry } from "@/lib/renderers";
import { FrameValidator } from "@/lib/FrameValidator";
import { DynamicModeController } from "@/components/DynamicModeController";
import { PLACEHOLDER_IMAGE_URL } from "@/lib/PlaceholderFrame";
import { FrameBuffer, type BufferedFrame } from "@/lib/FrameBuffer";
import type { AudioAnalysis, ArtVote, ArtPreference, MusicIdentification, ArtSession } from "@shared/schema";

// BUG FIX: Setup step enum for sequential modal flow (prevents overlapping modals)
enum SetupStep {
  IDLE = 'IDLE',
  STYLE = 'STYLE',
  AUDIO = 'AUDIO',
  COMPLETE = 'COMPLETE',
}

export default function Display() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [frequencyBands, setFrequencyBands] = useState({ bass: 0, mids: 0, highs: 0 });
  const [showControls, setShowControls] = useState(true);
  const [volume, setVolume] = useState([80]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [dynamicMode, setDynamicMode] = useState<boolean>(false);
  // BUG FIX: Use SetupStep enum instead of boolean flags to prevent overlapping modals
  const [setupStep, setSetupStep] = useState<SetupStep>(SetupStep.IDLE);
  const [setupComplete, setSetupComplete] = useState(false); // Track if first-time setup is done
  
  // BUG FIX #3: Wizard latch to prevent refetch race conditions
  const wizardActiveRef = useRef(false);
  
  // BUG FIX: Use ref instead of state for impressionVersion (immediate access across all code)
  const impressionVersionRef = useRef(0);
  const [impressionVersionTrigger, setImpressionVersionTrigger] = useState(0); // Trigger re-renders
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [currentAudioAnalysis, setCurrentAudioAnalysis] = useState<AudioAnalysis | null>(null);
  const [currentArtworkId, setCurrentArtworkId] = useState<string | null>(null);
  const [currentArtworkSaved, setCurrentArtworkSaved] = useState(false);
  const [currentMusicInfo, setCurrentMusicInfo] = useState<MusicIdentification | null>(null);
  const lastMusicTrackRef = useRef<string | null>(null);
  const [currentExplanation, setCurrentExplanation] = useState<string>("");
  const [showExplanation, setShowExplanation] = useState(false);
  const [isIdentifyingMusic, setIsIdentifyingMusic] = useState(false);
  const [generationInterval, setGenerationInterval] = useState(1); // minutes (Frame A to Frame B duration)
  const [timeUntilNext, setTimeUntilNext] = useState<number>(0); // seconds
  const [showCountdown, setShowCountdown] = useState(false); // hide countdown timer (using 1min morph cycle)
  const [selectedEngine, setSelectedEngine] = useState<string>(() => {
    const registry = EngineRegistry.getInstance();
    return registry.getDefaultEngine();
  });
  const [isValidatingImages, setIsValidatingImages] = useState(false); // show spinner during validation/auto-generation
  
  // FLICKERING FIX: Pin fresh artwork for 3 seconds to survive DB replication lag
  const [pinnedArtwork, setPinnedArtwork] = useState<any | null>(null);
  const pinnedTimerRef = useRef<number | null>(null); // Browser timer uses number, not NodeJS.Timeout
  
  // Debug and Effects Control
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [showEffectsMenu, setShowEffectsMenu] = useState(false);
  const [catalogueTier, setCatalogueTier] = useState<'exact' | 'related' | 'global' | 'procedural' | null>(null);
  
  // Local EffectsConfig type (TODO: migrate to MaestroControlStore/EffectPreferences)
  type EffectsConfig = {
    trace: { enabled: boolean; intensity: number };
    bloom: { enabled: boolean; intensity: number };
    chromaticDrift: { enabled: boolean; intensity: number };
    particles: { enabled: boolean; density: number };
    kenBurns: { enabled: boolean; maxZoom: number };
  };
  const [debugStats, setDebugStats] = useState<DebugStats>({
    fps: 0,
    frameAOpacity: 0,
    frameBOpacity: 0,
    morphProgress: 0,
    zoomLevel: 1.0,
    activeEffects: {
      trace: true,
      bloom: true,
      chromaticDrift: true,
      particles: true,
      kenBurns: true,
    },
    shaderStatus: {
      coreReady: false,
      traceEnabled: false,
      bloomEnabled: false,
      compositeEnabled: false,
    },
    audioMetrics: {
      bassLevel: 0,
      midsLevel: 0,
      trebleLevel: 0,
      beatBurst: 0,
    },
  });
  const [effectsConfig, setEffectsConfig] = useState<EffectsConfig>({
    trace: { enabled: true, intensity: 0.7 },
    bloom: { enabled: true, intensity: 0.6 },
    chromaticDrift: { enabled: true, intensity: 0.5 },
    particles: { enabled: true, density: 0.7 },
    kenBurns: { enabled: true, maxZoom: 1.2 },
  });
  
  // Image history for back/forward navigation
  const [imageHistory, setImageHistory] = useState<Array<{
    imageUrl: string;
    prompt: string;
    explanation: string;
    musicInfo: MusicIdentification | null;
    audioAnalysis: AudioAnalysis | null;
    artworkId: string | null;
    isSaved: boolean;
  }>>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const morphEngineRef = useRef<MorphEngine>(new MorphEngine()); // Initialize immediately
  const rendererRef = useRef<RendererManager | null>(null);
  const frameBufferRef = useRef<FrameBuffer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const hideControlsTimeoutRef = useRef<number>();
  const generationTimeoutRef = useRef<number>();
  const musicIdentificationTimeoutRef = useRef<number>();
  const catalogueBridgeAbortRef = useRef<AbortController | null>(null);
  const sessionId = useRef(crypto.randomUUID());
  
  // FIX: Debounce render-ack to prevent hundreds of API calls per second
  const pendingRenderAcksRef = useRef<Set<string>>(new Set());
  const renderAckTimerRef = useRef<number | null>(null);
  const lastGenerationTime = useRef<number>(0);
  const lastRenderedArtworkIdsRef = useRef<Set<string>>(new Set()); // Track displayed frames for render-ack
  const historyIndexRef = useRef<number>(-1);
  const isGeneratingRef = useRef<boolean>(false);
  const isFallbackGeneratingRef = useRef<boolean>(false); // Guard to prevent infinite validation loop
  const effectLoggerRef = useRef<EffectLogger>(new EffectLogger());
  const showDebugOverlayRef = useRef<boolean>(false);
  const effectsConfigRef = useRef<EffectsConfig>(effectsConfig);
  const frameValidatorRef = useRef<FrameValidator>(new FrameValidator({ maxRetries: 2, enableTelemetry: true }));
  
  // Sync refs with state
  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);
  
  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);
  
  useEffect(() => {
    showDebugOverlayRef.current = showDebugOverlay;
  }, [showDebugOverlay]);
  
  useEffect(() => {
    effectsConfigRef.current = effectsConfig;
  }, [effectsConfig]);
  
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (isAuthenticated === false) {
      // Use window.location to trigger server-side redirect to Replit Auth
      window.location.href = "/api/login";
    }
  }, [isAuthenticated]);

  // Fetch daily usage stats
  const { data: usageStats, refetch: refetchUsageStats } = useQuery<{
    count: number;
    limit: number;
    remaining: number;
    date: string;
  }>({
    queryKey: ["/api/usage/stats"],
    enabled: isAuthenticated,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Fetch preferences on mount
  const { data: preferences, isLoading: isLoadingPreferences, isError: preferencesError } = useQuery<ArtPreference>({
    queryKey: [`/api/preferences/${sessionId.current}`],
  });

  // Fetch UNSEEN artwork only - Freshness Pipeline ensures never seeing repeats
  // GATED: Only load artworks after first-time setup is complete
  // CRITICAL: staleTime=0 forces fresh fetch on mount, cache invalidation on impressions
  // BUG FIX: Include impressionVersion in queryKey for proper cache invalidation
  const { data: unseenResponse } = useQuery<{
    artworks: any[];
    poolSize: number;
    freshCount?: number;
    storageCount?: number;
    needsGeneration: boolean;
  }>({
    queryKey: ["/api/artworks/next", sessionId.current, impressionVersionTrigger],
    queryFn: async () => {
      const res = await fetch(`/api/artworks/next?sessionId=${sessionId.current}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return await res.json();
    },
    enabled: isAuthenticated && setupComplete, // Block until wizard complete
    staleTime: 0, // Always consider data stale - refetch on mount
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  // Extract artworks from response
  const recentArtworks = unseenResponse?.artworks;

  // FLICKERING FIX: Merge pinned artwork ahead of server results (single source of truth)
  const mergedArtworks = useMemo(() => {
    const serverArtworks = unseenResponse?.artworks || [];
    if (pinnedArtwork) {
      // Pin always appears first, remove duplicate from server results
      return [pinnedArtwork, ...serverArtworks.filter(a => a.id !== pinnedArtwork.id)];
    }
    return serverArtworks;
  }, [unseenResponse?.artworks, pinnedArtwork]);

  // FLICKERING FIX: Cleanup timer on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pinnedTimerRef.current) {
        clearTimeout(pinnedTimerRef.current);
      }
    };
  }, []);

  // Detect music changes and mark stale frames in FrameBuffer
  useEffect(() => {
    if (!currentMusicInfo?.title) return;
    
    const currentTrack = currentMusicInfo.title;
    
    // Check if music changed
    if (lastMusicTrackRef.current && lastMusicTrackRef.current !== currentTrack) {
      console.log(`[FrameBuffer] Music changed from "${lastMusicTrackRef.current}" to "${currentTrack}"`);
      
      // Mark stale frames in FrameBuffer
      if (frameBufferRef.current) {
        frameBufferRef.current.markStaleFrames(currentTrack);
        
        // Clear stale frames after a short delay
        setTimeout(() => {
          frameBufferRef.current?.clearStaleFrames();
        }, 2000);
      }
    }
    
    lastMusicTrackRef.current = currentTrack;
  }, [currentMusicInfo]);

  // FLICKERING FIX: Early unpin when server returns same artwork ID (smooth handoff)
  useEffect(() => {
    if (!pinnedArtwork) return;
    const serverArtworks = unseenResponse?.artworks || [];
    if (serverArtworks.some(a => a.id === pinnedArtwork.id)) {
      console.log('[FlickerFix] Server now has pinned artwork - dropping pin early');
      setPinnedArtwork(null);
      if (pinnedTimerRef.current) {
        clearTimeout(pinnedTimerRef.current);
        pinnedTimerRef.current = null;
      }
    }
  }, [unseenResponse?.artworks, pinnedArtwork]);

  // First-Time Setup Wizard: Check if user has preferences
  // BUG FIX #3: Guard against refetch race conditions that reset the wizard
  useEffect(() => {
    // CRITICAL: Handle loading and error states to prevent blank screen
    if (isLoadingPreferences) {
      // Still loading preferences, wait...
      return;
    }
    
    // BUG FIX #3: If wizard is active (user mid-flow), NEVER reset it during refetch
    if (wizardActiveRef.current) {
      console.log('[Display] Wizard active - skipping reset during refetch');
      return;
    }
    
    if (preferencesError) {
      // Preferences query failed - show wizard as fallback and warn user
      console.error('[Display] Failed to load preferences - showing wizard as fallback');
      toast({
        title: "Preferences Unavailable",
        description: "Couldn't load your saved preferences. You can select new ones now.",
        variant: "default",
      });
      // BUG FIX #3: Only reset if wizard is IDLE (not mid-flow)
      if (setupStep === SetupStep.IDLE) {
        wizardActiveRef.current = true;
        setSetupStep(SetupStep.STYLE);
        setSetupComplete(false);
      }
      return;
    }
    
    // Tight type guard: Show wizard if no preferences or empty styles
    if (!preferences || !preferences.styles?.length) {
      // BUG FIX #3: Only reset if wizard is IDLE (prevents loop during refetch)
      if (setupStep === SetupStep.IDLE) {
        console.log('[Display] First-time user detected - showing style selector wizard');
        wizardActiveRef.current = true;
        setSetupStep(SetupStep.STYLE);
        setSetupComplete(false);
      } else {
        console.log('[Display] Wizard in progress - skipping reset during refetch');
      }
      return;
    }
    
    // Returning user - preferences is guaranteed to exist here with styles
    console.log('[Display] Returning user - loading saved preferences');
    setSelectedStyles(preferences.styles);
    if (preferences.dynamicMode !== undefined) {
      setDynamicMode(preferences.dynamicMode);
    }
    setSetupComplete(true); // Allow artwork loading
  }, [preferences, isLoadingPreferences, preferencesError, setupStep]);

  // Auto-generate artwork when unseen pool runs low (Freshness Pipeline)
  useEffect(() => {
    // CRITICAL FIX: Trigger fallback generation even when frame count is 0 (empty pool scenario)
    if (
      unseenResponse?.needsGeneration && 
      !isGeneratingRef.current
    ) {
      const frameCount = morphEngineRef.current.getFrameCount();
      console.log(`[Freshness] Pool ${frameCount === 0 ? 'empty' : 'low'}, auto-generating artwork to ${frameCount === 0 ? 'populate' : 'refill'}...`);
      const audioAnalysis = createDefaultAudioAnalysis();
      generateArtMutation.mutate({ audioAnalysis, musicInfo: null });
    }
  }, [unseenResponse?.needsGeneration]);

  // Keyboard shortcuts for debug overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 'D' key toggles debug overlay
      if (e.key === 'd' || e.key === 'D') {
        setShowDebugOverlay(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Listen for renderer fallback events
  useEffect(() => {
    const handleRendererFallback = (event: CustomEvent) => {
      const { attempted, fallback, reason } = event.detail;
      
      toast({
        title: "Renderer Updated",
        description: `${attempted} encountered an issue (${reason}). Using ${fallback} instead.`,
        variant: "default",
      });
      
      console.log(`[Display] Renderer fallback: ${attempted} → ${fallback}`);
    };

    window.addEventListener('renderer-fallback', handleRendererFallback as EventListener);
    return () => window.removeEventListener('renderer-fallback', handleRendererFallback as EventListener);
  }, [toast]);

  // Helper: Check if image is black/blank by analyzing pixel data
  const isImageBlank = (img: HTMLImageElement): boolean => {
    try {
      // Create canvas to analyze pixel data
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      
      // Sample at smaller resolution for speed (100x100)
      canvas.width = 100;
      canvas.height = 100;
      ctx.drawImage(img, 0, 0, 100, 100);
      
      const imageData = ctx.getImageData(0, 0, 100, 100);
      const pixels = imageData.data;
      
      let darkPixelCount = 0;
      const totalPixels = 100 * 100;
      const DARKNESS_THRESHOLD = 20; // RGB values below this are considered "black"
      
      // Check each pixel (RGBA format, so step by 4)
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const brightness = (r + g + b) / 3;
        
        if (brightness < DARKNESS_THRESHOLD) {
          darkPixelCount++;
        }
      }
      
      const darkPixelPercentage = (darkPixelCount / totalPixels) * 100;
      
      if (darkPixelPercentage > 95) {
        console.warn(`[Display] ⚫ Image is ${darkPixelPercentage.toFixed(1)}% black - rejecting as blank`);
        return true; // Image is blank/black
      }
      
      console.log(`[Display] ✅ Image pixel check passed (${darkPixelPercentage.toFixed(1)}% dark pixels)`);
      return false; // Image has visible content
    } catch (error) {
      console.error(`[Display] Error analyzing image pixels:`, error);
      return false; // Assume valid on error
    }
  };

  // Helper: Validate that image URL from object storage is accessible AND not blank
  const validateImageUrl = async (url: string): Promise<boolean> => {
    try {
      // Images are served from /public-objects/... (Replit Object Storage)
      console.log(`[Display] Validating image: ${url}`);
      
      // Use Image element for validation (most reliable for images)
      return new Promise<boolean>((resolve) => {
        const img = new Image();
        const timeoutId = setTimeout(() => {
          console.error(`[Display] Image validation timeout (3s) for ${url}`);
          resolve(false);
        }, 3000);
        
        img.onload = () => {
          clearTimeout(timeoutId);
          console.log(`[Display] ✅ Image loaded: ${url} (${img.width}x${img.height})`);
          
          // ENHANCED: Check if image is black/blank
          const isBlank = isImageBlank(img);
          if (isBlank) {
            console.error(`[Display] ❌ Image is black/blank, rejecting: ${url}`);
            resolve(false);
            return;
          }
          
          console.log(`[Display] ✅ Image validation passed (loaded + not blank): ${url}`);
          resolve(true);
        };
        
        img.onerror = (e) => {
          clearTimeout(timeoutId);
          console.error(`[Display] Image validation failed for ${url}:`, e);
          resolve(false);
        };
        
        img.src = url;
      });
    } catch (error) {
      console.error(`[Display] Image validation error:`, error);
      return false;
    }
  };

  /**
   * BUG FIX: Safe prewarm helper with null checks, readiness gate, and error handling
   * Prevents crashes from prewarming before renderer initialization completes
   */
  const safePrewarmFrame = async (imageUrl: string, frameId: string, context: string = 'frame') => {
    try {
      // Null check
      if (!rendererRef.current) {
        console.warn(`[Display] ⏸️ Renderer not initialized, skipping prewarm for ${context}`);
        return;
      }
      
      // Wait for renderer to be ready (with 5s timeout)
      try {
        await rendererRef.current.whenReady();
      } catch (readyError) {
        console.warn(`[Display] ⚠️ Renderer not ready (timeout), skipping prewarm for ${context}:`, readyError);
        return;
      }
      
      // Prewarm with error handling
      await rendererRef.current.prewarmFrame(imageUrl, frameId);
      console.log(`[Display] ✅ Prewarmed ${context}: ${frameId}`);
    } catch (error) {
      console.error(`[Display] ❌ Prewarm failed for ${context} (${frameId}):`, error);
      // Graceful degradation - continue without prewarming (JIT fallback will handle)
    }
  };

  // Load multiple recent artworks on mount to enable morphing
  useEffect(() => {
    // CRITICAL GUARD: Prevent infinite loop during fallback generation
    if (isFallbackGeneratingRef.current) {
      console.log(`[Display] ⏸️ Skipping validation - fallback generation in progress`);
      return;
    }
    
    if (mergedArtworks && mergedArtworks.length > 0 && morphEngineRef.current.getFrameCount() === 0) {
      // Load and VALIDATE frames asynchronously
      const loadValidatedFrames = async () => {
        try {
          setIsValidatingImages(true); // Show loading spinner
          console.log(`[Display] 🔍 Loading artworks in FIFO order (max 20)...`);
        
        // FIFO ORDER: Load artworks sequentially (no shuffle) for true freshness
        const orderedArtworks = [...mergedArtworks];
        
        // ⭐ BUG FIX #5: VALIDATE FRAMES BEFORE LOADING (3-layer defense)
        const frameIds = orderedArtworks.map(a => a.id);
        const validation = frameValidatorRef.current.validate(frameIds, sessionId.current);
        
        if (!validation.valid) {
          console.warn('[Display] ❌ Validator rejected frames:', validation.reason);
          
          if (validation.reason === 'max_retries_exceeded') {
            console.error('[Display] 🚨 Validator exhausted retries - triggering fallback generation');
            toast({
              title: "Loading Artwork",
              description: "Pool temporarily low, generating fresh artwork...",
            });
            
            // CRITICAL FIX: Trigger fallback generation to prevent morph engine stall
            isFallbackGeneratingRef.current = true;
            
            try {
              await generateFallbackArtwork();
            } finally {
              isFallbackGeneratingRef.current = false;
              setIsValidatingImages(false);
            }
            return;
          }
          
          // Refetch with cache invalidation to get truly fresh frames
          console.log('[Display] 🔄 Refetching fresh frames after validator rejection');
          queryClient.invalidateQueries({ 
            queryKey: ["/api/artworks/next", sessionId.current],
            refetchType: "active",
          });
          setIsValidatingImages(false);
          return;
        }
        
        // Track validated artworks for UI selection
        const validatedArtworks: typeof recentArtworks = [];
        
        // FRESHNESS: Load up to 20 artworks to fill MorphEngine pool
        const MAX_VALIDATION_ATTEMPTS = 20;
        let attemptCount = 0;
        
        for (let i = 0; i < orderedArtworks.length && attemptCount < MAX_VALIDATION_ATTEMPTS; i++) {
          const artwork = orderedArtworks[i];
          attemptCount++;
          
          // BUG FIX: Skip artworks we've already recorded impressions for (already seen)
          if (impressionRecorder.hasRecorded(artwork.id)) {
            console.log(`[Display] ⏭️ Skipping artwork ${artwork.id} - already recorded impression`);
            continue;
          }
          
          // CRITICAL FIX: Validate artwork has imageUrl before using it
          if (!artwork.imageUrl) {
            console.error(`[Display] ❌ CRITICAL: Artwork ${artwork.id} has no imageUrl!`);
            continue; // Skip this invalid artwork
          }
          
          console.log(`[Display] Attempt ${attemptCount}/${MAX_VALIDATION_ATTEMPTS}: Validating ${artwork.imageUrl.substring(0, 60)}...`);
          
          // CRITICAL: Validate image URL from object storage (loads + not blank)
          const isValid = await validateImageUrl(artwork.imageUrl);
          if (!isValid) {
            console.warn(`[Display] ❌ Attempt ${attemptCount} failed - image invalid/blank`);
            continue; // Try next image
          }
          
          console.log(`[Display] ✅ Attempt ${attemptCount} SUCCESS - image validated`);
          
          // Track this artwork as validated
          validatedArtworks.push(artwork);
          
          let dnaVector = parseDNAFromSession(artwork);
          
          // Fallback: If no DNA vector, generate default one
          if (!dnaVector) {
            console.warn(`[Display] Artwork missing DNA vector, generating default`);
            dnaVector = Array(50).fill(0).map(() => Math.random() * 3);
          }
          
          const audioFeatures = artwork.audioFeatures ? JSON.parse(artwork.audioFeatures) : null;
          const musicInfo = artwork.musicTrack ? {
            title: artwork.musicTrack,
            artist: artwork.musicArtist || '',
            album: artwork.musicAlbum || undefined,
            release_date: undefined,
            label: undefined,
            timecode: undefined,
            song_link: undefined
          } : null;
          
          morphEngineRef.current.addFrame({
            imageUrl: artwork.imageUrl,
            dnaVector,
            prompt: artwork.prompt,
            explanation: artwork.generationExplanation || '',
            artworkId: artwork.id,
            musicInfo,
            audioAnalysis: audioFeatures,
          });
          
          // BUG FIX: Safely prewarm frame to prevent visual glitches (with null checks + readiness gate)
          const frameId = artwork.imageUrl.split('/').pop() || artwork.imageUrl;
          safePrewarmFrame(artwork.imageUrl, frameId, `initial-frame-${validatedArtworks.length}`);
          
          console.log(`[Display] ✅ Loaded frame ${validatedArtworks.length}: ${artwork.prompt?.substring(0, 50)}...`);
        }
        
        // QUICK BAILOUT: If all attempts failed, trigger seamless auto-generation
        if (validatedArtworks.length === 0) {
          console.error(`[Display] 🚨 BAILOUT: All ${MAX_VALIDATION_ATTEMPTS} validation attempts failed.`);
          console.error(`[Display] Gallery validation failed after ${MAX_VALIDATION_ATTEMPTS} attempts, generating fresh artwork`);
          
          // SEAMLESS FALLBACK: Auto-generate 2 fresh images (no error message to user!)
          toast({
            title: "Loading Artwork",
            description: "Preparing fresh artwork for you...",
          });
          
          // Set guard to prevent re-entry during fallback generation
          isFallbackGeneratingRef.current = true;
          
          try {
            // Generate 2 fresh artworks automatically
            await generateFallbackArtwork();
          } finally {
            // CRITICAL: Always clear guard and spinner, even if generation fails
            isFallbackGeneratingRef.current = false;
            setIsValidatingImages(false);
          }
          return;
        }
        
        console.log(`[Display] ✅ Total valid frames loaded: ${validatedArtworks.length}`);
        
        // CRITICAL: Queue ALL impressions for batch recording (with retry + lifecycle flush)
        const idsToRecord = validatedArtworks.map(a => a.id);
        if (idsToRecord.length > 0) {
          impressionRecorder.queueImpressions(idsToRecord);
          console.log(`[Display] 📦 Queued ${idsToRecord.length} impressions for batch recording`);
        }
        
        // CRITICAL: Use FIRST VALIDATED artwork for UI (not just first with URL)
        const firstValidArtwork = validatedArtworks[0];
        if (!firstValidArtwork) return;
        
        const audioFeatures = firstValidArtwork.audioFeatures ? JSON.parse(firstValidArtwork.audioFeatures) : null;
        const musicInfo = firstValidArtwork.musicTrack ? {
          title: firstValidArtwork.musicTrack,
          artist: firstValidArtwork.musicArtist || '',
          album: firstValidArtwork.musicAlbum || undefined,
          release_date: undefined,
          label: undefined,
          timecode: undefined,
          song_link: undefined
        } : null;
        
        const historyItem = {
          imageUrl: firstValidArtwork.imageUrl,
          prompt: firstValidArtwork.prompt,
          explanation: firstValidArtwork.generationExplanation || '',
          musicInfo,
          audioAnalysis: audioFeatures,
          artworkId: firstValidArtwork.id,
          isSaved: firstValidArtwork.isSaved || false,
        };

        setImageHistory([historyItem]);
        setHistoryIndex(0);
        setCurrentPrompt(firstValidArtwork.prompt);
        setCurrentExplanation(firstValidArtwork.generationExplanation || '');
        setCurrentMusicInfo(musicInfo);
        setCurrentAudioAnalysis(audioFeatures);
        setCurrentArtworkId(firstValidArtwork.id);
        setCurrentArtworkSaved(firstValidArtwork.isSaved || false);
        
        // Start morph engine with loaded frames
        morphEngineRef.current.start();
        console.log(`[Display] MorphEngine started with ${morphEngineRef.current.getFrameCount()} frames`);
        
        // CRITICAL: Hide spinner immediately after engine starts (don't wait for validation to finish)
        setIsValidatingImages(false);
        } finally {
          // Failsafe: Always hide loading spinner, even if validation throws
          setIsValidatingImages(false);
        }
      };
      
      // Execute async loading
      loadValidatedFrames();
    }
  }, [mergedArtworks, toast]);

  // Smart sync: Add only new frames when recent artworks refreshes (after generation)
  useEffect(() => {
    // Skip if MorphEngine is empty (initial load handles this)
    if (!recentArtworks || recentArtworks.length === 0 || morphEngineRef.current.getFrameCount() === 0) {
      return;
    }
    
    // Skip during fallback generation to avoid interference
    if (isFallbackGeneratingRef.current) {
      return;
    }
    
    // Find new artworks not yet in MorphEngine (deduplicate by imageUrl for stability)
    const newArtworks = recentArtworks.filter(artwork => {
      return artwork.imageUrl && !morphEngineRef.current.hasImageUrl(artwork.imageUrl);
    });
    
    if (newArtworks.length === 0) {
      return; // No new frames to add
    }
    
    console.log(`[Display] 🔄 Smart sync: Found ${newArtworks.length} new artworks to add to MorphEngine`);
    
    // CRITICAL: Prune BEFORE inserting to prevent index corruption
    // This ensures pendingJumpIndex set by insertFrameAfterCurrent remains valid
    const MAX_FRAMES = 20;
    const currentFrameCount = morphEngineRef.current.getFrameCount();
    const predictedTotal = currentFrameCount + newArtworks.length;
    
    if (predictedTotal > MAX_FRAMES) {
      const framesToRemove = predictedTotal - MAX_FRAMES;
      console.log(`[Display] 🗑️ Pre-pruning ${framesToRemove} oldest frames (current: ${currentFrameCount}, incoming: ${newArtworks.length})`);
      morphEngineRef.current.pruneOldestFrames(framesToRemove);
    }
    
    // Add new frames with immediate jump priority (backend returns fresh → storage order)
    // insertFrameAfterCurrent ensures fresh artwork appears IMMEDIATELY (no 60s wait)
    newArtworks.forEach(artwork => {
      // FLICKERING FIX: Triple guard to prevent double insertion
      // Guard #1: Skip if this is the currently pinned artwork
      if (pinnedArtwork && artwork.id === pinnedArtwork.id) {
        console.log(`[FlickerFix] Skipping pinned artwork (already visible): ${artwork.id}`);
        return;
      }
      
      // Guard #2: Skip if already in MorphEngine by ID
      if (morphEngineRef.current.hasFrameById(artwork.id)) {
        console.log(`[FlickerFix] Skipping duplicate frame (already in engine): ${artwork.id}`);
        return;
      }
      
      // CRITICAL FIX: Validate artwork has imageUrl before using it
      if (!artwork.imageUrl) {
        console.error(`[Display] ❌ CRITICAL: Fresh artwork ${artwork.id} has no imageUrl!`);
        return; // Skip this invalid artwork
      }
      
      let dnaVector = parseDNAFromSession(artwork);
      
      if (!dnaVector) {
        console.warn(`[Display] Artwork ${artwork.id} missing DNA vector, generating default`);
        dnaVector = Array(50).fill(0).map(() => Math.random() * 3);
      }
      
      const audioFeatures = artwork.audioFeatures ? JSON.parse(artwork.audioFeatures) : null;
      const musicInfo = artwork.musicTrack ? {
        title: artwork.musicTrack,
        artist: artwork.musicArtist || '',
        album: artwork.musicAlbum || undefined,
        release_date: undefined,
        label: undefined,
        timecode: undefined,
        song_link: undefined
      } : null;
      
      morphEngineRef.current.insertFrameAfterCurrent({
        imageUrl: artwork.imageUrl,
        dnaVector,
        prompt: artwork.prompt,
        explanation: artwork.generationExplanation || '',
        artworkId: artwork.id,
        musicInfo,
        audioAnalysis: audioFeatures,
      });
      
      // BUG FIX: Safely prewarm fresh frame to prevent visual glitches (with null checks + readiness gate)
      const frameId = artwork.imageUrl.split('/').pop() || artwork.imageUrl;
      safePrewarmFrame(artwork.imageUrl, frameId, 'fresh-frame');
      
      // PEER-REVIEWED FIX #3: Record impression when fresh frame is inserted (deduplicated with retry on failure)
      impressionRecorder.queueImpressions(artwork.id);
      
      // Auto-dismiss catalogue tier badge when fresh artwork arrives
      setCatalogueTier(null);
      
      console.log(`[Display] ✅ Inserted fresh frame with immediate jump (safe - pruning already done): ${artwork.prompt?.substring(0, 50)}...`);
    });
    
    const finalFrameCount = morphEngineRef.current.getFrameCount();
    console.log(`[Display] Smart sync complete. Final frames: ${finalFrameCount} (≤${MAX_FRAMES})`);
  }, [recentArtworks]);

  // Fetch voting history
  const { data: votes } = useQuery<ArtVote[]>({
    queryKey: [`/api/votes/${sessionId.current}`],
    enabled: isPlaying,
  });

  // Save preferences mutation
  const savePreferencesMutation = useMutation({
    mutationFn: async ({ styles, dynamicMode }: { styles: string[]; dynamicMode: boolean }) => {
      const res = await apiRequest("POST", "/api/preferences", {
        sessionId: sessionId.current,
        styles,
        artists: [],
        dynamicMode,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/preferences/${sessionId.current}`] });
    },
  });

  // Helper: Generate default audio analysis for auto-generation
  const createDefaultAudioAnalysis = (): AudioAnalysis => ({
    frequency: 60 + Math.random() * 40, // 60-100 Hz
    amplitude: 0.3 + Math.random() * 0.4, // 0.3-0.7
    tempo: 100 + Math.random() * 40, // 100-140 BPM
    bassLevel: 0.4 + Math.random() * 0.3, // 0.4-0.7
    trebleLevel: 0.3 + Math.random() * 0.3, // 0.3-0.6
    mood: 'energetic',
  });

  // Production-grade impression recorder (batching, retry, lifecycle flush)
  const impressionRecorder = useImpressionRecorder({
    maxBatchSize: 200,
    flushDelayMs: 2000,
    sessionId: sessionId.current, // For cache invalidation
    // BUG FIX: Increment impressionVersion after successful flush to force fresh artwork fetch
    onFlush: () => {
      impressionVersionRef.current += 1;
      setImpressionVersionTrigger(impressionVersionRef.current);
      console.log(`[Display] 🔄 Impression flush complete - version now ${impressionVersionRef.current}`);
    },
  });

  // Generate art mutation
  const generateArtMutation = useMutation({
    mutationFn: async ({ audioAnalysis, musicInfo }: { audioAnalysis: AudioAnalysis; musicInfo: MusicIdentification | null }) => {
      // TEMPORARILY DISABLED: Check usage limits before generating
      // if (usageStats && usageStats.remaining <= 0) {
      //   throw new Error(`Daily limit reached (${usageStats.count}/${usageStats.limit}). Upgrade your plan for more generations.`);
      // }

      // Generate new artwork (cache disabled to ensure unique images for navigation)
      const res = await apiRequest("POST", "/api/generate-art", {
        sessionId: sessionId.current,
        audioAnalysis,
        musicInfo,
        preferences: {
          styles: selectedStyles,
          artists: [],
          dynamicMode,
        },
        previousVotes: votes?.slice(0, 10) || [],
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to generate artwork");
      }
      
      const data = await res.json();
      
      return data;
    },
    onSuccess: (data, variables) => {
      const newHistoryItem = {
        imageUrl: data.imageUrl,
        prompt: data.prompt,
        explanation: data.explanation,
        musicInfo: data.musicInfo,
        audioAnalysis: variables.audioAnalysis,
        artworkId: data.session?.id || null,
        isSaved: data.session?.isSaved || false,
      };
      
      // Parse DNA vector and add frame to MorphEngine
      if (data.session && morphEngineRef.current) {
        const dnaVector = parseDNAFromSession(data.session);
        if (dnaVector) {
          morphEngineRef.current.addFrame({
            imageUrl: data.imageUrl,
            dnaVector,
            prompt: data.prompt,
            explanation: data.explanation,
            artworkId: data.session.id,
            musicInfo: data.musicInfo,
            audioAnalysis: variables.audioAnalysis,
          });
          
          // BUG FIX: Safely prewarm newly generated frame (with null checks + readiness gate)
          const frameId = data.imageUrl.split('/').pop() || data.imageUrl;
          safePrewarmFrame(data.imageUrl, frameId, 'generated-frame');
          
          // Start the morph engine if not already started
          if (morphEngineRef.current.getFrameCount() === 1) {
            morphEngineRef.current.start();
            console.log('[Display] MorphEngine started with first frame');
          }
        } else {
          console.warn('[Display] No DNA vector found in session, skipping morph frame');
        }
      }
      
      // Add to history using ref to avoid stale closure
      setImageHistory(prev => {
        const currentIndex = historyIndexRef.current;
        // If viewing an old image, truncate future history
        const newHistory = currentIndex >= 0 && currentIndex < prev.length - 1
          ? [...prev.slice(0, currentIndex + 1), newHistoryItem]
          : [...prev, newHistoryItem];
        
        // Update the index to point to the newly added item
        setHistoryIndex(newHistory.length - 1);
        return newHistory;
      });
      
      // Update current display metadata (not image - canvas handles that)
      setCurrentPrompt(data.prompt);
      setCurrentExplanation(data.explanation);
      setCurrentMusicInfo(data.musicInfo);
      setCurrentAudioAnalysis(variables.audioAnalysis);
      if (data.session) {
        setCurrentArtworkId(data.session.id);
        setCurrentArtworkSaved(data.session.isSaved || false);
      }
      setIsGenerating(false);
      isGeneratingRef.current = false;
      // Update generation time when image is successfully displayed
      lastGenerationTime.current = Date.now();
      
      // Refetch usage stats after successful generation
      refetchUsageStats();
      
      // PEER-REVIEWED FIX #1: Optimistic Update - Show fresh artwork immediately
      if (data.session) {
        const newArtwork = {
          ...data.session,
          imageUrl: data.imageUrl,
          prompt: data.prompt,
          explanation: data.explanation,
          createdAt: new Date().toISOString(),
        };
        
        // BUG FIX: Use 3-part queryKey with impressionVersionRef
        queryClient.setQueryData(
          ["/api/artworks/next", sessionId.current, impressionVersionRef.current],
          (old: any) => ({
            artworks: [
              newArtwork,
              ...(old?.artworks || []).filter((a: any) => a.id !== data.session.id)
            ],
            poolSize: (old?.poolSize || 0) + 1,
            freshCount: 1,
            storageCount: old?.storageCount || 0,
            needsGeneration: false,
          })
        );
        
        // FLICKERING FIX: Pin fresh artwork for 3 seconds (survives DB lag)
        if (pinnedTimerRef.current) {
          clearTimeout(pinnedTimerRef.current);
        }
        setPinnedArtwork(newArtwork);
        pinnedTimerRef.current = window.setTimeout(() => {
          console.log('[FlickerFix] Pin expired after 3 seconds');
          setPinnedArtwork(null);
          pinnedTimerRef.current = null;
        }, 3000);
        console.log('[FlickerFix] Pinned fresh artwork:', newArtwork.id);
      }
      
      // BUG FIX: Increment impressionVersion to force fresh artwork fetch
      impressionVersionRef.current += 1;
      setImpressionVersionTrigger(impressionVersionRef.current);
      
      // PEER-REVIEWED FIX #2: Invalidate with refetchType: "active" + 250ms debounce (React Query v5)
      // React Query v5 requires refetchType: "active" to refetch mounted queries
      // 250ms debounce gives DB time to sync before refetch
      // BUG FIX: Include impressionVersion in invalidation key (incremented above)
      setTimeout(() => {
        queryClient.invalidateQueries({ 
          queryKey: ["/api/artworks/next", sessionId.current, impressionVersionRef.current],
          refetchType: "active",
        });
      }, 250);
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Could not generate artwork",
        variant: "destructive",
      });
      setIsGenerating(false);
      isGeneratingRef.current = false;
      // Reset time on error so we can try again
      lastGenerationTime.current = 0;
    },
  });

  // Seamless auto-generation: Generate 2 images without user intervention
  const generateFallbackArtwork = async () => {
    console.log(`[Display] 🎨 Auto-generating 2 fresh artworks seamlessly...`);
    
    // Generate 2 images sequentially
    for (let i = 1; i <= 2; i++) {
      try {
        const audioAnalysis = createDefaultAudioAnalysis();
        console.log(`[Display] Auto-generating artwork ${i}/2...`);
        
        await generateArtMutation.mutateAsync({
          audioAnalysis,
          musicInfo: null,
        });
        
        console.log(`[Display] ✅ Auto-generation ${i}/2 complete`);
      } catch (error) {
        console.error(`[Display] ❌ Auto-generation ${i}/2 failed:`, error);
        // Continue trying even if one fails
      }
    }
    
    console.log(`[Display] 🎨 Auto-generation complete - seamless fallback successful`);
    
    // Hide loading spinner after auto-generation completes
    setIsValidatingImages(false);
  };

  // Vote mutation
  const voteMutation = useMutation({
    mutationFn: async (vote: 1 | -1) => {
      const res = await apiRequest("POST", "/api/vote", {
        sessionId: sessionId.current,
        artPrompt: currentPrompt,
        vote,
        audioCharacteristics: currentAudioAnalysis ? JSON.stringify(currentAudioAnalysis) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/votes/${sessionId.current}`] });
    },
  });

  // Save artwork mutation
  const saveArtworkMutation = useMutation({
    mutationFn: async () => {
      if (!currentArtworkId) throw new Error("No artwork to save");
      const response = await fetch(`/api/gallery/${currentArtworkId}/toggle`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to save artwork");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setCurrentArtworkSaved(data.isSaved);
      
      // Update the history entry to reflect the new saved state
      setImageHistory(prev => {
        const currentIndex = historyIndexRef.current;
        if (currentIndex >= 0 && currentIndex < prev.length) {
          const updatedHistory = [...prev];
          updatedHistory[currentIndex] = {
            ...updatedHistory[currentIndex],
            isSaved: data.isSaved,
          };
          return updatedHistory;
        }
        return prev;
      });
      
      toast({
        title: data.isSaved ? "Artwork saved!" : "Artwork unsaved",
        description: data.isSaved ? "Added to your gallery" : "Removed from your gallery",
      });
      // Invalidate both gallery (saved only) and unseen artworks (freshness pipeline)
      queryClient.invalidateQueries({ queryKey: ["/api/gallery"] });
      // BUG FIX: Use 3-part queryKey with impressionVersionRef
      queryClient.invalidateQueries({ 
        queryKey: ["/api/artworks/next", sessionId.current, impressionVersionRef.current] 
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Auto-hide controls after 3 seconds of no mouse movement
  useEffect(() => {
    const handleMouseMove = () => {
      setShowControls(true);
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
      hideControlsTimeoutRef.current = window.setTimeout(() => {
        if (morphEngineRef.current && morphEngineRef.current.getFrameCount() > 0) {
          setShowControls(false);
        }
      }, 3000);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
    };
  }, []);

  // ============================================================================
  // TASK 9: Initialize TelemetryService session with serialized lifecycle
  // ============================================================================
  
  useEffect(() => {
    // Gate: Wait for auth state to settle before initializing telemetry
    // This prevents unnecessary session transitions when user is still loading
    if (user === undefined) {
      return;
    }
    
    // Transition to new session (serialized end→start via internal queue)
    // This ensures previous session fully ends before new one starts
    telemetryService.transitionSession(user?.id || null);
    
    return () => {
      // Clear session on unmount (flushes remaining events)
      // Note: React can't await in cleanup, but clearSession() ensures flush completes
      telemetryService.clearSession().catch(err => {
        console.error('[Display] Failed to clear telemetry session:', err);
      });
    };
  }, [user?.id]);

  // Initialize FrameBuffer with callback to request more frames
  useEffect(() => {
    frameBufferRef.current = new FrameBuffer(() => {
      // Callback triggered when buffer is low
      console.log('[FrameBuffer] Buffer low, requesting more frames...');
      // Trigger generation if not already generating
      if (!isGeneratingRef.current) {
        const audioAnalysis = createDefaultAudioAnalysis();
        generateArtMutation.mutate({ audioAnalysis, musicInfo: currentMusicInfo });
      }
    });
    
    console.log('[FrameBuffer] Initialized with placeholder guard');
  }, [currentMusicInfo]);

  // Periodically check if MorphEngine needs frames from buffer
  useEffect(() => {
    const checkAndFeedFrames = () => {
      if (!morphEngineRef.current || !frameBufferRef.current) return;
      
      const frameCount = morphEngineRef.current.getFrameCount();
      
      // MorphEngine needs at least 2 frames for smooth morphing
      if (frameCount < 2 && frameBufferRef.current.getBufferSize() > 0) {
        console.log(`[FrameBuffer] MorphEngine low on frames (${frameCount}), feeding from buffer...`);
        
        const nextFrame = frameBufferRef.current.dequeue();
        
        // Parse DNA vector
        const dnaVector = parseDNAFromSession({
          id: nextFrame.id,
          imageUrl: nextFrame.imageUrl,
          prompt: nextFrame.prompt,
        });
        
        // Add frame to MorphEngine
        morphEngineRef.current.insertFrameAfterCurrent({
          imageUrl: nextFrame.imageUrl,
          dnaVector: dnaVector || Array(50).fill(0.5),
          prompt: nextFrame.prompt || '',
          explanation: nextFrame.explanation || '',
          artworkId: nextFrame.id,
          musicInfo: null, // Will be handled separately
          audioAnalysis: null,
        });
        
        console.log(`[FrameBuffer] Fed frame ${nextFrame.id} to MorphEngine`);
        
        // Start MorphEngine if this was the first frame
        if (morphEngineRef.current.getFrameCount() === 1) {
          morphEngineRef.current.start();
          console.log('[FrameBuffer] Started MorphEngine with first frame');
        }
      }
    };
    
    // Check every 2 seconds
    const interval = setInterval(checkAndFeedFrames, 2000);
    
    // Also check immediately
    checkAndFeedFrames();
    
    return () => clearInterval(interval);
  }, []);

  // Initialize WebSocket
  useEffect(() => {
    wsClientRef.current = new WebSocketClient();
    wsClientRef.current.connect();

    wsClientRef.current.on('audio-update', (data) => {
      console.log('Received audio update from another device:', data);
    });
    
    // ============================================================================
    // TASK 8: GPU-ready handoff logic for fresh artwork (prewarm→ready→swap)
    // ============================================================================
    
    wsClientRef.current.on('artwork.swap', async (data) => {
      console.log('[WebSocket] 🎨 Received artwork.swap event:', data);
      
      // Ignore failures
      if (data.status === 'failed') {
        console.warn('[WebSocket] ⚠️ Artwork generation failed:', data.error);
        return;
      }
      
      // Extract artwork from event
      const artwork = data.artwork;
      if (!artwork || !artwork.imageUrl) {
        console.warn('[WebSocket] ⚠️ Invalid artwork data in swap event');
        return;
      }
      
      // Create BufferedFrame for FrameBuffer
      const bufferedFrame: BufferedFrame = {
        id: artwork.id || artwork.imageUrl,
        imageUrl: artwork.imageUrl,
        timestamp: new Date(),
        priority: data.tier === 'style' ? 'style' : 
                  data.tier === 'global' ? 'global' : 'fresh',
        sequenceId: data.seq || Date.now(), // Use sequence ID if available
        musicContext: artwork.musicInfo ? {
          track: artwork.musicInfo.title || 'Unknown',
          artist: artwork.musicInfo.artist || 'Unknown',
          isStale: false
        } : undefined,
        prompt: artwork.prompt,
        explanation: artwork.explanation,
      };
      
      // Enqueue frame in FrameBuffer
      if (frameBufferRef.current) {
        frameBufferRef.current.enqueue(bufferedFrame);
        console.log('[WebSocket] 🎯 Frame enqueued in FrameBuffer with priority:', bufferedFrame.priority);
        
        // Check if MorphEngine needs frames (has < 2 frames)
        const frameCount = morphEngineRef.current.getFrameCount();
        if (frameCount < 2 && !frameBufferRef.current.hasPlaceholderActive()) {
          // Dequeue frame and add to MorphEngine
          const nextFrame = frameBufferRef.current.dequeue();
          console.log('[WebSocket] 🔄 MorphEngine needs frames, dequeuing from buffer...');
          
          // Continue with prewarm and handoff logic for the dequeued frame
          artwork.imageUrl = nextFrame.imageUrl;
          artwork.id = nextFrame.id;
          artwork.prompt = nextFrame.prompt;
          artwork.explanation = nextFrame.explanation;
          // Continue with existing prewarm logic below...
        } else {
          // Frame buffered for later use
          console.log(`[WebSocket] 📦 Frame buffered (MorphEngine has ${frameCount} frames)`);
          return; // Exit early - frame is in buffer
        }
      }
      
      // ============================================================================
      // STEP 1: PREWARM - Load texture into GPU
      // ============================================================================
      
      const frameId = artwork.id || artwork.imageUrl.split('/').pop() || artwork.imageUrl;
      const handoffStartTime = Date.now();
      
      console.log(`[WebSocket] 🔥 Step 1/3: Prewarming texture for ${frameId}...`);
      
      // TELEMETRY: Record prewarm start
      telemetryService.recordEvent('handoff.prewarm_start', {
        frameId,
      });
      
      const prewarmStartTime = Date.now();
      try {
        await safePrewarmFrame(artwork.imageUrl, frameId, 'websocket-swap');
        
        // TELEMETRY: Record prewarm success
        telemetryService.recordEvent('handoff.prewarm_complete', {
          frameId,
          prewarmDurationMs: Date.now() - prewarmStartTime,
        });
      } catch (error) {
        console.error(`[WebSocket] ❌ Prewarm failed for ${frameId}:`, error);
        
        // TELEMETRY: Record handoff error
        telemetryService.recordEvent('handoff.error', {
          handoffError: `Prewarm failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        
        // Continue anyway - JIT fallback will handle it
      }
      
      // ============================================================================
      // STEP 2: READY - Wait for texture to be GPU-ready
      // ============================================================================
      
      console.log(`[WebSocket] ⏳ Step 2/3: Waiting for texture readiness...`);
      
      // TELEMETRY: Record ready wait start
      telemetryService.recordEvent('handoff.ready_wait', {
        frameId,
      });
      
      // Poll for readiness with timeout
      const maxWait = 2000; // 2s max wait
      const pollInterval = 50; // Check every 50ms
      const readyStartTime = Date.now();
      
      while (Date.now() - readyStartTime < maxWait) {
        if (rendererRef.current?.isFrameReady(frameId)) {
          console.log(`[WebSocket] ✅ Texture ready in ${Date.now() - readyStartTime}ms`);
          break;
        }
        // Wait 50ms before next check
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
      
      const waitDuration = Date.now() - readyStartTime;
      const timedOut = !rendererRef.current?.isFrameReady(frameId);
      
      if (timedOut) {
        console.warn(`[WebSocket] ⚠️ Texture not ready after ${maxWait}ms timeout - proceeding anyway (JIT fallback)`);
        
        // TELEMETRY: Record ready timeout
        telemetryService.recordEvent('handoff.ready_timeout', {
          waitDurationMs: waitDuration,
          timedOut: true,
        });
      }
      
      // ============================================================================
      // STEP 3: SWAP - Atomically add to morphEngine
      // ============================================================================
      
      console.log(`[WebSocket] 🔄 Step 3/3: Adding frame to morphEngine...`);
      
      if (!morphEngineRef.current) {
        console.error('[WebSocket] ❌ MorphEngine not initialized');
        return;
      }
      
      // Deduplication: Skip if already in morphEngine
      if (morphEngineRef.current.hasFrameById(artwork.id)) {
        console.log(`[WebSocket] ⏭️ Skipping duplicate frame (already in engine): ${artwork.id}`);
        
        // TELEMETRY: Record duplicate prevention
        telemetryService.recordEvent('duplicate_prevented', {
          duplicateType: 'artwork_id',
          preventedFrameId: artwork.id,
        });
        
        return;
      }
      
      if (morphEngineRef.current.hasImageUrl(artwork.imageUrl)) {
        console.log(`[WebSocket] ⏭️ Skipping duplicate imageUrl (already in engine): ${artwork.imageUrl}`);
        
        // TELEMETRY: Record duplicate prevention
        telemetryService.recordEvent('duplicate_prevented', {
          duplicateType: 'image_url',
          preventedFrameId: artwork.id,
        });
        
        return;
      }
      
      // Parse DNA vector
      const dnaVector = parseDNAFromSession(artwork);
      if (!dnaVector) {
        console.warn(`[WebSocket] ⚠️ Artwork ${artwork.id} missing DNA vector, generating default`);
      }
      
      // Atomically add frame (insertFrameAfterCurrent for immediate display)
      morphEngineRef.current.insertFrameAfterCurrent({
        imageUrl: artwork.imageUrl,
        dnaVector: dnaVector || Array(50).fill(0.5),
        prompt: artwork.prompt || '',
        explanation: artwork.explanation || '',
        artworkId: artwork.id,
        musicInfo: artwork.musicInfo || null,
        audioAnalysis: artwork.audioAnalysis || null,
      });
      
      const totalHandoffDuration = Date.now() - handoffStartTime;
      console.log(`[WebSocket] ✅ GPU-ready handoff complete for ${frameId} - frame added to morphEngine`);
      
      // TELEMETRY: Record handoff swap complete
      telemetryService.recordEvent('handoff.swap_complete', {
        swapSuccess: true,
        totalHandoffMs: totalHandoffDuration,
      });
      
      // FIX: Immediately update UI state to show new artwork metadata
      setCurrentImage(artwork.imageUrl);
      setCurrentPrompt(artwork.prompt || '');
      setCurrentExplanation(artwork.explanation || '');
      setCurrentArtworkId(artwork.id);
      setCurrentMusicInfo(artwork.musicInfo || null);
      setCurrentAudioAnalysis(artwork.audioAnalysis || null);
      setIsGenerating(false);
      isGeneratingRef.current = false;
      
      console.log(`[WebSocket] ✅ UI state updated for fresh artwork: ${artwork.id}`);
      
      // FIX: Record impression for the fresh artwork
      if (artwork.id && !impressionRecorder.hasRecorded(artwork.id)) {
        impressionRecorder.queueImpressions(artwork.id);
        lastRenderedArtworkIdsRef.current.add(artwork.id);
        console.log(`[WebSocket] ✅ Impression queued for fresh artwork: ${artwork.id}`);
      }
      
      // Start morphEngine if this is the first frame
      if (morphEngineRef.current.getFrameCount() === 1) {
        morphEngineRef.current.start();
        console.log('[WebSocket] MorphEngine started with first frame');
      }
    });

    return () => {
      wsClientRef.current?.disconnect();
    };
  }, []);

  // FIX: Debounced render-ack function to prevent API spam
  const flushRenderAcks = useCallback(() => {
    if (pendingRenderAcksRef.current.size === 0 || !user) return;
    
    const artworkIds = Array.from(pendingRenderAcksRef.current);
    pendingRenderAcksRef.current.clear();
    
    fetch('/api/impressions/rendered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        artworkIds,
        source: 'fresh', // TODO: Track which frames came from catalogue bridge vs fresh generation
        sessionId: sessionId.current, // CRITICAL: Include sessionId for recently-served cache
      }),
    })
      .then(res => {
        if (res.ok) {
          console.log(`[RenderAck] ✅ Recorded ${artworkIds.length} rendered impressions`);
        } else {
          console.warn(`[RenderAck] ⚠️ Failed to record impressions (${res.status})`);
        }
      })
      .catch(error => {
        console.error('[RenderAck] Error recording impressions:', error);
      });
  }, [user]);

  // Initialize Renderer (MorphEngine already initialized synchronously)
  useEffect(() => {
    const device = detectDeviceCapabilities();
    console.log(`[Display] Device tier ${device.tier} detected, max FPS: ${device.maxFPS}`);
    
    rendererRef.current = new RendererManager('morphing-canvas-container', selectedEngine);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      morphEngineRef.current?.stop();
      rendererRef.current?.destroy();
      
      // Flush any pending render-acks on cleanup
      if (renderAckTimerRef.current) {
        clearTimeout(renderAckTimerRef.current);
      }
      flushRenderAcks();
    };
  }, []);
  
  // Handle engine selection changes
  // Auto-migrate from old default (morpheus_0.5) to new default (morpheus_0.1) on initial mount only
  const hasMigratedRef = useRef(false);
  useEffect(() => {
    if (hasMigratedRef.current) return; // Only run once
    
    const registry = EngineRegistry.getInstance();
    const currentDefault = registry.getDefaultEngine();
    
    // If user still has old default, migrate to new default (only on first mount)
    if (selectedEngine === 'morpheus_0.5' && currentDefault !== 'morpheus_0.5') {
      console.log(`[Display] Auto-migrating from morpheus_0.5 to new default: ${currentDefault}`);
      setSelectedEngine(currentDefault);
    }
    
    hasMigratedRef.current = true;
  }, []); // Empty dependency array - runs only on mount

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.requestEngineSwitch(selectedEngine);
      console.log(`[Display] Engine switch requested: ${selectedEngine}`);
    }
  }, [selectedEngine]);

  // Render loop for DNA morphing
  useEffect(() => {
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    let fpsFrameCount = 0;
    let currentFps = 0;
    
    const renderLoop = () => {
      if (!morphEngineRef.current || !rendererRef.current) {
        animationFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }
      
      // Update MorphScheduler FSM state
      morphEngineRef.current.tick(16); // ~16ms frame time

      // FPS tracking
      const now = performance.now();
      fpsFrameCount++;
      if (now - lastFpsUpdate >= 1000) {
        currentFps = fpsFrameCount;
        fpsFrameCount = 0;
        lastFpsUpdate = now;
      }

      // Always get current frame to display, even when paused
      const currentFrame = morphEngineRef.current.getCurrentFrame();
      
      if (!currentFrame) {
        // CRITICAL: Use placeholder guard to prevent black frames
        // Display placeholder immediately using the imported URL
        if (rendererRef.current && PLACEHOLDER_IMAGE_URL) {
          // Create a minimal morph state for static display
          const placeholderMorphState = {
            phase: 'hold' as const,
            phaseProgress: 0,
            morphProgress: 0,
            frameForeshadowMix: 0,
            audioIntensity: 0,
            dna: Array(50).fill(0.5),
            prompt: 'Loading artwork...',
            explanation: '',
            artworkId: 'placeholder',
            musicInfo: null,
            audioAnalysis: null,
          };
          
          // Use static renderer mode for placeholder (same image for both frames)
          rendererRef.current.render(
            PLACEHOLDER_IMAGE_URL,     // current frame
            PLACEHOLDER_IMAGE_URL,     // next frame (same for static)
            placeholderMorphState,     // morph state
            undefined                  // no audio analysis
          );
        }
        
        animationFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }

      // Check if we have multiple frames for morphing
      const totalFrames = morphEngineRef.current.getFrameCount();
      const hasMultipleFrames = totalFrames > 1;
      
      // Three display modes:
      // 1. Playing + multiple frames → Full audio-reactive morphing
      // 2. Paused + multiple frames → Gentle ambient morphing (no audio)
      // 3. Single frame (any state) → Static with Ken Burns effect
      
      if (hasMultipleFrames) {
        // MORPHING MODE (both playing and paused)
        const prevFrameIndex = morphEngineRef.current.getCurrentFrame();
        const morphState = morphEngineRef.current.getMorphState(isPlaying ? (currentAudioAnalysis || undefined) : undefined);
        const nextFrame = morphEngineRef.current.getNextFrame();
        
        // Check if we've advanced to a new cycle (frame index wrapped around)
        const currentFrameIndex = morphEngineRef.current.getCurrentFrame();
        if (prevFrameIndex && currentFrameIndex && prevFrameIndex !== currentFrameIndex) {
          // Cycle boundary - apply pending engine switch
          rendererRef.current.applyPendingEngineSwitch();
        }

        // Audio reactivity only when playing
        const scaledAudio = isPlaying && currentAudioAnalysis && morphState.audioIntensity > 0 ? {
          frequency: currentAudioAnalysis.frequency,
          bassLevel: currentAudioAnalysis.bassLevel * morphState.audioIntensity,
          amplitude: currentAudioAnalysis.amplitude * morphState.audioIntensity,
          tempo: currentAudioAnalysis.tempo,
          trebleLevel: currentAudioAnalysis.trebleLevel * morphState.audioIntensity,
          mood: currentAudioAnalysis.mood,
        } : null;

        // Log every 5 seconds (300 frames at 60fps)
        if (frameCount % 300 === 0) {
          console.log(`[RenderLoop] ${isPlaying ? 'PLAYING' : 'PAUSED (morphing)'}, Phase: ${morphState.phase}, Progress: ${(morphState.phaseProgress * 100).toFixed(1)}%, MorphProgress: ${(morphState.morphProgress * 100).toFixed(1)}%, Foreshadow: ${(morphState.frameForeshadowMix * 100).toFixed(0)}%, Frames: ${totalFrames}`);
        }
        frameCount++;

        const currentOpacity = morphState.phase === 'hold' || morphState.phase === 'ramp' 
          ? 1.0 
          : (1.0 - morphState.frameForeshadowMix);
        const nextOpacity = morphState.frameForeshadowMix;

        rendererRef.current.render(
          currentFrame.imageUrl,
          nextFrame ? nextFrame.imageUrl : currentFrame.imageUrl,
          morphState,
          scaledAudio || undefined
        );

        // ============================================================================
        // RENDER-ACK: Record impressions only when frames are actually displayed
        // FIX: Debounced to prevent hundreds of API calls per second
        // ============================================================================
        
        // Add currentFrame if it has significant opacity (>10%)
        if (currentFrame.artworkId && currentOpacity > 0.1 && !lastRenderedArtworkIdsRef.current.has(currentFrame.artworkId)) {
          pendingRenderAcksRef.current.add(currentFrame.artworkId);
          lastRenderedArtworkIdsRef.current.add(currentFrame.artworkId);
        }
        
        // Add nextFrame if it has significant opacity (>10%) during morph phase
        if (nextFrame?.artworkId && nextOpacity > 0.1 && !lastRenderedArtworkIdsRef.current.has(nextFrame.artworkId)) {
          pendingRenderAcksRef.current.add(nextFrame.artworkId);
          lastRenderedArtworkIdsRef.current.add(nextFrame.artworkId);
        }
        
        // Debounce render-ack API calls (max once per second instead of 60 times per second)
        if (pendingRenderAcksRef.current.size > 0 && !renderAckTimerRef.current) {
          renderAckTimerRef.current = window.setTimeout(() => {
            flushRenderAcks();
            renderAckTimerRef.current = null;
          }, 1000); // Batch and send once per second max
        }

        // Update debug stats for morphing mode (using ref to avoid render loop restart)
        if (showDebugOverlayRef.current) {
          const config = effectsConfigRef.current;
          setDebugStats({
            fps: currentFps,
            frameAOpacity: currentOpacity,
            frameBOpacity: nextOpacity,
            morphProgress: morphState.morphProgress,
            zoomLevel: 1.0 + morphState.zoomBias,
            activeEffects: {
              trace: config.trace.enabled,
              bloom: config.bloom.enabled,
              chromaticDrift: config.chromaticDrift.enabled,
              particles: config.particles.enabled,
              kenBurns: config.kenBurns.enabled,
            },
            shaderStatus: {
              coreReady: true,
              traceEnabled: config.trace.enabled,
              bloomEnabled: config.bloom.enabled,
              compositeEnabled: true,
            },
            audioMetrics: scaledAudio ? {
              bassLevel: scaledAudio.bassLevel / 100,
              midsLevel: scaledAudio.amplitude / 100,
              trebleLevel: scaledAudio.trebleLevel / 100,
              beatBurst: morphState.beatBurst,
            } : {
              bassLevel: 0,
              midsLevel: 0,
              trebleLevel: 0,
              beatBurst: 0,
            },
          });
        }

        // Log effect history (every 60 frames = ~1 second)
        if (frameCount % 60 === 0) {
          const config = effectsConfigRef.current;
          effectLoggerRef.current.logFrame({
            zoomLevel: 1.0 + morphState.zoomBias,
            parallaxStrength: morphState.parallaxStrength,
            burnIntensity: morphState.burnIntensity,
            morphProgress: morphState.morphProgress,
            frameAOpacity: currentOpacity,
            frameBOpacity: nextOpacity,
            activeEffects: {
              trace: config.trace.enabled,
              traceIntensity: config.trace.intensity,
              bloom: config.bloom.enabled,
              bloomIntensity: config.bloom.intensity,
              chromaticDrift: config.chromaticDrift.enabled,
              chromaticDriftIntensity: config.chromaticDrift.intensity,
              particles: config.particles.enabled,
              particleDensity: config.particles.density,
              kenBurns: config.kenBurns.enabled,
              kenBurnsMaxZoom: config.kenBurns.maxZoom,
            },
            audioAnalysis: scaledAudio,
            dna: morphState.currentDNA,
            imageUrls: {
              frameA: currentFrame.imageUrl,
              frameB: nextFrame?.imageUrl || null,
            },
          });
        }
      } else {
        // STATIC MODE (single frame)
        let staticDNA: number[];
        try {
          staticDNA = currentFrame.dnaVector 
            ? (typeof currentFrame.dnaVector === 'string' ? JSON.parse(currentFrame.dnaVector) : currentFrame.dnaVector)
            : Array(50).fill(0.5);
        } catch (e) {
          console.error('[Display] DNA parse error:', e, 'Raw value:', currentFrame.dnaVector);
          staticDNA = Array(50).fill(0.5);
        }
        
        const staticMorphState = morphEngineRef.current.getMorphState();
        
        rendererRef.current.render(
          currentFrame.imageUrl,
          currentFrame.imageUrl,
          staticMorphState,
          undefined
        );

        // ============================================================================
        // RENDER-ACK: Record impression for static frame (single frame mode)
        // FIX: Debounced to prevent API spam
        // ============================================================================
        
        if (currentFrame.artworkId && !lastRenderedArtworkIdsRef.current.has(currentFrame.artworkId)) {
          pendingRenderAcksRef.current.add(currentFrame.artworkId);
          lastRenderedArtworkIdsRef.current.add(currentFrame.artworkId);
          
          // Debounce render-ack API calls
          if (!renderAckTimerRef.current) {
            renderAckTimerRef.current = window.setTimeout(() => {
              flushRenderAcks();
              renderAckTimerRef.current = null;
            }, 1000); // Batch and send once per second max
          }
        }

        // Update debug stats for static mode (using ref to avoid render loop restart)
        if (showDebugOverlayRef.current) {
          const config = effectsConfigRef.current;
          setDebugStats({
            fps: currentFps,
            frameAOpacity: 1.0,
            frameBOpacity: 0,
            morphProgress: 0,
            zoomLevel: 1.0,
            activeEffects: {
              trace: config.trace.enabled,
              bloom: config.bloom.enabled,
              chromaticDrift: config.chromaticDrift.enabled,
              particles: config.particles.enabled,
              kenBurns: config.kenBurns.enabled,
            },
            shaderStatus: {
              coreReady: true,
              traceEnabled: config.trace.enabled,
              bloomEnabled: config.bloom.enabled,
              compositeEnabled: true,
            },
            audioMetrics: {
              bassLevel: 0,
              midsLevel: 0,
              trebleLevel: 0,
              beatBurst: 0,
            },
          });
        }
      }

      animationFrameRef.current = requestAnimationFrame(renderLoop);
    };

    // Always start render loop (shows frames even when paused)
    console.log('[RenderLoop] Starting render loop');
    animationFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, currentAudioAnalysis]);

  // Identify music from audio
  const identifyMusic = async () => {
    if (!audioAnalyzerRef.current) return null;
    
    try {
      setIsIdentifyingMusic(true);
      const audioBlob = await audioAnalyzerRef.current.captureAudioSample(5000);
      
      if (!audioBlob) {
        console.warn("Could not capture audio sample for music identification");
        setIsIdentifyingMusic(false);
        return null;
      }

      const arrayBuffer = await audioBlob.arrayBuffer();
      const res = await fetch("/api/identify-music", {
        method: "POST",
        headers: {
          "Content-Type": "audio/wav",
        },
        body: arrayBuffer,
      });

      if (!res.ok) {
        console.warn("Music identification failed:", res.statusText);
        setIsIdentifyingMusic(false);
        return null;
      }

      const data = await res.json();
      setIsIdentifyingMusic(false);
      
      if (data.musicInfo) {
        toast({
          title: "Music Identified",
          description: `${data.musicInfo.title} by ${data.musicInfo.artist}`,
        });
        return data.musicInfo;
      }
      
      return null;
    } catch (error) {
      console.error("Error identifying music:", error);
      setIsIdentifyingMusic(false);
      return null;
    }
  };

  // Handle audio analysis and art generation
  const handleAudioAnalysis = (analysis: AudioAnalysis) => {
    setCurrentAudioAnalysis(analysis);
    setAudioLevel(analysis.amplitude);
    setFrequencyBands({
      bass: analysis.bassLevel,
      mids: analysis.amplitude,
      highs: analysis.trebleLevel,
    });

    // Send to WebSocket for multi-device sync
    wsClientRef.current?.send('audio-analysis', analysis);

    // Use refs for reliable checking - prevent race conditions
    if (isGeneratingRef.current || generationTimeoutRef.current) {
      return;
    }

    // Check minimum time between generations using the ref
    const now = Date.now();
    const hasFrames = morphEngineRef.current && morphEngineRef.current.getFrameCount() > 0;
    const minInterval = hasFrames ? generationInterval * 60000 : 0;
    const timeSinceLastGen = now - lastGenerationTime.current;
    
    // Start generation 60 seconds before the interval ends so the image is ready at 00:00
    // (GPT-5 prompt generation + DALL-E image generation takes ~45-65 seconds)
    const generationLeadTime = Math.min(60000, minInterval); // Don't exceed interval
    const triggerTime = minInterval - generationLeadTime;
    
    if (timeSinceLastGen < triggerTime) {
      return; // Too soon
    }

    // Don't update lastGenerationTime here - let mutation success do it
    // Just set the flag to prevent race conditions
    isGeneratingRef.current = true;
    
    // Schedule new generation
    setIsGenerating(true);
    generationTimeoutRef.current = window.setTimeout(async () => {
      // CRITICAL: Reset MorphEngine and load 2 instant frames BEFORE generating new art
      // This ensures users see images immediately (no black screen while waiting for DALL-E)
      console.log('[Display] Resetting MorphEngine for new generation cycle');
      
      // Save current frames before reset (fallback if we can't load 2 new ones)
      const currentFrameCount = morphEngineRef.current.getFrameCount();
      const backupFrame = currentFrameCount > 0 ? morphEngineRef.current.getCurrentFrame() : null;
      
      // Helper: Generate fallback DNA vector if parsing fails
      const generateFallbackDNA = (): number[] => {
        return Array(50).fill(0).map(() => Math.random() * 3);
      };
      
      // Helper: Create placeholder gradient image for brand new users
      const createPlaceholderImage = (): string => {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d')!;
        
        // Create a purple gradient (matching brand color)
        const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
        gradient.addColorStop(0, '#9333ea');    // purple-600
        gradient.addColorStop(0.5, '#7c3aed');  // purple-700
        gradient.addColorStop(1, '#6b21a8');    // purple-800
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1024, 1024);
        
        return canvas.toDataURL('image/png');
      };
      
      // SAFETY: If no frames loaded yet (brand new user), create placeholder frames
      if (morphEngineRef.current.getFrameCount() === 0 && !recentArtworks?.length) {
        console.warn('[Display] ⚠️ First-run user - creating placeholder frames');
        
        const placeholderImage = createPlaceholderImage();
        const placeholderFrame = {
          imageUrl: placeholderImage,
          dnaVector: generateFallbackDNA(),
          prompt: 'Loading your first artwork...',
          explanation: 'Generating AI art based on audio analysis',
          artworkId: null,
          musicInfo: undefined,
          audioAnalysis: analysis,
        };
        
        // Add 2 placeholder frames with different DNA vectors
        morphEngineRef.current.addFrame(placeholderFrame);
        morphEngineRef.current.addFrame({
          ...placeholderFrame,
          dnaVector: generateFallbackDNA(), // Different DNA for variation
        });
        
        morphEngineRef.current.start();
        console.log('[Display] ✅ Placeholder frames active - waiting for DALL-E');
        
        // CRITICAL: Trigger generation for first-run users
        const musicInfo = await identifyMusic();
        generateArtMutation.mutate({ audioAnalysis: analysis, musicInfo });
        generationTimeoutRef.current = undefined;
        return;
      }
      
      // Trigger new artwork generation (smart sync will add it seamlessly)
      console.log('[Display] 🎨 Triggering timed generation - smart sync will add new frame without reset');
      const musicInfo = await identifyMusic();
      generateArtMutation.mutate({ audioAnalysis: analysis, musicInfo });
      generationTimeoutRef.current = undefined;
    }, 0);
  };

  const handleStartListening = () => {
    // BUG FIX #3: Activate wizard latch and advance to STYLE
    wizardActiveRef.current = true;
    setSetupStep(SetupStep.STYLE);
  };

  const handleAudioSourceConfirm = async (deviceId: string | undefined) => {
    // BUG FIX #3: Clear wizard latch AFTER successful audio initialization
    setSetupStep(SetupStep.COMPLETE);

    try {
      if (!audioAnalyzerRef.current) {
        const analyzer = new AudioAnalyzer();
        await analyzer.initialize(handleAudioAnalysis, deviceId);
        // Only assign after successful initialization
        audioAnalyzerRef.current = analyzer;
        
        // BUG FIX #3: Clear wizard latch after successful completion
        wizardActiveRef.current = false;
        
        setIsPlaying(true);
        toast({
          title: "Listening Started",
          description: "Creating art from the sounds around you...",
        });
      }
    } catch (error: any) {
      // BUG FIX #3: Clear latch on error to allow retry
      wizardActiveRef.current = false;
      audioAnalyzerRef.current = null;
      toast({
        title: "Microphone Access Denied",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleStopListening = () => {
    audioAnalyzerRef.current?.stop();
    audioAnalyzerRef.current = null;
    setIsPlaying(false);
    setAudioLevel(0);
    if (generationTimeoutRef.current) {
      clearTimeout(generationTimeoutRef.current);
      generationTimeoutRef.current = undefined;
    }
  };

  const handleVote = (vote: 1 | -1) => {
    voteMutation.mutate(vote);
    toast({
      title: vote === 1 ? "Liked!" : "Noted",
      description: vote === 1 
        ? "We'll create more art like this" 
        : "We'll adjust your preferences",
    });
  };

  const handleStylesChange = (styles: string[], isDynamicMode: boolean) => {
    setSelectedStyles(styles);
    setDynamicMode(isDynamicMode);
    
    // BUG FIX: CRITICAL - Immediate flush impressions before style switch
    // Prevents race condition where new frames are fetched before old impressions are recorded
    console.log('[Display] 🔥 Style change detected - immediate flush to prevent repeats');
    impressionRecorder.flush(true); // Immediate synchronous flush
    
    // BUG FIX: Clear old artwork from morphEngine when style changes
    // This prevents showing old "cartoon landscape" when user selects "landscape/Escher"
    console.log('[Display] 🧹 Clearing morphEngine frames for fresh artwork with new style');
    morphEngineRef.current.reset();
    
    // Clear render-ack tracking (prevent memory leak across sessions)
    lastRenderedArtworkIdsRef.current.clear();
    console.log('[Display] 🧹 Cleared render-ack tracking');
    
    // ============================================================================
    // CATALOGUE BRIDGE: Instant <100ms artwork display while fresh gen happens in background
    // ============================================================================
    
    // Abort any pending catalogue bridge request (prevents race conditions on rapid style changes)
    if (catalogueBridgeAbortRef.current) {
      console.log('[CatalogueBridge] Aborting pending request (style changed)');
      catalogueBridgeAbortRef.current.abort();
    }
    
    // Create new AbortController for this request
    catalogueBridgeAbortRef.current = new AbortController();
    const abortSignal = catalogueBridgeAbortRef.current.signal;
    
    // TELEMETRY: Record catalogue bridge request
    telemetryService.recordEvent('catalogue_bridge.request', {
      requestedStyles: styles,
      requestedOrientation: 'landscape',
      sessionId: sessionId.current,
    });
    
    // Fetch catalogue artworks immediately (target: <100ms)
    const bridgeStartTime = Date.now();
    fetch('/api/catalogue-bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: abortSignal,
      body: JSON.stringify({
        sessionId: sessionId.current,
        styleTags: styles,
        orientation: 'landscape', // TODO: Get from user preferences
        limit: 2,
      }),
    })
      .then(res => {
        if (!res.ok) {
          throw new Error(`Catalogue bridge failed: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data: { 
        artworks: ArtSession[]; 
        tier: 'exact' | 'related' | 'global' | 'procedural'; 
        latency: number;
        proceduralData?: any;
      }) => {
        const bridgeLatency = Date.now() - bridgeStartTime;
        console.log(`[CatalogueBridge] ✅ Retrieved ${data.artworks.length} artworks (tier: ${data.tier}, latency: ${data.latency}ms)`);
        
        // Tier mapping for telemetry and UX
        const tierMap = {
          exact: { priority: 1, event: 'catalogue_bridge.success' as const },
          related: { priority: 2, event: 'catalogue_bridge.fallback_tier_2' as const },
          global: { priority: 3, event: 'catalogue_bridge.fallback_tier_3' as const },
          procedural: { priority: 4, event: 'catalogue_bridge.fallback_tier_4' as const },
        };
        
        const tierInfo = tierMap[data.tier];
        telemetryService.recordEvent(tierInfo.event, {
          tier: tierInfo.priority,
          frameCount: data.artworks.length,
          latencyMs: data.latency,
        });
        
        // Set tier for badge UI (will auto-dismiss on next real frame swap)
        if (data.tier !== 'exact') {
          setCatalogueTier(data.tier);
        }
        
        // Add catalogue artworks to morphEngine for instant display
        for (const artwork of data.artworks) {
          let dnaVector = artwork.dnaVector 
            ? (JSON.parse(artwork.dnaVector) as number[])
            : Array(50).fill(0).map(() => Math.random() * 3);
          
          const audioFeatures = artwork.audioFeatures ? JSON.parse(artwork.audioFeatures) : null;
          const musicInfo = artwork.musicTrack ? {
            title: artwork.musicTrack,
            artist: artwork.musicArtist || '',
            album: artwork.musicAlbum || undefined,
          } : null;
          
          morphEngineRef.current.addFrame({
            imageUrl: artwork.imageUrl,
            dnaVector,
            prompt: artwork.prompt,
            explanation: artwork.generationExplanation || 'Catalogue bridge',
            artworkId: artwork.id,
            musicInfo,
            audioAnalysis: audioFeatures,
          });
          
          console.log(`[CatalogueBridge] 🎨 Added catalogue frame: ${artwork.id}`);
        }
        
        // Start morphEngine if not already running
        if (morphEngineRef.current.getFrameCount() > 0) {
          morphEngineRef.current.start();
          console.log(`[CatalogueBridge] 🚀 MorphEngine started with ${morphEngineRef.current.getFrameCount()} catalogue frames`);
        }
        
        // TODO: Track catalogue artwork IDs for render-ack (Task 7)
        // When frames are actually displayed, call POST /api/impressions/rendered with source='bridge'
      })
      .catch(error => {
        // Ignore abort errors (expected when styles change rapidly)
        if (error.name === 'AbortError') {
          console.log('[CatalogueBridge] Request aborted (style changed)');
          return;
        }
        
        // TELEMETRY: Record catalogue bridge error
        telemetryService.recordEvent('catalogue_bridge.error', {
          errorMessage: error.message || String(error),
        });
        
        console.error('[CatalogueBridge] Error fetching catalogue:', error);
        // Graceful degradation: Continue with normal flow, wait for fresh generation
      });
    
    // BUG FIX #3: Advance to AUDIO step (wizard remains latched until completion)
    setSetupStep(SetupStep.AUDIO);
    
    // Save preferences mutation (will refetch but latch prevents reset)
    savePreferencesMutation.mutate(
      { styles, dynamicMode: isDynamicMode },
      {
        onSuccess: () => {
          // Mark setup as complete after first-time user saves preferences
          if (!setupComplete) {
            console.log('[Display] First-time setup complete - enabling artwork loading');
            setSetupComplete(true);
          }
          
          // BUG FIX: Invalidate artwork cache to fetch fresh images with new style
          queryClient.invalidateQueries({ queryKey: ['/api/artworks/recent'] });
          queryClient.invalidateQueries({ queryKey: ['/api/artworks/library'] });
          console.log('[Display] 🔄 Artwork cache invalidated - fetching fresh images');
        }
      }
    );
  };

  // Navigation functions - only update index
  const goBack = () => {
    setHistoryIndex(prevIndex => {
      const newIndex = prevIndex - 1;
      if (newIndex >= 0) {
        historyIndexRef.current = newIndex;
        return newIndex;
      }
      return prevIndex;
    });
  };

  const goForward = () => {
    setHistoryIndex(prevIndex => {
      const newIndex = prevIndex + 1;
      if (newIndex < imageHistory.length) {
        historyIndexRef.current = newIndex;
        return newIndex;
      }
      return prevIndex;
    });
  };

  // Update display state when history index changes
  useEffect(() => {
    if (historyIndex >= 0 && historyIndex < imageHistory.length) {
      const historyItem = imageHistory[historyIndex];
      setCurrentImage(historyItem.imageUrl);
      setCurrentPrompt(historyItem.prompt);
      setCurrentExplanation(historyItem.explanation);
      setCurrentMusicInfo(historyItem.musicInfo);
      setCurrentAudioAnalysis(historyItem.audioAnalysis);
      setCurrentArtworkId(historyItem.artworkId);
      setCurrentArtworkSaved(historyItem.isSaved);
    }
  }, [historyIndex, imageHistory]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < imageHistory.length - 1;

  // Countdown timer for next generation
  useEffect(() => {
    if (!isPlaying) {
      setTimeUntilNext(0);
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const intervalMs = generationInterval * 60 * 1000;
      const timeSinceLastGen = now - lastGenerationTime.current;
      const timeRemaining = Math.max(0, intervalMs - timeSinceLastGen);
      setTimeUntilNext(Math.ceil(timeRemaining / 1000));
    };

    // Update immediately
    updateCountdown();

    // Update every second
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, generationInterval]);

  useEffect(() => {
    return () => {
      handleStopListening();
    };
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-background relative">
      {/* Art Canvas */}
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-background via-primary/5 to-background">
        {/* Morphing Canvas Container - PRIMARY DISPLAY */}
        <div 
          id="morphing-canvas-container"
          className="w-full h-full absolute inset-0 z-10"
        />
        {/* Audio reactive glow effect */}
        {morphEngineRef.current && morphEngineRef.current.getFrameCount() > 0 && (
          <div 
            className="absolute inset-0 pointer-events-none transition-shadow duration-300"
            style={{
              boxShadow: `inset 0 0 ${audioLevel * 2}px ${audioLevel * 1}px rgba(138, 80, 255, ${audioLevel / 200})`,
            }}
          />
        )}
        {!isPlaying && (
          <div className="flex flex-col items-center justify-center gap-6 max-w-lg px-4 text-center z-20 relative">
            <Sparkles className="h-20 w-20 text-primary" />
            <h1 className="text-4xl md:text-5xl font-bold">
              {morphEngineRef.current && morphEngineRef.current.getFrameCount() > 0 
                ? "Start Creating" 
                : "Ready to Create"}
            </h1>
            <p className="text-xl text-muted-foreground">
              {morphEngineRef.current && morphEngineRef.current.getFrameCount() > 0
                ? "Choose your preferences and start listening to create audio-reactive art"
                : selectedStyles.length === 0 
                  ? "Choose your artistic style to begin"
                  : "Start listening to generate beautiful audio-reactive art"}
            </p>
            <Button 
              size="lg" 
              onClick={handleStartListening}
              data-testid="button-start-creating"
            >
              {selectedStyles.length === 0 ? "Choose Styles" : "Start Creating"}
            </Button>
          </div>
        )}
      </div>

      {/* Loading Spinner Overlay - shown during validation/auto-generation (hidden during wizard) */}
      {isValidatingImages && setupStep !== SetupStep.STYLE && setupStep !== SetupStep.AUDIO && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-6">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary border-t-transparent"></div>
            <div className="text-center">
              <h3 className="text-2xl font-bold mb-2">Loading Artwork</h3>
              <p className="text-muted-foreground">Preparing beautiful art for you...</p>
            </div>
          </div>
        </div>
      )}

      {/* Top Control Bar */}
      <div 
        className={`fixed top-0 left-0 right-0 z-50 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="h-16 bg-background/80 backdrop-blur-xl border-b flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold hidden sm:inline">Algorhythmic</span>
            </div>
            
            {/* Daily Usage Indicator */}
            {usageStats && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30" data-testid="usage-indicator">
                <Zap className={`h-4 w-4 ${usageStats.remaining > 0 ? 'text-primary' : 'text-destructive'}`} />
                <span className="text-sm font-medium">
                  <span className={usageStats.remaining > 0 ? 'text-foreground' : 'text-destructive'}>
                    {usageStats.remaining}
                  </span>
                  <span className="text-muted-foreground">/{usageStats.limit}</span>
                  <span className="text-muted-foreground ml-1 hidden sm:inline">today</span>
                </span>
                {usageStats.remaining === 0 && (
                  <Link href="/subscribe">
                    <Button size="sm" variant="default" className="ml-2 h-6 text-xs" data-testid="button-upgrade">
                      Upgrade
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {selectedStyles.length > 0 && (
              <div className="hidden md:flex items-center gap-2 mr-4">
                {selectedStyles.slice(0, 3).map((style, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {style}
                  </Badge>
                ))}
                {selectedStyles.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{selectedStyles.length - 3} more
                  </Badge>
                )}
              </div>
            )}
            {isPlaying && (
              <>
                {/* AI Brain Indicator */}
                <div className="flex items-center gap-2 mr-2">
                  <Brain 
                    className={`h-4 w-4 text-primary transition-all duration-500 ${
                      isGenerating 
                        ? "animate-pulse scale-110" 
                        : "opacity-60"
                    }`}
                    data-testid="icon-ai-brain"
                  />
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {isGenerating ? "Generating..." : "Ready"}
                  </span>
                </div>
                
                {/* Frequency Meter */}
                <div className="flex items-center gap-3 mr-2 px-3 py-1.5 rounded-md bg-muted/30" data-testid="frequency-meter">
                  <div className="flex flex-col items-center gap-0.5 min-w-[32px]">
                    <div className="h-12 w-6 bg-background/50 rounded-sm flex flex-col-reverse gap-0.5 p-0.5 overflow-hidden">
                      <div 
                        className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-sm transition-all duration-75"
                        style={{ height: `${Math.min(Math.max(frequencyBands.bass, 2), 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">BASS</span>
                  </div>
                  
                  <div className="flex flex-col items-center gap-0.5 min-w-[32px]">
                    <div className="h-12 w-6 bg-background/50 rounded-sm flex flex-col-reverse gap-0.5 p-0.5 overflow-hidden">
                      <div 
                        className="w-full bg-gradient-to-t from-green-500 to-green-400 rounded-sm transition-all duration-75"
                        style={{ height: `${Math.min(Math.max(frequencyBands.mids, 2), 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">MIDS</span>
                  </div>
                  
                  <div className="flex flex-col items-center gap-0.5 min-w-[32px]">
                    <div className="h-12 w-6 bg-background/50 rounded-sm flex flex-col-reverse gap-0.5 p-0.5 overflow-hidden">
                      <div 
                        className="w-full bg-gradient-to-t from-purple-500 to-purple-400 rounded-sm transition-all duration-75"
                        style={{ height: `${Math.min(Math.max(frequencyBands.highs, 2), 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground font-medium">HIGHS</span>
                  </div>
                </div>

                {/* Countdown Timer Toggle */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowCountdown(!showCountdown)}
                  data-testid="button-toggle-countdown"
                  className="h-8 w-8"
                >
                  <Clock className={`h-4 w-4 ${showCountdown ? 'text-primary' : 'text-muted-foreground'}`} />
                </Button>
              </>
            )}
            
            {/* Debug Overlay Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowDebugOverlay(!showDebugOverlay)}
              data-testid="button-toggle-debug"
              className="h-8 w-8"
            >
              <Bug className={`h-4 w-4 ${showDebugOverlay ? 'text-green-400' : 'text-muted-foreground'}`} />
            </Button>
            
            {/* Effects Control Menu Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowEffectsMenu(!showEffectsMenu)}
              data-testid="button-toggle-effects"
              className="h-8 w-8"
            >
              <Palette className={`h-4 w-4 ${showEffectsMenu ? 'text-purple-400' : 'text-muted-foreground'}`} />
            </Button>
            
            {/* Morph Engine Selector */}
            <Select value={selectedEngine} onValueChange={setSelectedEngine}>
              <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-engine">
                <SelectValue placeholder="Select engine" />
              </SelectTrigger>
              <SelectContent>
                {EngineRegistry.getInstance().listEngines().map((engine) => (
                  <SelectItem key={engine.name} value={engine.name} data-testid={`engine-${engine.name}`}>
                    {engine.version} - {engine.description.split(' ').slice(0, 3).join(' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <ThemeToggle />
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => setSetupStep(SetupStep.STYLE)}
              data-testid="button-open-style-selector"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Tier Badge - shown when catalogue bridge uses fallback tier */}
      {catalogueTier && catalogueTier !== 'exact' && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50">
          <Badge 
            variant="secondary" 
            className="text-sm py-2 px-4 shadow-lg bg-background/90 backdrop-blur-md border-primary/30"
            data-testid="tier-badge"
          >
            {catalogueTier === 'related' && (
              <span>Showing a close match while we create your style...</span>
            )}
            {catalogueTier === 'global' && (
              <span>Showing similar artwork while we create your style...</span>
            )}
            {catalogueTier === 'procedural' && (
              <span>Loading a preview while we create your custom artwork...</span>
            )}
          </Badge>
        </div>
      )}

      {/* Bottom Control Bar */}
      <div 
        className={`fixed bottom-0 left-0 right-0 z-50 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="h-20 bg-background/80 backdrop-blur-xl border-t">
          <div className="h-full max-w-7xl mx-auto px-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => isPlaying ? handleStopListening() : handleStartListening()}
                data-testid="button-play-pause"
              >
                {isPlaying ? (
                  <MicOff className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </Button>
              
              <div className="flex items-center gap-2 min-w-[120px]">
                <VolumeX className="h-4 w-4 text-muted-foreground" />
                <Slider
                  value={volume}
                  onValueChange={setVolume}
                  max={100}
                  step={1}
                  className="w-24"
                  data-testid="slider-volume"
                />
                <Volume2 className="h-4 w-4 text-muted-foreground" />
              </div>

              {/* Generation Interval Selector */}
              <div className="flex items-center gap-2 border-l pl-4">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((minutes) => (
                    <Button
                      key={minutes}
                      variant={generationInterval === minutes ? "default" : "outline"}
                      size="sm"
                      className="h-7 w-8 p-0 text-xs"
                      onClick={() => setGenerationInterval(minutes)}
                      data-testid={`button-interval-${minutes}`}
                    >
                      {minutes}
                    </Button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground hidden sm:inline">min</span>
              </div>

              {currentPrompt && (
                <div className="hidden xl:block">
                  <Badge variant="outline" className="text-xs max-w-[300px] truncate">
                    {currentPrompt}
                  </Badge>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {morphEngineRef.current && morphEngineRef.current.getFrameCount() > 0 && (
              <div className="flex items-center gap-3">
                {/* History Navigation */}
                <div className="flex items-center gap-2 border-r pr-3">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-14 w-14"
                    onClick={goBack}
                    disabled={!canGoBack}
                    data-testid="button-nav-back"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-14 w-14"
                    onClick={goForward}
                    disabled={!canGoForward}
                    data-testid="button-nav-forward"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </Button>
                  {imageHistory.length > 0 && (
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {historyIndex + 1}/{imageHistory.length}
                    </span>
                  )}
                </div>

                {currentExplanation && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-14 w-14"
                    onClick={() => setShowExplanation(true)}
                    data-testid="button-show-explanation"
                  >
                    <Info className="h-6 w-6" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-14 w-14"
                  onClick={() => handleVote(-1)}
                  data-testid="button-downvote"
                >
                  <ThumbsDown className="h-6 w-6" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-14 w-14"
                  onClick={() => handleVote(1)}
                  data-testid="button-upvote"
                >
                  <ThumbsUp className="h-6 w-6" />
                </Button>
                {isAuthenticated && (
                  <Button
                    variant={currentArtworkSaved ? "default" : "outline"}
                    size="icon"
                    className="h-14 w-14"
                    onClick={() => saveArtworkMutation.mutate()}
                    disabled={saveArtworkMutation.isPending}
                    data-testid="button-save-artwork"
                  >
                    <Heart className={`h-6 w-6 ${currentArtworkSaved ? "fill-current" : ""}`} />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Metadata Overlay */}
      {morphEngineRef.current && morphEngineRef.current.getFrameCount() > 0 && currentAudioAnalysis && (
        <div 
          className={`fixed bottom-24 left-4 z-40 transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="bg-background/60 backdrop-blur-md rounded-md px-3 py-2 max-w-xs">
            {currentMusicInfo && (
              <div className="flex items-center gap-2 mb-1">
                <Music className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium truncate">
                  {currentMusicInfo.title} - {currentMusicInfo.artist}
                </p>
              </div>
            )}
            <p className="text-sm font-medium">Style: {selectedStyles[0] || "Mixed"}</p>
            <p className="text-xs text-muted-foreground">
              Mood: {currentAudioAnalysis.mood} · {new Date().toLocaleTimeString()}
            </p>
          </div>
        </div>
      )}

      {/* Countdown Timer Overlay */}
      {isPlaying && showCountdown && timeUntilNext > 0 && morphEngineRef.current && morphEngineRef.current.getFrameCount() > 0 && (
        <div className="fixed top-4 right-4 z-40">
          <div className="bg-background/80 backdrop-blur-md rounded-md px-3 py-2 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-lg font-mono text-foreground font-bold">
              {Math.floor(timeUntilNext / 60)}:{(timeUntilNext % 60).toString().padStart(2, '0')}
            </span>
          </div>
        </div>
      )}

      {/* Style Selector Modal - BUG FIX: Sequential flow via SetupStep enum */}
      {setupStep === SetupStep.STYLE && (
        <StyleSelector
          selectedStyles={selectedStyles}
          dynamicMode={dynamicMode}
          onStylesChange={handleStylesChange}
          onClose={() => {
            // BUG FIX: Return to IDLE instead of manually advancing to AUDIO
            // handleStylesChange will advance to AUDIO when user confirms
            setSetupStep(SetupStep.IDLE);
          }}
        />
      )}

      {/* Audio Source Selector Modal - BUG FIX: Sequential flow via SetupStep enum */}
      <AudioSourceSelector
        open={setupStep === SetupStep.AUDIO}
        onClose={() => setSetupStep(SetupStep.IDLE)}
        onConfirm={handleAudioSourceConfirm}
      />

      {/* Explanation Dialog */}
      <Dialog open={showExplanation} onOpenChange={setShowExplanation}>
        <DialogContent data-testid="dialog-explanation">
          <DialogHeader>
            <DialogTitle>Why This Artwork?</DialogTitle>
            <DialogDescription>
              Understanding the creative choices behind this generation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Music className="h-4 w-4 text-primary" />
                Music Detection
              </h4>
              {currentMusicInfo ? (
                <div className="rounded-md bg-muted p-3">
                  <p className="text-sm font-medium">{currentMusicInfo.title}</p>
                  <p className="text-sm text-muted-foreground">{currentMusicInfo.artist}</p>
                  {currentMusicInfo.album && (
                    <p className="text-xs text-muted-foreground mt-1">Album: {currentMusicInfo.album}</p>
                  )}
                </div>
              ) : (
                <div className="rounded-md bg-muted p-3">
                  <p className="text-sm text-muted-foreground italic">No music detected - artwork generated from ambient audio mood</p>
                </div>
              )}
            </div>
            
            {currentAudioAnalysis && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Audio Characteristics</h4>
                <div className="rounded-md bg-muted p-3 space-y-1">
                  <p className="text-sm">Mood: <span className="font-medium">{currentAudioAnalysis.mood}</span></p>
                  <p className="text-sm">Energy: <span className="font-medium">
                    {currentAudioAnalysis.amplitude > 70 ? "High" : currentAudioAnalysis.amplitude > 40 ? "Medium" : "Low"}
                  </span></p>
                  <p className="text-sm">Style: <span className="font-medium">{selectedStyles.join(", ")}</span></p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Creative Explanation</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {currentExplanation}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Debug Overlay */}
      {showDebugOverlay && (
        <DebugOverlay
          stats={debugStats}
          onClose={() => setShowDebugOverlay(false)}
          onDownloadLogs={() => effectLoggerRef.current.downloadLogs()}
        />
      )}

      {/* Effects Control Menu - temporarily removed pending MaestroControlStore/CommandBus refactor */}
      {/* {showEffectsMenu && (
        <EffectsControlMenu
          controlStore={controlStore}
          commandBus={commandBus}
          onClose={() => setShowEffectsMenu(false)}
        />
      )} */}

      {/* Dynamic Mode Controller - Handles catalog bridges on ALL style/track changes */}
      {setupComplete && (
        <DynamicModeController
          morphEngine={morphEngineRef.current}
          styleTags={selectedStyles}
          currentTrackId={currentMusicInfo ? `${currentMusicInfo.title}::${currentMusicInfo.artist}` : undefined}
          sessionId={sessionId.current}
          audioMeta={currentAudioAnalysis || undefined}
          onTransitionStart={() => {
            console.log('[Display] Catalog bridge transition starting...');
          }}
          onCatalogBridge={(artwork) => {
            console.log('[Display] Catalog bridge loaded:', artwork.id);
            // Record telemetry for catalog bridge
            effectLoggerRef.current.logBridgeRender('catalog', artwork.id);
          }}
          onProceduralBridge={() => {
            console.log('[Display] Procedural bridge (no catalog match)');
            // Record telemetry for procedural bridge
            effectLoggerRef.current.logBridgeRender('procedural', null);
          }}
          onTransitionComplete={(type, latency) => {
            console.log(`[Display] Transition complete: ${type} (${latency}ms)`);
            // Record telemetry
            effectLoggerRef.current.logTransition(type, latency);
          }}
        />
      )}
    </div>
  );
}
