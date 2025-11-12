import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Music, Palette } from "lucide-react";

interface ArtworkSkeletonProps {
  showHints?: boolean;
}

export function ArtworkSkeleton({ showHints = true }: ArtworkSkeletonProps) {
  const [pulseIntensity, setPulseIntensity] = useState(0.5);
  
  // Create a subtle pulse effect
  useEffect(() => {
    const interval = setInterval(() => {
      setPulseIntensity(prev => {
        const next = prev + 0.01;
        return next > 1 ? 0.5 : next;
      });
    }, 50);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/95" data-testid="artwork-skeleton">
      {/* Main skeleton area with gradient effect */}
      <div className="relative w-full h-full overflow-hidden">
        {/* Animated gradient background */}
        <div 
          className="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent animate-pulse"
          style={{
            opacity: pulseIntensity
          }}
        />
        
        {/* Grid pattern overlay for visual interest */}
        <div className="absolute inset-0 opacity-5">
          <div className="w-full h-full" style={{
            backgroundImage: `
              repeating-linear-gradient(0deg, currentColor 0px, transparent 1px, transparent 40px, currentColor 41px),
              repeating-linear-gradient(90deg, currentColor 0px, transparent 1px, transparent 40px, currentColor 41px)
            `,
            backgroundSize: '40px 40px'
          }} />
        </div>
        
        {/* Center content area */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="max-w-2xl w-full px-8 space-y-8">
            {/* Artwork placeholder */}
            <div className="relative aspect-square max-w-md mx-auto">
              <Skeleton className="w-full h-full rounded-lg" />
              
              {/* Floating icons animation */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative">
                  {/* Central sparkle */}
                  <Sparkles className="w-16 h-16 text-primary/20 animate-pulse" />
                  
                  {/* Orbiting elements */}
                  <div className="absolute -top-8 -left-8 animate-float">
                    <Music className="w-6 h-6 text-primary/20" />
                  </div>
                  <div className="absolute -bottom-8 -right-8 animate-float-delayed">
                    <Palette className="w-6 h-6 text-primary/20" />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Metadata skeleton */}
            <div className="space-y-4">
              {/* Title skeleton */}
              <div className="space-y-2">
                <Skeleton className="h-6 w-3/4 mx-auto" />
                <Skeleton className="h-4 w-1/2 mx-auto" />
              </div>
              
              {/* Control buttons skeleton */}
              <div className="flex justify-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-10 w-10 rounded-full" />
              </div>
            </div>
            
            {/* Loading hints */}
            {showHints && (
              <div className="text-center space-y-2 animate-fade-in">
                <p className="text-sm text-muted-foreground">
                  Preparing your personalized art experience
                </p>
                <div className="flex items-center justify-center gap-1">
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Add animation styles to index.css
export const skeletonAnimationStyles = `
  @keyframes float {
    0%, 100% {
      transform: translateY(0) rotate(0deg);
    }
    50% {
      transform: translateY(-10px) rotate(180deg);
    }
  }
  
  @keyframes float-delayed {
    0%, 100% {
      transform: translateY(0) rotate(0deg);
    }
    50% {
      transform: translateY(-10px) rotate(-180deg);
    }
  }
  
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .animate-float {
    animation: float 3s ease-in-out infinite;
  }
  
  .animate-float-delayed {
    animation: float-delayed 3s ease-in-out infinite;
    animation-delay: 1.5s;
  }
  
  .animate-fade-in {
    animation: fade-in 0.5s ease-out forwards;
  }
`;