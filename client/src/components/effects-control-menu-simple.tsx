import { useState, useEffect } from "react";
import { Palette, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface EffectsConfig {
  kenBurns: {
    enabled: boolean;
    intensity: number; // 0-2x zoom range
  };
  transitionSpeed: number; // 0.5x-2x speed multiplier
  blurIntensity: number; // 0-10 blur amount
  particleDensity: number; // 0-100% density
  bloomIntensity: number; // 0-100% intensity
  traceIntensity: number; // 0-100% intensity
}

interface EffectsControlMenuSimpleProps {
  config: EffectsConfig;
  onConfigChange: (config: EffectsConfig) => void;
  onClose: () => void;
}

const DEFAULT_CONFIG: EffectsConfig = {
  kenBurns: {
    enabled: true,
    intensity: 1.2,
  },
  transitionSpeed: 1.0,
  blurIntensity: 2,
  particleDensity: 70,
  bloomIntensity: 60,
  traceIntensity: 70,
};

export function EffectsControlMenuSimple({ 
  config, 
  onConfigChange,
  onClose 
}: EffectsControlMenuSimpleProps) {
  const [localConfig, setLocalConfig] = useState<EffectsConfig>(config);

  // Sync with parent config when it changes
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  // Save to localStorage whenever config changes
  useEffect(() => {
    localStorage.setItem('algorhythmic-effects-config', JSON.stringify(localConfig));
  }, [localConfig]);

  const updateConfig = (updates: Partial<EffectsConfig>) => {
    const newConfig = {
      ...localConfig,
      ...updates,
      kenBurns: {
        ...localConfig.kenBurns,
        ...(updates.kenBurns || {}),
      },
    };
    
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleReset = () => {
    setLocalConfig(DEFAULT_CONFIG);
    onConfigChange(DEFAULT_CONFIG);
    localStorage.removeItem('algorhythmic-effects-config');
  };

  return (
    <div 
      className="fixed right-0 top-0 h-full w-80 z-40 transform transition-transform duration-300 ease-in-out"
      data-testid="effects-control-menu"
    >
      <Card className="h-full bg-black/90 text-white backdrop-blur-md border-l border-purple-500/30 rounded-none shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-purple-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
                <Palette className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Effects Control</h3>
                <p className="text-xs text-gray-400">Real-time adjustments</p>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="text-white hover:bg-white/10"
              data-testid="button-close-effects"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto h-[calc(100%-140px)] p-6 space-y-6">
          {/* Ken Burns Effect */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-purple-300">Ken Burns Effect</Label>
              <Switch
                checked={localConfig.kenBurns.enabled}
                onCheckedChange={(checked) => 
                  updateConfig({ kenBurns: { ...localConfig.kenBurns, enabled: checked }})
                }
                data-testid="switch-kenburns"
              />
            </div>
            {localConfig.kenBurns.enabled && (
              <div className="space-y-2 pl-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Zoom Intensity</span>
                  <span>{localConfig.kenBurns.intensity.toFixed(1)}x</span>
                </div>
                <Slider
                  value={[localConfig.kenBurns.intensity * 50]}
                  onValueChange={([value]) => 
                    updateConfig({ kenBurns: { ...localConfig.kenBurns, intensity: value / 50 }})
                  }
                  max={100}
                  min={0}
                  step={5}
                  className="w-full"
                  data-testid="slider-kenburns-intensity"
                />
              </div>
            )}
          </div>

          {/* Transition Speed */}
          <div className="space-y-4">
            <Label className="text-sm font-semibold text-cyan-300">Transition Speed</Label>
            <div className="space-y-2 pl-2">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Speed Multiplier</span>
                <span>{localConfig.transitionSpeed.toFixed(1)}x</span>
              </div>
              <Slider
                value={[localConfig.transitionSpeed * 50]}
                onValueChange={([value]) => 
                  updateConfig({ transitionSpeed: value / 50 })
                }
                max={100}
                min={25}
                step={5}
                className="w-full"
                data-testid="slider-transition-speed"
              />
            </div>
          </div>

          {/* Blur Intensity */}
          <div className="space-y-4">
            <Label className="text-sm font-semibold text-blue-300">Blur Intensity</Label>
            <div className="space-y-2 pl-2">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Blur Amount</span>
                <span>{localConfig.blurIntensity.toFixed(0)}</span>
              </div>
              <Slider
                value={[localConfig.blurIntensity * 10]}
                onValueChange={([value]) => 
                  updateConfig({ blurIntensity: value / 10 })
                }
                max={100}
                min={0}
                step={5}
                className="w-full"
                data-testid="slider-blur-intensity"
              />
            </div>
          </div>

          {/* Particle Density */}
          <div className="space-y-4">
            <Label className="text-sm font-semibold text-pink-300">Particle Effects</Label>
            <div className="space-y-2 pl-2">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Density</span>
                <span>{localConfig.particleDensity.toFixed(0)}%</span>
              </div>
              <Slider
                value={[localConfig.particleDensity]}
                onValueChange={([value]) => 
                  updateConfig({ particleDensity: value })
                }
                max={100}
                min={0}
                step={5}
                className="w-full"
                data-testid="slider-particle-density"
              />
            </div>
          </div>

          {/* Bloom Intensity */}
          <div className="space-y-4">
            <Label className="text-sm font-semibold text-yellow-300">Bloom Effect</Label>
            <div className="space-y-2 pl-2">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Intensity</span>
                <span>{localConfig.bloomIntensity.toFixed(0)}%</span>
              </div>
              <Slider
                value={[localConfig.bloomIntensity]}
                onValueChange={([value]) => 
                  updateConfig({ bloomIntensity: value })
                }
                max={100}
                min={0}
                step={5}
                className="w-full"
                data-testid="slider-bloom-intensity"
              />
            </div>
          </div>

          {/* Trace Intensity */}
          <div className="space-y-4">
            <Label className="text-sm font-semibold text-green-300">Edge Trace</Label>
            <div className="space-y-2 pl-2">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Intensity</span>
                <span>{localConfig.traceIntensity.toFixed(0)}%</span>
              </div>
              <Slider
                value={[localConfig.traceIntensity]}
                onValueChange={([value]) => 
                  updateConfig({ traceIntensity: value })
                }
                max={100}
                min={0}
                step={5}
                className="w-full"
                data-testid="slider-trace-intensity"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-purple-500/20">
          <Button
            variant="outline"
            className="w-full border-purple-500/30 hover:bg-purple-500/10"
            onClick={handleReset}
            data-testid="button-reset-effects"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset to Defaults
          </Button>
        </div>
      </Card>
    </div>
  );
}

// Export default config for external use
export { DEFAULT_CONFIG };