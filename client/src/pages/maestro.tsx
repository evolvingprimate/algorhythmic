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
import { CommandBus } from "@/lib/maestro/control/CommandBus";
import { Scheduler } from "@/lib/maestro/control/Scheduler";
import { ParameterRegistry } from "@/lib/maestro/control/ParameterRegistry";
import { MaestroControlStore } from "@/lib/maestro/control/MaestroControlStore";
import { MaestroBrain } from "@/lib/maestro/brain/MaestroBrain";
import { RendererManager } from "@/lib/RendererManager";
import { EffectsControlMenu } from "@/components/effects-control-menu";
import type { ClockState, AudioFeatures, Command } from "@shared/maestroTypes";

export default function Maestro() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showEffectsMenu, setShowEffectsMenu] = useState(false);
  const [tempo, setTempo] = useState(120);
  const [beatPhase, setBeatPhase] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioProbeRef = useRef<AudioProbe | null>(null);
  const maestroLoopRef = useRef<MaestroLoop | null>(null);
  const maestroBrainRef = useRef<MaestroBrain | null>(null);
  const featureBusRef = useRef<FeatureBus | null>(null);
  const commandBusRef = useRef<CommandBus | null>(null);
  const schedulerRef = useRef<Scheduler | null>(null);
  const paramRegistryRef = useRef<ParameterRegistry | null>(null);
  const rendererManagerRef = useRef<RendererManager | null>(null);
  const controlStoreRef = useRef<MaestroControlStore | null>(null);
  const { toast } = useToast();

  // Initialize Maestro system
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Initialize WebGL
    const gl = canvas.getContext("webgl2");
    if (!gl) {
      console.error("[Maestro] WebGL2 not supported");
      toast({
        title: "WebGL2 Not Supported",
        description: "Your browser does not support WebGL2",
        variant: "destructive",
      });
      return;
    }
    
    // Create FeatureBus
    const featureBus = FeatureBus.getInstance();
    featureBusRef.current = featureBus;
    
    // Create CommandBus
    const commandBus = new CommandBus();
    commandBusRef.current = commandBus;
    
    // Create ParameterRegistry
    const paramRegistry = new ParameterRegistry();
    paramRegistryRef.current = paramRegistry;
    
    // Create MaestroControlStore
    const controlStore = new MaestroControlStore();
    controlStoreRef.current = controlStore;
    
    // Create Scheduler
    const scheduler = new Scheduler(commandBus);
    schedulerRef.current = scheduler;
    
    // Create RendererManager (using canvas parent as container)
    const container = canvas.parentElement;
    if (!container) {
      console.error("[Maestro] Canvas has no parent element");
      return;
    }
    container.id = 'maestro-container';
    canvas.id = 'maestro-canvas';
    const rendererManager = new RendererManager('maestro-container', 'morpheus_0.5');
    rendererManagerRef.current = rendererManager;
    
    // Create MaestroLoop
    const maestroLoop = new MaestroLoop();
    maestroLoopRef.current = maestroLoop;
    
    // Wire dependencies to MaestroLoop
    maestroLoop.setDependencies(controlStore, commandBus);

    // PHASE 2: Create MaestroBrain for intelligent learning
    const maestroBrain = new MaestroBrain(undefined, 60); // No userId, 60min lookback
    maestroBrainRef.current = maestroBrain;
    maestroLoop.setMaestroBrain(maestroBrain); // Wire brain into loop
    
    // Subscribe MaestroLoop to FeatureBus and generate commands
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
    
    // MaestroLoop now handles onset events internally with user preferences
    featureBus.on("onset", () => {
      maestroLoop.onOnset();
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
      // MaestroLoop handles audio-reactive mixer controls with user preferences
    });
    
    // Initialize Maestro parameters from ControlStore preferences
    const prefs = controlStore.getEffectPreferences();
    commandBus.enqueue({ kind: 'SET', path: 'mixer.saturation', value: prefs.mixer.saturationMultiplier });
    commandBus.enqueue({ kind: 'SET', path: 'mixer.brightness', value: prefs.mixer.brightnessMultiplier });
    commandBus.enqueue({ kind: 'SET', path: 'mixer.contrast', value: prefs.mixer.contrastMultiplier });
    commandBus.enqueue({ kind: 'SET', path: 'warp.elasticity', value: prefs.warp.enabled ? 0.3 * prefs.warp.elasticityMultiplier : 0 });
    commandBus.enqueue({ kind: 'SET', path: 'warp.radius', value: prefs.warp.enabled ? 0.3 * prefs.warp.radiusMultiplier : 0 });
    commandBus.enqueue({ kind: 'SET', path: 'particles.main.spawnRate', value: prefs.particles.enabled ? 30 * prefs.particles.spawnRateMultiplier : 0 });
    commandBus.enqueue({ kind: 'SET', path: 'particles.main.velocity', value: prefs.particles.enabled ? prefs.particles.velocityMultiplier : 0 });
    commandBus.enqueue({ kind: 'SET', path: 'particles.main.size', value: prefs.particles.enabled ? prefs.particles.sizeMultiplier : 0.1 });
    commandBus.enqueue({ kind: 'SET', path: 'particles.main.trailLength', value: 0.5 });
    commandBus.enqueue({ kind: 'SET', path: 'particles.main.colorBias', value: [1.0, 1.0, 1.0] });
    commandBus.enqueue({ kind: 'SET', path: 'trace.strength', value: prefs.trace.enabled ? prefs.trace.strengthMultiplier : 0 });
    
    console.log("[Maestro] Initialized: Full pipeline ready with parameter defaults");
    
    return () => {
      audioProbe.stop();
      maestroLoop.stop();
      scheduler.stop();
      rendererManager.destroy();
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
        maestroBrainRef.current?.start(); // PHASE 2: Start learning
        // Start scheduler with callback to RendererManager
        schedulerRef.current?.start((commands: Command[]) => {
          rendererManagerRef.current?.dispatchCommands(commands);
        });
        setIsPlaying(true);
        toast({
          title: "Maestro Started",
          description: "Audio-reactive particles + AI learning activated!",
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
      maestroBrainRef.current?.stop(); // PHASE 2: Stop learning
      schedulerRef.current?.stop();
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
            onClick={() => setShowEffectsMenu(!showEffectsMenu)}
            data-testid="button-settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Effects Control Menu */}
      {showEffectsMenu && controlStoreRef.current && commandBusRef.current && (
        <EffectsControlMenu
          controlStore={controlStoreRef.current}
          commandBus={commandBusRef.current}
          onClose={() => setShowEffectsMenu(false)}
        />
      )}

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
