import { useState } from "react";
import { Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

export interface EffectsConfig {
  trace: {
    enabled: boolean;
    intensity: number; // 0-1
  };
  bloom: {
    enabled: boolean;
    intensity: number; // 0-1
  };
  chromaticDrift: {
    enabled: boolean;
    intensity: number; // 0-1
  };
  particles: {
    enabled: boolean;
    density: number; // 0-1
  };
  kenBurns: {
    enabled: boolean;
    maxZoom: number; // 1.0-1.5
  };
}

interface EffectsControlMenuProps {
  config: EffectsConfig;
  onChange: (config: EffectsConfig) => void;
  onClose: () => void;
}

export function EffectsControlMenu({ config, onChange, onClose }: EffectsControlMenuProps) {
  const updateEffect = <T extends keyof EffectsConfig>(
    effect: T,
    updates: Partial<EffectsConfig[T]>
  ) => {
    onChange({
      ...config,
      [effect]: {
        ...config[effect],
        ...updates,
      },
    });
  };

  return (
    <div className="fixed right-4 top-20 bottom-20 z-40 w-80" data-testid="effects-control-menu">
      <Card className="bg-black/95 text-white p-6 h-full overflow-y-auto backdrop-blur-sm border-purple-500/20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-red-500" />
            <h3 className="text-lg font-semibold">Effects Control</h3>
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

        <div className="space-y-6">
          {/* Trace Effect */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-purple-300">Trace Birthing</Label>
              <Checkbox
                checked={config.trace.enabled}
                onCheckedChange={(checked) => 
                  updateEffect('trace', { enabled: checked as boolean })
                }
                data-testid="checkbox-trace"
              />
            </div>
            {config.trace.enabled && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Intensity</span>
                  <span>{Math.round(config.trace.intensity * 100)}%</span>
                </div>
                <Slider
                  value={[config.trace.intensity * 100]}
                  onValueChange={([value]) => 
                    updateEffect('trace', { intensity: value / 100 })
                  }
                  max={100}
                  step={1}
                  data-testid="slider-trace-intensity"
                />
              </div>
            )}
          </div>

          {/* Bloom Effect */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-pink-300">Soft Bloom Glow</Label>
              <Checkbox
                checked={config.bloom.enabled}
                onCheckedChange={(checked) => 
                  updateEffect('bloom', { enabled: checked as boolean })
                }
                data-testid="checkbox-bloom"
              />
            </div>
            {config.bloom.enabled && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Intensity</span>
                  <span>{Math.round(config.bloom.intensity * 100)}%</span>
                </div>
                <Slider
                  value={[config.bloom.intensity * 100]}
                  onValueChange={([value]) => 
                    updateEffect('bloom', { intensity: value / 100 })
                  }
                  max={100}
                  step={1}
                  data-testid="slider-bloom-intensity"
                />
              </div>
            )}
          </div>

          {/* Chromatic Drift */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-cyan-300">Chromatic Drift</Label>
              <Checkbox
                checked={config.chromaticDrift.enabled}
                onCheckedChange={(checked) => 
                  updateEffect('chromaticDrift', { enabled: checked as boolean })
                }
                data-testid="checkbox-chromatic"
              />
            </div>
            {config.chromaticDrift.enabled && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Intensity</span>
                  <span>{Math.round(config.chromaticDrift.intensity * 100)}%</span>
                </div>
                <Slider
                  value={[config.chromaticDrift.intensity * 100]}
                  onValueChange={([value]) => 
                    updateEffect('chromaticDrift', { intensity: value / 100 })
                  }
                  max={100}
                  step={1}
                  data-testid="slider-chromatic-intensity"
                />
              </div>
            )}
          </div>

          {/* Particles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-yellow-300">Particles</Label>
              <Checkbox
                checked={config.particles.enabled}
                onCheckedChange={(checked) => 
                  updateEffect('particles', { enabled: checked as boolean })
                }
                data-testid="checkbox-particles"
              />
            </div>
            {config.particles.enabled && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Density</span>
                  <span>{Math.round(config.particles.density * 100)}%</span>
                </div>
                <Slider
                  value={[config.particles.density * 100]}
                  onValueChange={([value]) => 
                    updateEffect('particles', { density: value / 100 })
                  }
                  max={100}
                  step={1}
                  data-testid="slider-particles-density"
                />
              </div>
            )}
          </div>

          {/* Ken Burns Zoom */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-green-300">Ken Burns Zoom</Label>
              <Checkbox
                checked={config.kenBurns.enabled}
                onCheckedChange={(checked) => 
                  updateEffect('kenBurns', { enabled: checked as boolean })
                }
                data-testid="checkbox-kenburns"
              />
            </div>
            {config.kenBurns.enabled && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Max Zoom</span>
                  <span>{(config.kenBurns.maxZoom * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[config.kenBurns.maxZoom * 100]}
                  onValueChange={([value]) => 
                    updateEffect('kenBurns', { maxZoom: value / 100 })
                  }
                  min={100}
                  max={150}
                  step={1}
                  data-testid="slider-kenburns-zoom"
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-white/10">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              // Reset to defaults
              onChange({
                trace: { enabled: true, intensity: 0.7 },
                bloom: { enabled: true, intensity: 0.6 },
                chromaticDrift: { enabled: true, intensity: 0.5 },
                particles: { enabled: true, density: 0.7 },
                kenBurns: { enabled: true, maxZoom: 1.2 },
              });
            }}
            data-testid="button-reset-effects"
          >
            Reset to Defaults
          </Button>
        </div>
      </Card>
    </div>
  );
}
