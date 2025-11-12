import { useEffect, useState } from "react";
import { Bug, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface DebugStats {
  fps: number;
  frameAOpacity: number;
  frameBOpacity: number;
  morphProgress: number;
  zoomLevel: number;
  activeEffects: {
    trace: boolean;
    bloom: boolean;
    chromaticDrift: boolean;
    particles: boolean;
    kenBurns: boolean;
  };
  shaderStatus: {
    coreReady: boolean;
    traceEnabled: boolean;
    bloomEnabled: boolean;
    compositeEnabled: boolean;
  };
  audioMetrics: {
    bassLevel: number;
    midsLevel: number;
    trebleLevel: number;
    beatBurst: number;
  };
}

interface DebugOverlayProps {
  stats: DebugStats;
  onClose: () => void;
  onDownloadLogs: () => void;
}

export function DebugOverlay({ stats, onClose, onDownloadLogs }: DebugOverlayProps) {
  const [localFps, setLocalFps] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setLocalFps(stats.fps);
    }, 100);
    return () => clearInterval(interval);
  }, [stats.fps]);

  return (
    <div className="fixed bottom-4 left-4 z-50 pointer-events-none" data-testid="debug-overlay">
      <Card className="bg-black/80 text-white p-4 max-w-sm pointer-events-auto backdrop-blur-sm border-purple-500/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bug className="w-5 h-5 text-green-400" />
            <h3 className="text-sm font-semibold">Debug Overlay</h3>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onDownloadLogs}
              className="text-white hover:bg-white/10"
              data-testid="button-download-logs"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Logs
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="text-white hover:bg-white/10"
              data-testid="button-close-debug"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          {/* Performance */}
          <div>
            <h4 className="text-green-400 font-semibold mb-2">Performance</h4>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-400">FPS:</span>
                <span className={`font-mono ${localFps < 30 ? 'text-red-400' : localFps < 50 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {localFps.toFixed(1)}
                </span>
              </div>
            </div>
          </div>

          {/* Frame State */}
          <div>
            <h4 className="text-blue-400 font-semibold mb-2">Frame State</h4>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-400">Frame A:</span>
                <span className="font-mono">{(stats.frameAOpacity * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Frame B:</span>
                <span className="font-mono">{(stats.frameBOpacity * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Morph:</span>
                <span className="font-mono">{(stats.morphProgress * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>

          {/* Effects */}
          <div>
            <h4 className="text-purple-400 font-semibold mb-2">Active Effects</h4>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-400">Trace:</span>
                <span className={stats.activeEffects.trace ? 'text-green-400' : 'text-gray-600'}>
                  {stats.activeEffects.trace ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Bloom:</span>
                <span className={stats.activeEffects.bloom ? 'text-green-400' : 'text-gray-600'}>
                  {stats.activeEffects.bloom ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Chromatic:</span>
                <span className={stats.activeEffects.chromaticDrift ? 'text-green-400' : 'text-gray-600'}>
                  {stats.activeEffects.chromaticDrift ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Particles:</span>
                <span className={stats.activeEffects.particles ? 'text-green-400' : 'text-gray-600'}>
                  {stats.activeEffects.particles ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>
          </div>

          {/* Audio */}
          <div>
            <h4 className="text-yellow-400 font-semibold mb-2">Audio Metrics</h4>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-400">Bass:</span>
                <span className="font-mono">{(stats.audioMetrics.bassLevel * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Mids:</span>
                <span className="font-mono">{(stats.audioMetrics.midsLevel * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Treble:</span>
                <span className="font-mono">{(stats.audioMetrics.trebleLevel * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Beat:</span>
                <span className={`font-mono ${stats.audioMetrics.beatBurst > 0.5 ? 'text-red-400 font-bold' : ''}`}>
                  {(stats.audioMetrics.beatBurst * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Shader Status */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <h4 className="text-cyan-400 font-semibold mb-2 text-xs">Shader Status</h4>
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${stats.shaderStatus.coreReady ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-gray-400">Core Ready</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${stats.shaderStatus.traceEnabled ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span className="text-gray-400">Trace Shader</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${stats.shaderStatus.bloomEnabled ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span className="text-gray-400">Bloom Shader</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${stats.shaderStatus.compositeEnabled ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span className="text-gray-400">Composite Shader</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${stats.activeEffects.kenBurns ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
              <span className="text-gray-400">Ken Burns (Zoom: {(stats.zoomLevel * 100).toFixed(0)}%)</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
