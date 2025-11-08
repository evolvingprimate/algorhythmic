import { useState, useEffect } from "react";
import { Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import type { EffectPreferences } from "@/lib/maestro/control/MaestroControlStore";
import type { Command } from "@shared/maestroTypes";

interface EffectsControlMenuProps {
  controlStore: any; // MaestroControlStore instance
  commandBus: any;   // CommandBus instance
  onClose: () => void;
}

export function EffectsControlMenu({ 
  controlStore, 
  commandBus,
  onClose 
}: EffectsControlMenuProps) {
  const [prefs, setPrefs] = useState<EffectPreferences>(
    controlStore.getEffectPreferences()
  );

  // Sync with controlStore when component mounts
  useEffect(() => {
    setPrefs(controlStore.getEffectPreferences());
  }, [controlStore]);

  const updatePrefs = (updates: Partial<EffectPreferences>) => {
    const newPrefs = {
      ...prefs,
      ...updates,
      particles: { ...prefs.particles, ...updates.particles },
      warp: { ...prefs.warp, ...updates.warp },
      mixer: { ...prefs.mixer, ...updates.mixer },
      trace: { ...prefs.trace, ...updates.trace },
    };
    
    setPrefs(newPrefs);
    controlStore.updateEffectPreferences(updates);
    
    // Send SET commands to CommandBus for immediate effect
    sendUpdateCommands(updates);
  };

  const sendUpdateCommands = (updates: Partial<EffectPreferences>) => {
    const commands: Command[] = [];
    
    // Particle updates
    if (updates.particles) {
      if (updates.particles.spawnRateMultiplier !== undefined) {
        // Base spawnRate is 100, multiply by user preference
        const baseValue = 30; // Lower baseline (was 100)
        const value = baseValue * updates.particles.spawnRateMultiplier;
        commands.push({
          kind: "SET",
          path: "particles.main.spawnRate",
          value: updates.particles.enabled !== false ? value : 0,
        });
      }
      if (updates.particles.velocityMultiplier !== undefined) {
        commands.push({
          kind: "SET",
          path: "particles.main.velocity",
          value: updates.particles.enabled !== false 
            ? updates.particles.velocityMultiplier 
            : 0,
        });
      }
      if (updates.particles.sizeMultiplier !== undefined) {
        commands.push({
          kind: "SET",
          path: "particles.main.size",
          value: updates.particles.enabled !== false 
            ? updates.particles.sizeMultiplier 
            : 0.1,
        });
      }
      if (updates.particles.enabled !== undefined && !updates.particles.enabled) {
        // Disable particles completely
        commands.push({
          kind: "SET",
          path: "particles.main.spawnRate",
          value: 0,
        });
      }
    }
    
    // Warp updates
    if (updates.warp) {
      if (updates.warp.elasticityMultiplier !== undefined) {
        const baseValue = 0.3; // Lower baseline
        commands.push({
          kind: "SET",
          path: "warp.elasticity",
          value: updates.warp.enabled !== false 
            ? baseValue * updates.warp.elasticityMultiplier 
            : 0,
        });
      }
      if (updates.warp.radiusMultiplier !== undefined) {
        commands.push({
          kind: "SET",
          path: "warp.radius",
          value: updates.warp.enabled !== false 
            ? 0.3 * updates.warp.radiusMultiplier 
            : 0,
        });
      }
      if (updates.warp.enabled !== undefined && !updates.warp.enabled) {
        commands.push({
          kind: "SET",
          path: "warp.elasticity",
          value: 0,
        });
      }
    }
    
    // Mixer updates
    if (updates.mixer) {
      if (updates.mixer.saturationMultiplier !== undefined) {
        commands.push({
          kind: "SET",
          path: "mixer.saturation",
          value: updates.mixer.saturationMultiplier,
        });
      }
      if (updates.mixer.brightnessMultiplier !== undefined) {
        commands.push({
          kind: "SET",
          path: "mixer.brightness",
          value: updates.mixer.brightnessMultiplier,
        });
      }
      if (updates.mixer.contrastMultiplier !== undefined) {
        commands.push({
          kind: "SET",
          path: "mixer.contrast",
          value: updates.mixer.contrastMultiplier,
        });
      }
    }
    
    // Trace updates
    if (updates.trace) {
      if (updates.trace.strengthMultiplier !== undefined) {
        commands.push({
          kind: "SET",
          path: "trace.strength",
          value: updates.trace.enabled !== false 
            ? updates.trace.strengthMultiplier 
            : 0,
        });
      }
      if (updates.trace.enabled !== undefined && !updates.trace.enabled) {
        commands.push({
          kind: "SET",
          path: "trace.strength",
          value: 0,
        });
      }
    }
    
    // Enqueue all commands
    commands.forEach(cmd => {
      commandBus.enqueue(cmd);
    });
  };

  const handleReset = () => {
    controlStore.resetPreferences();
    const defaultPrefs = controlStore.getEffectPreferences();
    setPrefs(defaultPrefs);
    sendUpdateCommands(defaultPrefs);
  };

  return (
    <div className="fixed right-4 top-20 bottom-20 z-40 w-80" data-testid="effects-control-menu">
      <Card className="bg-black/95 text-white p-6 h-full overflow-y-auto backdrop-blur-sm border-purple-500/20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-red-500" />
            <h3 className="text-lg font-semibold">Maestro Controls</h3>
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
          {/* Particles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-purple-300">Particles</Label>
              <Checkbox
                checked={prefs.particles.enabled}
                onCheckedChange={(checked) => 
                  updatePrefs({ particles: { ...prefs.particles, enabled: checked as boolean }})
                }
                data-testid="checkbox-particles"
              />
            </div>
            {prefs.particles.enabled && (
              <div className="space-y-4 pl-2">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Spawn Rate</span>
                    <span>{Math.round(prefs.particles.spawnRateMultiplier * 100)}%</span>
                  </div>
                  <Slider
                    value={[prefs.particles.spawnRateMultiplier * 100]}
                    onValueChange={([value]) => 
                      updatePrefs({ particles: { ...prefs.particles, spawnRateMultiplier: value / 100 }})
                    }
                    max={200}
                    step={5}
                    data-testid="slider-particles-spawnrate"
                  />
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Velocity</span>
                    <span>{Math.round(prefs.particles.velocityMultiplier * 100)}%</span>
                  </div>
                  <Slider
                    value={[prefs.particles.velocityMultiplier * 100]}
                    onValueChange={([value]) => 
                      updatePrefs({ particles: { ...prefs.particles, velocityMultiplier: value / 100 }})
                    }
                    max={200}
                    step={5}
                    data-testid="slider-particles-velocity"
                  />
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Size</span>
                    <span>{Math.round(prefs.particles.sizeMultiplier * 100)}%</span>
                  </div>
                  <Slider
                    value={[prefs.particles.sizeMultiplier * 100]}
                    onValueChange={([value]) => 
                      updatePrefs({ particles: { ...prefs.particles, sizeMultiplier: value / 100 }})
                    }
                    max={200}
                    step={5}
                    data-testid="slider-particles-size"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Warp */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-cyan-300">Warp Distortion</Label>
              <Checkbox
                checked={prefs.warp.enabled}
                onCheckedChange={(checked) => 
                  updatePrefs({ warp: { ...prefs.warp, enabled: checked as boolean }})
                }
                data-testid="checkbox-warp"
              />
            </div>
            {prefs.warp.enabled && (
              <div className="space-y-4 pl-2">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Elasticity</span>
                    <span>{Math.round(prefs.warp.elasticityMultiplier * 100)}%</span>
                  </div>
                  <Slider
                    value={[prefs.warp.elasticityMultiplier * 100]}
                    onValueChange={([value]) => 
                      updatePrefs({ warp: { ...prefs.warp, elasticityMultiplier: value / 100 }})
                    }
                    max={200}
                    step={5}
                    data-testid="slider-warp-elasticity"
                  />
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Radius</span>
                    <span>{Math.round(prefs.warp.radiusMultiplier * 100)}%</span>
                  </div>
                  <Slider
                    value={[prefs.warp.radiusMultiplier * 100]}
                    onValueChange={([value]) => 
                      updatePrefs({ warp: { ...prefs.warp, radiusMultiplier: value / 100 }})
                    }
                    max={200}
                    step={5}
                    data-testid="slider-warp-radius"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Color Mixer */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold text-pink-300">Color Mixer</Label>
            <div className="space-y-4 pl-2">
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Saturation</span>
                  <span>{Math.round(prefs.mixer.saturationMultiplier * 100)}%</span>
                </div>
                <Slider
                  value={[prefs.mixer.saturationMultiplier * 100]}
                  onValueChange={([value]) => 
                    updatePrefs({ mixer: { ...prefs.mixer, saturationMultiplier: value / 100 }})
                  }
                  max={200}
                  step={5}
                  data-testid="slider-mixer-saturation"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Brightness</span>
                  <span>{Math.round(prefs.mixer.brightnessMultiplier * 100)}%</span>
                </div>
                <Slider
                  value={[prefs.mixer.brightnessMultiplier * 100]}
                  onValueChange={([value]) => 
                    updatePrefs({ mixer: { ...prefs.mixer, brightnessMultiplier: value / 100 }})
                  }
                  max={200}
                  step={5}
                  data-testid="slider-mixer-brightness"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Contrast</span>
                  <span>{Math.round(prefs.mixer.contrastMultiplier * 100)}%</span>
                </div>
                <Slider
                  value={[prefs.mixer.contrastMultiplier * 100]}
                  onValueChange={([value]) => 
                    updatePrefs({ mixer: { ...prefs.mixer, contrastMultiplier: value / 100 }})
                  }
                  max={200}
                  step={5}
                  data-testid="slider-mixer-contrast"
                />
              </div>
            </div>
          </div>

          {/* Trace */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-green-300">Edge Trace</Label>
              <Checkbox
                checked={prefs.trace.enabled}
                onCheckedChange={(checked) => 
                  updatePrefs({ trace: { ...prefs.trace, enabled: checked as boolean }})
                }
                data-testid="checkbox-trace"
              />
            </div>
            {prefs.trace.enabled && (
              <div className="space-y-2 pl-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Strength</span>
                  <span>{Math.round(prefs.trace.strengthMultiplier * 100)}%</span>
                </div>
                <Slider
                  value={[prefs.trace.strengthMultiplier * 100]}
                  onValueChange={([value]) => 
                    updatePrefs({ trace: { ...prefs.trace, strengthMultiplier: value / 100 }})
                  }
                  max={200}
                  step={5}
                  data-testid="slider-trace-strength"
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-white/10">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleReset}
            data-testid="button-reset-effects"
          >
            Reset to Defaults
          </Button>
        </div>
      </Card>
    </div>
  );
}
