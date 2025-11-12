import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Loader2, Palette, Music, Brain, Sparkles, AlertCircle } from "lucide-react";

interface LoadingOverlayProps {
  isLoading: boolean;
  loadingType?: 'initial' | 'generating' | 'processing' | 'validating' | 'error';
  progress?: number;
  message?: string;
  subMessage?: string;
  error?: string;
  onRetry?: () => void;
}

export function LoadingOverlay({
  isLoading,
  loadingType = 'initial',
  progress,
  message,
  subMessage,
  error,
  onRetry
}: LoadingOverlayProps) {
  const [dots, setDots] = useState('');
  const [showMessage, setShowMessage] = useState(false);
  
  // Animate dots for loading text
  useEffect(() => {
    if (!isLoading) {
      setDots('');
      setShowMessage(false);
      return;
    }
    
    // Show message after a short delay to avoid flashing for quick loads
    const messageTimer = setTimeout(() => setShowMessage(true), 300);
    
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);
    
    return () => {
      clearInterval(interval);
      clearTimeout(messageTimer);
    };
  }, [isLoading]);
  
  if (!isLoading && !error) return null;
  
  // Select icon based on loading type
  const getIcon = () => {
    switch (loadingType) {
      case 'generating':
        return <Sparkles className="w-8 h-8 text-primary animate-pulse" />;
      case 'processing':
        return <Brain className="w-8 h-8 text-primary animate-pulse" />;
      case 'validating':
        return <Palette className="w-8 h-8 text-primary animate-pulse" />;
      case 'error':
        return <AlertCircle className="w-8 h-8 text-destructive" />;
      default:
        return <Loader2 className="w-8 h-8 text-primary animate-spin" />;
    }
  };
  
  // Default messages based on loading type
  const getDefaultMessage = () => {
    switch (loadingType) {
      case 'generating':
        return 'Creating your artwork';
      case 'processing':
        return 'Analyzing audio signals';
      case 'validating':
        return 'Preparing artwork';
      case 'error':
        return 'Something went wrong';
      default:
        return 'Loading artwork';
    }
  };
  
  const getDefaultSubMessage = () => {
    switch (loadingType) {
      case 'generating':
        return 'AI is crafting something unique just for you';
      case 'processing':
        return 'Extracting rhythm and mood from your music';
      case 'validating':
        return 'Ensuring optimal visual quality';
      case 'error':
        return error || 'Please try again or check your connection';
      default:
        return 'This may take a moment';
    }
  };
  
  const displayMessage = message || getDefaultMessage();
  const displaySubMessage = subMessage || getDefaultSubMessage();
  
  return (
    <div 
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md transition-all duration-500"
      data-testid="loading-overlay"
    >
      {showMessage && (
        <div className="flex flex-col items-center gap-6 p-8 max-w-md">
          {/* Icon */}
          <div className="relative">
            {getIcon()}
            {loadingType === 'generating' && (
              <div className="absolute inset-0 animate-ping">
                <Sparkles className="w-8 h-8 text-primary opacity-30" />
              </div>
            )}
          </div>
          
          {/* Main message with dots animation */}
          <div className="text-center space-y-2">
            <h3 className="text-xl font-semibold text-foreground">
              {displayMessage}{!error && dots}
            </h3>
            <p className="text-sm text-muted-foreground">
              {displaySubMessage}
            </p>
          </div>
          
          {/* Progress bar if available */}
          {progress !== undefined && progress > 0 && (
            <div className="w-full space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-center text-muted-foreground">
                {Math.round(progress)}% complete
              </p>
            </div>
          )}
          
          {/* Retry button for errors */}
          {error && onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              data-testid="button-retry"
            >
              Try Again
            </button>
          )}
          
          {/* Additional hints after delay */}
          {showMessage && !error && loadingType === 'generating' && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground text-center">
                <Music className="inline w-3 h-3 mr-1" />
                Tip: Your artwork morphs with the music's rhythm
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}