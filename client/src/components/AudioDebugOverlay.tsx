/**
 * Audio Debug Overlay
 * Displays BPM, beat phase, RMS/centroid bars, current stage, and cap warnings
 */

import { Card } from '@/components/ui/card';
import type { AudioSignals } from '@/lib/audio/AudioAnalyzer';
import type { MorphControls } from '@/lib/morphEngine';

interface AudioDebugOverlayProps {
  audioSignals: AudioSignals | null;
  controls: MorphControls | null;
  currentStage?: string;
  isVisible: boolean;
}

export function AudioDebugOverlay({
  audioSignals,
  controls,
  currentStage = 'unknown',
  isVisible
}: AudioDebugOverlayProps) {
  if (!isVisible || !audioSignals || !controls) {
    return null;
  }

  // Check if any caps are being hit
  const dispAmpCapped = controls.dispAmp >= controls.caps.maxDispAmp * 0.95;
  const tRateCapped = Math.abs(controls.tRate) >= controls.caps.maxTRate * 0.95;
  const sharpenCapped = controls.meshSharpen >= controls.caps.maxSharpen * 0.95;
  const anyCapped = dispAmpCapped || tRateCapped || sharpenCapped;

  return (
    <Card 
      className="fixed top-4 right-4 z-50 p-4 bg-background/90 backdrop-blur-sm border-primary/20"
      data-testid="audio-debug-overlay"
    >
      <div className="space-y-3 min-w-[280px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h3 className="text-sm font-semibold text-foreground">Audio Debug</h3>
          <span className="text-xs text-muted-foreground">
            {audioSignals.tempoBpm} BPM
          </span>
        </div>

        {/* Beat Phase */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Beat Phase</span>
            {audioSignals.barBoundary && (
              <span className="text-primary font-bold animate-pulse">BAR!</span>
            )}
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-75"
              style={{ width: `${audioSignals.beatPulse * 100}%` }}
            />
          </div>
        </div>

        {/* RMS Levels */}
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">RMS (instant)</span>
              <span className="text-foreground font-mono">
                {audioSignals.rms.toFixed(3)}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-100"
                style={{ width: `${audioSignals.rms * 100}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">RMS (slow)</span>
              <span className="text-foreground font-mono">
                {audioSignals.rmsSlow.toFixed(3)}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${audioSignals.rmsSlow * 100}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Centroid</span>
              <span className="text-foreground font-mono">
                {audioSignals.centroid.toFixed(3)}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 transition-all duration-200"
                style={{ width: `${audioSignals.centroid * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Morph Controls */}
        <div className="space-y-2 border-t border-border pt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Morph Progress (t)</span>
            <span className="text-foreground font-mono">
              {controls.t.toFixed(3)}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Stage</span>
            <span className="text-foreground font-semibold">
              {currentStage}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className={dispAmpCapped ? 'text-amber-500' : 'text-muted-foreground'}>
              <div>dispAmp</div>
              <div className="font-mono">
                {controls.dispAmp.toFixed(4)}
                {dispAmpCapped && ' ⚠'}
              </div>
            </div>

            <div className={sharpenCapped ? 'text-amber-500' : 'text-muted-foreground'}>
              <div>sharpen</div>
              <div className="font-mono">
                {controls.meshSharpen.toFixed(4)}
                {sharpenCapped && ' ⚠'}
              </div>
            </div>

            <div className="text-muted-foreground">
              <div>tpsLambda</div>
              <div className="font-mono">{controls.tpsLambda.toFixed(4)}</div>
            </div>

            <div className={tRateCapped ? 'text-amber-500' : 'text-muted-foreground'}>
              <div>tRate</div>
              <div className="font-mono">
                {controls.tRate.toFixed(4)}
                {tRateCapped && ' ⚠'}
              </div>
            </div>
          </div>
        </div>

        {/* Cap Warning */}
        {anyCapped && (
          <div className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
            ⚠ Safety caps active
          </div>
        )}
      </div>
    </Card>
  );
}
