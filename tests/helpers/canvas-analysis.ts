import { Page } from '@playwright/test';

export interface CanvasAnalysisResult {
  avgLuminance: number;
  blackPixelPercent: number;
  width: number;
  height: number;
  pixelCount: number;
  error?: string;
}

export async function analyzeCanvas(page: Page): Promise<CanvasAnalysisResult> {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      return {
        avgLuminance: 0,
        blackPixelPercent: 100,
        width: 0,
        height: 0,
        pixelCount: 0,
        error: 'No canvas found'
      };
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        avgLuminance: 0,
        blackPixelPercent: 100,
        width: canvas.width,
        height: canvas.height,
        pixelCount: 0,
        error: 'No context'
      };
    }
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    
    let totalLuminance = 0;
    let blackPixels = 0;
    const pixelCount = pixels.length / 4;
    
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      
      // Luminance formula: 0.299*R + 0.587*G + 0.114*B
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      totalLuminance += luminance;
      
      // Count black pixels (RGB all < 10)
      if (r < 10 && g < 10 && b < 10) {
        blackPixels++;
      }
    }
    
    return {
      avgLuminance: totalLuminance / pixelCount,
      blackPixelPercent: (blackPixels / pixelCount) * 100,
      width: canvas.width,
      height: canvas.height,
      pixelCount
    };
  });
}

export async function sampleCanvasPixels(
  page: Page,
  sampleSize: number = 100
): Promise<{ r: number; g: number; b: number }[]> {
  return await page.evaluate((size) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return [];
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const samples: { r: number; g: number; b: number }[] = [];
    
    const step = Math.floor((pixels.length / 4) / size);
    
    for (let i = 0; i < pixels.length && samples.length < size; i += step * 4) {
      samples.push({
        r: pixels[i],
        g: pixels[i + 1],
        b: pixels[i + 2]
      });
    }
    
    return samples;
  }, sampleSize);
}

export function calculateColorVariance(samples: { r: number; g: number; b: number }[]): number {
  if (samples.length === 0) return 0;
  
  const avgR = samples.reduce((sum, s) => sum + s.r, 0) / samples.length;
  const avgG = samples.reduce((sum, s) => sum + s.g, 0) / samples.length;
  const avgB = samples.reduce((sum, s) => sum + s.b, 0) / samples.length;
  
  const variance = samples.reduce((sum, s) => {
    return sum + 
      Math.pow(s.r - avgR, 2) + 
      Math.pow(s.g - avgG, 2) + 
      Math.pow(s.b - avgB, 2);
  }, 0) / (samples.length * 3);
  
  return variance;
}
