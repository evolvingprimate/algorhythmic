// Placeholder frame component - absolute guard rail against black frames
import { useEffect, useRef } from 'react';

export interface PlaceholderFrameProps {
  width?: number;
  height?: number;
  message?: string;
}

/**
 * Generates a beautiful gradient placeholder that prevents black frames
 * This is the absolute last resort when no artwork is available
 */
export function PlaceholderFrame({ 
  width = 1024, 
  height = 1024,
  message = "Loading artwork..."
}: PlaceholderFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Create a beautiful gradient as placeholder
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    
    // Purple to pink gradient matching the app theme
    gradient.addColorStop(0, '#9333ea'); // Purple-600
    gradient.addColorStop(0.5, '#ec4899'); // Pink-500  
    gradient.addColorStop(1, '#6366f1'); // Indigo-500
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Add some visual interest with circles
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const radius = 100 + Math.random() * 200;
      
      const circleGradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      circleGradient.addColorStop(0, '#ffffff');
      circleGradient.addColorStop(1, 'transparent');
      
      ctx.fillStyle = circleGradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Reset alpha and add message
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, width / 2, height / 2);
  }, [width, height, message]);
  
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="placeholder-frame"
      data-testid="placeholder-frame"
    />
  );
}

/**
 * Creates a data URL for the placeholder image
 * This can be used as a src for img elements
 */
export function createPlaceholderDataUrl(width = 1024, height = 1024): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  
  // Create gradient
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#9333ea');
  gradient.addColorStop(0.5, '#ec4899');
  gradient.addColorStop(1, '#6366f1');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  return canvas.toDataURL('image/jpeg', 0.9);
}

// Export a constant placeholder URL that can be used immediately
export const PLACEHOLDER_IMAGE_URL = 'data:image/svg+xml;base64,' + btoa(`
  <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#9333ea;stop-opacity:1" />
        <stop offset="50%" style="stop-color:#ec4899;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#6366f1;stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#grad)" />
    <text x="512" y="512" font-family="Inter" font-size="24" fill="white" text-anchor="middle" dominant-baseline="middle">
      Loading artwork...
    </text>
  </svg>
`);