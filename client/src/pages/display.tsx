import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
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
  Clock
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StyleSelector } from "@/components/style-selector";
import { AudioSourceSelector } from "@/components/audio-source-selector";
import { useToast } from "@/hooks/use-toast";
import { AudioAnalyzer } from "@/lib/audio-analyzer";
import { WebSocketClient } from "@/lib/websocket-client";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { AudioAnalysis, ArtVote, ArtPreference, MusicIdentification } from "@shared/schema";

export default function Display() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [volume, setVolume] = useState([80]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
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
  const [generationInterval, setGenerationInterval] = useState(1); // minutes
  
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
  const hideControlsTimeoutRef = useRef<number>();
  const generationTimeoutRef = useRef<number>();
  const musicIdentificationTimeoutRef = useRef<number>();
  const sessionId = useRef(crypto.randomUUID());
  const imageCache = useRef<Map<string, { imageUrl: string; prompt: string; explanation: string }>>(new Map());
  const lastGenerationTime = useRef<number>(0);
  const historyIndexRef = useRef<number>(-1);
  
  // Sync ref with state
  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);
  
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();

  // Fetch preferences on mount
  const { data: preferences } = useQuery<ArtPreference>({
    queryKey: [`/api/preferences/${sessionId.current}`],
  });

  useEffect(() => {
    if (preferences?.styles?.length) {
      setSelectedStyles(preferences.styles);
    }
  }, [preferences]);

  // Fetch voting history
  const { data: votes } = useQuery<ArtVote[]>({
    queryKey: [`/api/votes/${sessionId.current}`],
    enabled: isPlaying,
  });

  // Save preferences mutation
  const savePreferencesMutation = useMutation({
    mutationFn: async (styles: string[]) => {
      const res = await apiRequest("POST", "/api/preferences", {
        sessionId: sessionId.current,
        styles,
        artists: [],
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/preferences/${sessionId.current}`] });
    },
  });

  // Generate art mutation
  const generateArtMutation = useMutation({
    mutationFn: async ({ audioAnalysis, musicInfo }: { audioAnalysis: AudioAnalysis; musicInfo: MusicIdentification | null }) => {
      // Create cache key from styles and music info
      const cacheKey = `${selectedStyles.join(',')}-${musicInfo?.title || ''}-${musicInfo?.artist || ''}-${audioAnalysis.mood}`;
      
      // Check cache first
      const cached = imageCache.current.get(cacheKey);
      if (cached) {
        console.log('Using cached image for:', cacheKey);
        return { ...cached, session: { id: currentArtworkId, isSaved: currentArtworkSaved }, musicInfo };
      }
      
      // Generate new artwork
      const res = await apiRequest("POST", "/api/generate-art", {
        sessionId: sessionId.current,
        audioAnalysis,
        musicInfo,
        preferences: {
          styles: selectedStyles,
          artists: [],
        },
        previousVotes: votes?.slice(0, 10) || [],
      });
      const data = await res.json();
      
      // Cache the result (keep last 20 images)
      imageCache.current.set(cacheKey, {
        imageUrl: data.imageUrl,
        prompt: data.prompt,
        explanation: data.explanation
      });
      if (imageCache.current.size > 20) {
        const firstKey = imageCache.current.keys().next().value;
        if (firstKey) {
          imageCache.current.delete(firstKey);
        }
      }
      
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
      
      // Update current display
      setCurrentImage(data.imageUrl);
      setCurrentPrompt(data.prompt);
      setCurrentExplanation(data.explanation);
      setCurrentMusicInfo(data.musicInfo);
      setCurrentAudioAnalysis(variables.audioAnalysis);
      if (data.session) {
        setCurrentArtworkId(data.session.id);
        setCurrentArtworkSaved(data.session.isSaved || false);
      }
      setIsGenerating(false);
      // Note: lastGenerationTime is set before mutation starts in handleAudioAnalysis
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Could not generate artwork",
        variant: "destructive",
      });
      setIsGenerating(false);
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ["/api/gallery"] });
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
        if (currentImage) {
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
  }, [currentImage]);

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

    // Send to WebSocket for multi-device sync
    wsClientRef.current?.send('audio-analysis', analysis);

    // Prevent scheduling if already generating or timeout is pending
    if (isGenerating || generationTimeoutRef.current) {
      return;
    }

    // Check minimum time between generations using the ref
    const now = Date.now();
    const minInterval = currentImage ? generationInterval * 60000 : 0;
    const timeSinceLastGen = now - lastGenerationTime.current;
    
    if (timeSinceLastGen < minInterval) {
      return; // Too soon
    }

    // Mark the generation time NOW to prevent race conditions
    lastGenerationTime.current = now;
    
    // Schedule new generation
    setIsGenerating(true);
    generationTimeoutRef.current = window.setTimeout(async () => {
      // Try to identify music before generating art
      const musicInfo = await identifyMusic();
      generateArtMutation.mutate({ audioAnalysis: analysis, musicInfo });
      generationTimeoutRef.current = undefined;
    }, 0);
  };

  const handleStartListening = () => {
    if (selectedStyles.length === 0) {
      setShowStyleSelector(true);
      return;
    }

    // Show audio source selector modal
    setShowAudioSourceSelector(true);
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

  const handleStylesChange = (styles: string[]) => {
    setSelectedStyles(styles);
    savePreferencesMutation.mutate(styles);
  };

  // Navigation functions
  const goBack = () => {
    setHistoryIndex(prevIndex => {
      const newIndex = prevIndex - 1;
      if (newIndex >= 0 && newIndex < imageHistory.length) {
        const historyItem = imageHistory[newIndex];
        // Batch all state updates
        setCurrentImage(historyItem.imageUrl);
        setCurrentPrompt(historyItem.prompt);
        setCurrentExplanation(historyItem.explanation);
        setCurrentMusicInfo(historyItem.musicInfo);
        setCurrentAudioAnalysis(historyItem.audioAnalysis);
        setCurrentArtworkId(historyItem.artworkId);
        setCurrentArtworkSaved(historyItem.isSaved);
        return newIndex;
      }
      return prevIndex;
    });
  };

  const goForward = () => {
    setHistoryIndex(prevIndex => {
      const newIndex = prevIndex + 1;
      if (newIndex >= 0 && newIndex < imageHistory.length) {
        const historyItem = imageHistory[newIndex];
        // Batch all state updates
        setCurrentImage(historyItem.imageUrl);
        setCurrentPrompt(historyItem.prompt);
        setCurrentExplanation(historyItem.explanation);
        setCurrentMusicInfo(historyItem.musicInfo);
        setCurrentAudioAnalysis(historyItem.audioAnalysis);
        setCurrentArtworkId(historyItem.artworkId);
        setCurrentArtworkSaved(historyItem.isSaved);
        return newIndex;
      }
      return prevIndex;
    });
  };

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < imageHistory.length - 1;

  useEffect(() => {
    return () => {
      handleStopListening();
    };
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-background relative">
      {/* Art Canvas */}
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-background via-primary/5 to-background">
        {currentImage ? (
          <div className="relative w-full h-full">
            <img 
              src={currentImage} 
              alt="Generated artwork"
              className="w-full h-full object-cover"
            />
            {/* Audio reactive glow effect */}
            <div 
              className="absolute inset-0 pointer-events-none transition-shadow duration-300"
              style={{
                boxShadow: `inset 0 0 ${audioLevel * 2}px ${audioLevel * 1}px rgba(138, 80, 255, ${audioLevel / 200})`,
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-6 max-w-lg px-4 text-center">
            <Sparkles className="h-20 w-20 text-primary" />
            <h1 className="text-4xl md:text-5xl font-bold">Ready to Create</h1>
            <p className="text-xl text-muted-foreground">
              {selectedStyles.length === 0 
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
            {currentImage && (
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
      {currentImage && currentAudioAnalysis && (
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

      {/* Audio Level Indicator and AI Brain */}
      {isPlaying && (
        <div className="fixed top-20 right-4 z-40 flex flex-col gap-3">
          {/* AI Brain Indicator */}
          <div className="flex items-center justify-end">
            <div className="bg-background/60 backdrop-blur-md rounded-md px-3 py-2 flex items-center gap-2">
              <Brain 
                className={`h-5 w-5 text-primary transition-all duration-500 ${
                  isGenerating 
                    ? "animate-pulse scale-110" 
                    : "opacity-60"
                }`}
                data-testid="icon-ai-brain"
              />
              <span className="text-xs text-muted-foreground">
                {isGenerating ? "Generating..." : "AI Ready"}
              </span>
            </div>
          </div>

          {/* Audio Level Indicator */}
          <div className="flex items-center justify-end">
            <div className="bg-background/60 backdrop-blur-md rounded-md px-3 py-2 flex items-center gap-2">
              <div className="flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 h-6 rounded-full transition-colors ${
                      audioLevel > i * 20 ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">Listening</span>
            </div>
          </div>
        </div>
      )}

      {/* Style Selector Modal */}
      {showStyleSelector && (
        <StyleSelector
          selectedStyles={selectedStyles}
          onStylesChange={handleStylesChange}
          onClose={() => setShowStyleSelector(false)}
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
            {currentMusicInfo && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Music className="h-4 w-4 text-primary" />
                  Identified Music
                </h4>
                <div className="rounded-md bg-muted p-3">
                  <p className="text-sm font-medium">{currentMusicInfo.title}</p>
                  <p className="text-sm text-muted-foreground">{currentMusicInfo.artist}</p>
                  {currentMusicInfo.album && (
                    <p className="text-xs text-muted-foreground mt-1">Album: {currentMusicInfo.album}</p>
                  )}
                </div>
              </div>
            )}
            
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
    </div>
  );
}
