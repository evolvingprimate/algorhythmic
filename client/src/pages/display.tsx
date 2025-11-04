import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { 
  ThumbsUp, 
  ThumbsDown, 
  Settings, 
  Sparkles,
  Volume2,
  VolumeX,
  Pause,
  Play,
  ArrowLeft
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StyleSelector } from "@/components/style-selector";
import { useToast } from "@/hooks/use-toast";
import { AudioAnalyzer } from "@/lib/audio-analyzer";
import { WebSocketClient } from "@/lib/websocket-client";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AudioAnalysis, ArtVote } from "@shared/schema";

export default function Display() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [volume, setVolume] = useState([80]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [currentAudioAnalysis, setCurrentAudioAnalysis] = useState<AudioAnalysis | null>(null);
  
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const hideControlsTimeoutRef = useRef<number>();
  const generationTimeoutRef = useRef<number>();
  const sessionId = useRef(crypto.randomUUID());
  
  const { toast } = useToast();

  // Fetch preferences on mount
  const { data: preferences } = useQuery({
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
    mutationFn: async (audioAnalysis: AudioAnalysis) => {
      const res = await apiRequest("POST", "/api/generate-art", {
        sessionId: sessionId.current,
        audioAnalysis,
        preferences: {
          styles: selectedStyles,
          artists: [],
        },
        previousVotes: votes?.slice(0, 10) || [],
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCurrentImage(data.imageUrl);
      setCurrentPrompt(data.prompt);
      setIsGenerating(false);
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

  // Handle audio analysis and art generation
  const handleAudioAnalysis = (analysis: AudioAnalysis) => {
    setCurrentAudioAnalysis(analysis);
    setAudioLevel(analysis.amplitude);

    // Send to WebSocket for multi-device sync
    wsClientRef.current?.send('audio-analysis', analysis);

    // Generate new art every 10-15 seconds based on audio changes
    if (!isGenerating && !generationTimeoutRef.current) {
      generationTimeoutRef.current = window.setTimeout(() => {
        setIsGenerating(true);
        generateArtMutation.mutate(analysis);
        generationTimeoutRef.current = undefined;
      }, currentImage ? 12000 : 0); // First generation immediate, then every 12s
    }
  };

  const handleStartListening = async () => {
    if (selectedStyles.length === 0) {
      setShowStyleSelector(true);
      return;
    }

    try {
      if (!audioAnalyzerRef.current) {
        audioAnalyzerRef.current = new AudioAnalyzer();
        await audioAnalyzerRef.current.initialize(handleAudioAnalysis);
      }
      setIsPlaying(true);
      
      toast({
        title: "Listening Started",
        description: "Creating art from the sounds around you...",
      });
    } catch (error: any) {
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
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
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

              {currentPrompt && (
                <div className="hidden lg:block">
                  <Badge variant="outline" className="text-xs max-w-[300px] truncate">
                    {currentPrompt}
                  </Badge>
                </div>
              )}
            </div>

            {/* Vote Buttons */}
            {currentImage && (
              <div className="flex items-center gap-3">
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
            <p className="text-sm font-medium">Style: {selectedStyles[0] || "Mixed"}</p>
            <p className="text-xs text-muted-foreground">
              Mood: {currentAudioAnalysis.mood} · {new Date().toLocaleTimeString()}
            </p>
          </div>
        </div>
      )}

      {/* Audio Level Indicator */}
      {isPlaying && (
        <div className="fixed top-20 right-4 z-40">
          <div className="flex items-center gap-2 bg-background/60 backdrop-blur-md rounded-md px-3 py-2">
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
      )}

      {/* Style Selector Modal */}
      {showStyleSelector && (
        <StyleSelector
          selectedStyles={selectedStyles}
          onStylesChange={handleStylesChange}
          onClose={() => setShowStyleSelector(false)}
        />
      )}

      {/* Loading Overlay */}
      {isGenerating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin h-12 w-12 border-4 border-primary border-t-transparent rounded-full" />
            <p className="text-lg font-medium">Creating your masterpiece...</p>
            <p className="text-sm text-muted-foreground">Analyzing audio and generating art</p>
          </div>
        </div>
      )}
    </div>
  );
}
