import { useState, useEffect, useRef } from "react";
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
import { EffectsControlMenu, type EffectsConfig } from "@/components/effects-control-menu";
import { useToast } from "@/hooks/use-toast";
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
import type { AudioAnalysis, ArtVote, ArtPreference, MusicIdentification } from "@shared/schema";

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
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const [showAudioSourceSelector, setShowAudioSourceSelector] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [currentAudioAnalysis, setCurrentAudioAnalysis] = useState<AudioAnalysis | null>(null);
  const [currentArtworkId, setCurrentArtworkId] = useState<string | null>(null);
  const [currentArtworkSaved, setCurrentArtworkSaved] = useState(false);
  const [currentMusicInfo, setCurrentMusicInfo] = useState<MusicIdentification | null>(null);
  const [currentExplanation, setCurrentExplanation] = useState<string>("");
  const [showExplanation, setShowExplanation] = useState(false);
  const [isIdentifyingMusic, setIsIdentifyingMusic] = useState(false);
  const [generationInterval, setGenerationInterval] = useState(5); // minutes (Frame A to Frame B duration)
  const [timeUntilNext, setTimeUntilNext] = useState<number>(0); // seconds
  const [showCountdown, setShowCountdown] = useState(false); // hide countdown timer (using 5min morph cycle)
  const [selectedEngine, setSelectedEngine] = useState<string>(() => {
    const registry = EngineRegistry.getInstance();
    return registry.getDefaultEngine();
  });
  const [isValidatingImages, setIsValidatingImages] = useState(false); // show spinner during validation/auto-generation
  
  // Debug and Effects Control
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [showEffectsMenu, setShowEffectsMenu] = useState(false);
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
  const animationFrameRef = useRef<number | null>(null);
  const hideControlsTimeoutRef = useRef<number>();
  const generationTimeoutRef = useRef<number>();
  const musicIdentificationTimeoutRef = useRef<number>();
  const sessionId = useRef(crypto.randomUUID());
  const lastGenerationTime = useRef<number>(0);
  const historyIndexRef = useRef<number>(-1);
  const isGeneratingRef = useRef<boolean>(false);
  const isFallbackGeneratingRef = useRef<boolean>(false); // Guard to prevent infinite validation loop
  const effectLoggerRef = useRef<EffectLogger>(new EffectLogger());
  const showDebugOverlayRef = useRef<boolean>(false);
  const effectsConfigRef = useRef<EffectsConfig>(effectsConfig);
  
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
  const { data: preferences } = useQuery<ArtPreference>({
    queryKey: [`/api/preferences/${sessionId.current}`],
  });

  // Fetch user's most recent artwork (all artworks, not just saved ones)
  const { data: recentArtworks } = useQuery<any[]>({
    queryKey: ["/api/recent-artworks"],
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (preferences?.styles?.length) {
      setSelectedStyles(preferences.styles);
    }
    if (preferences?.dynamicMode !== undefined) {
      setDynamicMode(preferences.dynamicMode);
    }
  }, [preferences]);

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

  // Load multiple recent artworks on mount to enable morphing
  useEffect(() => {
    // CRITICAL GUARD: Prevent infinite loop during fallback generation
    if (isFallbackGeneratingRef.current) {
      console.log(`[Display] ⏸️ Skipping validation - fallback generation in progress`);
      return;
    }
    
    if (recentArtworks && recentArtworks.length > 0 && morphEngineRef.current.getFrameCount() === 0) {
      // Load and VALIDATE frames asynchronously
      const loadValidatedFrames = async () => {
        try {
          setIsValidatingImages(true); // Show loading spinner
          console.log(`[Display] 🔍 Starting smart validation (max 3 attempts)...`);
        
        // RANDOMIZE: Shuffle artworks for variety
        const shuffled = [...recentArtworks].sort(() => Math.random() - 0.5);
        
        // Track validated artworks for UI selection
        const validatedArtworks: typeof recentArtworks = [];
        
        // SMART BAILOUT: Try only 3 random images (don't exhaust entire library)
        const MAX_VALIDATION_ATTEMPTS = 3;
        let attemptCount = 0;
        
        for (let i = 0; i < shuffled.length && attemptCount < MAX_VALIDATION_ATTEMPTS; i++) {
          const artwork = shuffled[i];
          attemptCount++;
          
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
          
          console.log(`[Display] ✅ Loaded frame ${validatedArtworks.length}: ${artwork.prompt?.substring(0, 50)}...`);
        }
        
        // QUICK BAILOUT: If all 3 attempts failed, trigger seamless auto-generation
        if (validatedArtworks.length === 0) {
          console.error(`[Display] 🚨 BAILOUT: All ${MAX_VALIDATION_ATTEMPTS} validation attempts failed.`);
          console.error('[Display] Gallery validation failed after 3 attempts, generating fresh artwork');
          
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
  }, [recentArtworks, toast]);

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
    
    // Add new frames without resetting
    newArtworks.forEach(artwork => {
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
      
      console.log(`[Display] ✅ Smart sync prioritized fresh frame (next in queue): ${artwork.prompt?.substring(0, 50)}...`);
    });
    
    // CRITICAL: Enforce frame cap AFTER adding new frames
    const MAX_FRAMES = 20;
    const totalFrames = morphEngineRef.current.getFrameCount();
    
    if (totalFrames > MAX_FRAMES) {
      const framesToRemove = totalFrames - MAX_FRAMES;
      console.log(`[Display] 🗑️ Pruning ${framesToRemove} oldest frames to maintain ${MAX_FRAMES} frame cap (total: ${totalFrames})`);
      morphEngineRef.current.pruneOldestFrames(framesToRemove);
      console.log(`[Display] Smart sync complete. Frames after pruning: ${morphEngineRef.current.getFrameCount()}`);
    } else {
      console.log(`[Display] Smart sync complete. Total frames: ${totalFrames}`);
    }
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
      
      // CRITICAL: Invalidate recent artworks query to refresh pool for next reload
      queryClient.invalidateQueries({ queryKey: ["/api/recent-artworks"] });
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
      // Invalidate both gallery (saved only) and recent artworks (all artworks)
      queryClient.invalidateQueries({ queryKey: ["/api/gallery"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recent-artworks"] });
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

  // Initialize WebSocket
  useEffect(() => {
    wsClientRef.current = new WebSocketClient();
    wsClientRef.current.connect();

    wsClientRef.current.on('audio-update', (data) => {
      console.log('Received audio update from another device:', data);
    });

    return () => {
      wsClientRef.current?.disconnect();
    };
  }, []);

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
        // No frames loaded yet - UI shows "Ready to Create" message
        // (background gradient is visible, never black)
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
    // ALWAYS show style selector first, even if user has saved preferences
    // This lets them review/change their choices before starting
    setShowStyleSelector(true);
  };

  const handleAudioSourceConfirm = async (deviceId: string | undefined) => {
    setShowAudioSourceSelector(false);

    try {
      if (!audioAnalyzerRef.current) {
        const analyzer = new AudioAnalyzer();
        await analyzer.initialize(handleAudioAnalysis, deviceId);
        // Only assign after successful initialization
        audioAnalyzerRef.current = analyzer;
        
        setIsPlaying(true);
        toast({
          title: "Listening Started",
          description: "Creating art from the sounds around you...",
        });
      }
    } catch (error: any) {
      // Reset ref to allow retry
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
    savePreferencesMutation.mutate({ styles, dynamicMode: isDynamicMode });
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

      {/* Loading Spinner Overlay - shown during validation/auto-generation */}
      {isValidatingImages && (
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
              onClick={() => setShowStyleSelector(true)}
              data-testid="button-open-style-selector"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

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

      {/* Style Selector Modal */}
      {showStyleSelector && (
        <StyleSelector
          selectedStyles={selectedStyles}
          dynamicMode={dynamicMode}
          onStylesChange={handleStylesChange}
          onClose={() => {
            setShowStyleSelector(false);
            // After style selection, show audio source selector
            setShowAudioSourceSelector(true);
          }}
        />
      )}

      {/* Audio Source Selector Modal */}
      <AudioSourceSelector
        open={showAudioSourceSelector}
        onClose={() => setShowAudioSourceSelector(false)}
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

      {/* Effects Control Menu */}
      {showEffectsMenu && (
        <EffectsControlMenu
          config={effectsConfig}
          onChange={setEffectsConfig}
          onClose={() => setShowEffectsMenu(false)}
        />
      )}
    </div>
  );
}
