import { useState, useEffect, useCallback } from "react";

export interface LoadingProgress {
  stage: 'idle' | 'fetching' | 'validating' | 'prewarming' | 'rendering' | 'complete' | 'error';
  progress: number;
  message: string;
  subMessage?: string;
  error?: string;
}

interface UseArtworkLoadingProgressProps {
  onStageChange?: (stage: LoadingProgress['stage']) => void;
  autoComplete?: boolean;
}

export function useArtworkLoadingProgress({
  onStageChange,
  autoComplete = true
}: UseArtworkLoadingProgressProps = {}) {
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress>({
    stage: 'idle',
    progress: 0,
    message: ''
  });

  const [stageStartTime, setStageStartTime] = useState<number>(0);

  // Update stage with automatic progress tracking
  const updateStage = useCallback((
    stage: LoadingProgress['stage'],
    message: string,
    subMessage?: string,
    initialProgress?: number
  ) => {
    console.log(`[ArtworkLoadingProgress] Stage: ${stage}, Message: ${message}`);
    
    setStageStartTime(Date.now());
    setLoadingProgress({
      stage,
      progress: initialProgress ?? 0,
      message,
      subMessage
    });
    
    if (onStageChange) {
      onStageChange(stage);
    }
  }, [onStageChange]);

  // Update progress within current stage
  const updateProgress = useCallback((progress: number, subMessage?: string) => {
    setLoadingProgress(prev => ({
      ...prev,
      progress: Math.min(100, Math.max(0, progress)),
      ...(subMessage && { subMessage })
    }));
  }, []);

  // Set error state
  const setError = useCallback((error: string, message?: string) => {
    console.error('[ArtworkLoadingProgress] Error:', error);
    setLoadingProgress({
      stage: 'error',
      progress: 0,
      message: message || 'Failed to load artwork',
      error
    });
  }, []);

  // Reset to idle state
  const reset = useCallback(() => {
    setLoadingProgress({
      stage: 'idle',
      progress: 0,
      message: ''
    });
  }, []);

  // Helper methods for common loading stages
  const startFetching = useCallback((count?: number) => {
    const message = count 
      ? `Fetching ${count} artwork${count > 1 ? 's' : ''}`
      : 'Fetching artwork';
    updateStage('fetching', message, 'Connecting to art generation service', 10);
  }, [updateStage]);

  const startValidating = useCallback((current?: number, total?: number) => {
    const message = current && total
      ? `Validating artwork ${current} of ${total}`
      : 'Validating artwork';
    const progress = current && total ? 30 + (current / total) * 20 : 30;
    updateStage('validating', message, 'Ensuring optimal quality', progress);
  }, [updateStage]);

  const startPrewarming = useCallback((imageUrl?: string) => {
    const message = 'Preparing artwork for display';
    const subMessage = imageUrl ? 'Loading textures into GPU' : 'Optimizing rendering';
    updateStage('prewarming', message, subMessage, 60);
  }, [updateStage]);

  const startRendering = useCallback(() => {
    updateStage('rendering', 'Rendering artwork', 'Applying visual effects', 80);
  }, [updateStage]);

  const complete = useCallback(() => {
    updateStage('complete', 'Artwork ready', undefined, 100);
    
    // Auto-reset after a delay if enabled
    if (autoComplete) {
      setTimeout(() => {
        reset();
      }, 1000);
    }
  }, [updateStage, reset, autoComplete]);

  // Simulate progress for stages that don't have explicit progress updates
  useEffect(() => {
    if (loadingProgress.stage === 'idle' || 
        loadingProgress.stage === 'complete' || 
        loadingProgress.stage === 'error') {
      return;
    }

    const interval = setInterval(() => {
      setLoadingProgress(prev => {
        if (prev.progress >= 95) return prev;
        
        // Slower progress as we get closer to completion
        const increment = prev.progress < 50 ? 2 : prev.progress < 80 ? 1 : 0.5;
        return {
          ...prev,
          progress: Math.min(95, prev.progress + increment)
        };
      });
    }, 500);

    return () => clearInterval(interval);
  }, [loadingProgress.stage]);

  // Track stage duration for telemetry
  useEffect(() => {
    if (loadingProgress.stage === 'complete' && stageStartTime > 0) {
      const duration = Date.now() - stageStartTime;
      console.log(`[ArtworkLoadingProgress] Loading completed in ${duration}ms`);
      
      // Send telemetry if available
      if (window.telemetryService) {
        (window as any).telemetryService.recordEvent('artwork_loading_complete', {
          durationMs: duration
        });
      }
    }
  }, [loadingProgress.stage, stageStartTime]);

  return {
    loadingProgress,
    updateStage,
    updateProgress,
    setError,
    reset,
    startFetching,
    startValidating,
    startPrewarming,
    startRendering,
    complete,
    isLoading: loadingProgress.stage !== 'idle' && 
               loadingProgress.stage !== 'complete' && 
               loadingProgress.stage !== 'error'
  };
}