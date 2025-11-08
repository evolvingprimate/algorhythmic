import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  ArrowLeft,
  Play,
  Pause,
  Settings,
  Activity,
  Brain,
  Music
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import { AudioProbe } from "@/lib/audio/AudioProbe";
import { MaestroLoop } from "@/lib/maestro/control/MaestroLoop";
import { FeatureBus } from "@/lib/maestro/control/FeatureBus";
import type { ClockState, AudioFeatures } from "@shared/maestroTypes";

export default function Maestro() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [tempo, setTempo] = useState(120);
  const [beatPhase, setBeatPhase] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioProbeRef = useRef<AudioProbe | null>(null);
  const maestroLoopRef = useRef<MaestroLoop | null>(null);
  const featureBusRef = useRef<FeatureBus | null>(null);
  const { toast } = useToast();

  // Initialize Maestro system
  useEffect(() => {
    // Create FeatureBus
    const featureBus = FeatureBus.getInstance();
    featureBusRef.current = featureBus;
    
    // Create MaestroLoop
    const maestroLoop = new MaestroLoop();
    maestroLoopRef.current = maestroLoop;
    
    // Subscribe MaestroLoop to FeatureBus
    featureBus.onClock((clock: ClockState) => {
      maestroLoop.updateClock(clock);
      setTempo(clock.tempo);
      setBeatPhase(clock.beatPhase);
      setConfidence(clock.confidence);
    });
    
    featureBus.onAudio((audio: AudioFeatures) => {
      maestroLoop.updateAudio(audio);
      setAudioLevel(audio.rms * 100);
    });
    
    // Create AudioProbe
    const audioProbe = new AudioProbe();
    audioProbeRef.current = audioProbe;
    
    // Wire AudioProbe to FeatureBus
    audioProbe.on("clock", (clock: ClockState) => {
      featureBus.publishClock(clock);
    });
    
    audioProbe.on("audio", (audio: AudioFeatures) => {
      featureBus.publishAudio(audio);
    });
    
    console.log("[Maestro] Initialized: AudioProbe → FeatureBus → MaestroLoop");
    
    return () => {
      audioProbe.stop();
      maestroLoop.stop();
      featureBus.cleanup();
    };
  }, []);

  // Auto-hide controls after 3 seconds of inactivity
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const resetTimeout = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowControls(false), 3000);
    };

    window.addEventListener("mousemove", resetTimeout);
    window.addEventListener("click", resetTimeout);
    resetTimeout();

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", resetTimeout);
      window.removeEventListener("click", resetTimeout);
    };
  }, []);

  const handlePlayPause = async () => {
    if (!isPlaying) {
      // Start
      try {
        await audioProbeRef.current?.initialize();
        maestroLoopRef.current?.start();
        setIsPlaying(true);
        toast({
          title: "Maestro Started",
          description: "Listening to audio and analyzing beats...",
        });
      } catch (error) {
        console.error("[Maestro] Failed to start:", error);
        toast({
          title: "Error",
          description: "Failed to access microphone. Please grant permission.",
          variant: "destructive",
        });
      }
    } else {
      // Stop
      audioProbeRef.current?.stop();
      maestroLoopRef.current?.stop();
      setIsPlaying(false);
      toast({
        title: "Maestro Paused",
        description: "Orchestration paused",
      });
    }
  };

  return (
    <div className="relative w-full h-screen bg-background overflow-hidden">
      {/* WebGL Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        data-testid="maestro-canvas"
      />

      {/* Header Controls (auto-hide) */}
      <div 
        className={`absolute top-0 left-0 right-0 p-4 flex items-center justify-between bg-gradient-to-b from-background/90 to-transparent transition-opacity duration-300 z-10 ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back-home">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Maestro</h1>
            <p className="text-xs text-muted-foreground">AI-Conducted Audio-Reactive Art</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            <Activity className="h-3 w-3" />
            <span className="text-xs">Phase 1+2 Demo</span>
          </Badge>
          <ThemeToggle />
        </div>
      </div>

      {/* Center Play/Pause Button */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <Button
          size="lg"
          variant="default"
          onClick={handlePlayPause}
          className={`pointer-events-auto transition-all duration-300 ${
            showControls ? "opacity-100 scale-100" : "opacity-0 scale-75"
          }`}
          data-testid="button-play-pause"
        >
          {isPlaying ? (
            <>
              <Pause className="h-5 w-5 mr-2" />
              Pause
            </>
          ) : (
            <>
              <Play className="h-5 w-5 mr-2" />
              Start Maestro
            </>
          )}
        </Button>
      </div>

      {/* Bottom Status Bar (auto-hide) */}
      <div 
        className={`absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background/90 to-transparent transition-opacity duration-300 z-10 ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between">
          {/* Left: System Status */}
          <div className="flex items-center gap-4">
            <Card className="bg-card/50 backdrop-blur-sm border-border/50">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Brain className="h-3 w-3" />
                  Maestro
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {isPlaying ? "Conducting..." : "Ready"}
                  </p>
                  {isPlaying && (
                    <p className="text-xs text-muted-foreground">
                      {tempo.toFixed(1)} BPM • Phase: {beatPhase.toFixed(2)}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur-sm border-border/50">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Music className="h-3 w-3" />
                  Audio
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {isPlaying ? "Analyzing..." : "Waiting"}
                  </p>
                  {isPlaying && (
                    <p className="text-xs text-muted-foreground">
                      Level: {audioLevel.toFixed(0)}% • Confidence: {(confidence * 100).toFixed(0)}%
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Settings */}
          <Button 
            variant="outline" 
            size="icon"
            data-testid="button-settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Development Notice */}
      <div className="absolute top-20 left-4 max-w-sm">
        <Card className="bg-card/80 backdrop-blur-sm border-border/50">
          <CardHeader className="p-4">
            <CardTitle className="text-sm">🚧 Phase 1+2 Demo</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-xs text-muted-foreground">
              Building Maestro orchestration layer with intelligent audio-reactive particle effects. 
              This demo showcases the foundation: audio analysis, command bus, and tempo-synchronized rendering.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
