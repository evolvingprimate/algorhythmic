import { DNAVector } from './dna';
import type { AudioAnalysis } from '@shared/schema';

export interface RendererFrame {
  imageUrl: string;
  opacity: number;
}

export class Tier1Renderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private container: HTMLElement | null = null;
  private currentImage: HTMLImageElement | null = null;
  private nextImage: HTMLImageElement | null = null;
  private imageCache: Map<string, HTMLImageElement> = new Map();

  constructor(containerId: string) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`[Tier1Renderer] Container ${containerId} not found`);
      return;
    }

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    
    if (this.container && this.canvas) {
      this.container.appendChild(this.canvas);
    }
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    console.log('[Tier1Renderer] Initialized CSS + Canvas2D renderer');
  }

  private resize(): void {
    if (!this.canvas || !this.container) return;
    
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  private async loadImage(url: string): Promise<HTMLImageElement> {
    if (this.imageCache.has(url)) {
      return this.imageCache.get(url)!;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      // Remove crossOrigin to avoid CORS issues with DALL-E images
      img.onload = () => {
        this.imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = (e) => {
        console.error('[Tier1Renderer] Failed to load image:', url, e);
        reject(e);
      };
      img.src = url;
    });
  }

  async preloadImage(url: string): Promise<void> {
    try {
      await this.loadImage(url);
      console.log(`[Tier1Renderer] Preloaded image: ${url.substring(0, 50)}...`);
    } catch (e) {
      console.error('[Tier1Renderer] Failed to preload image:', e);
    }
  }

  async render(
    currentFrame: { imageUrl: string; opacity: number },
    nextFrame: { imageUrl: string; opacity: number } | null,
    dna: DNAVector,
    audioAnalysis: AudioAnalysis | null
  ): Promise<void> {
    if (!this.canvas || !this.ctx) return;

    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.clearRect(0, 0, width, height);

    try {
      const currentImg = await this.loadImage(currentFrame.imageUrl);

      // DNA-driven morph parameters (points 45-50 are audio-reactive)
      const warpElasticity = dna[44] || 1.0;      // Controls scale/distortion
      const particleDensity = dna[45] || 1.0;     // Future: particle count
      const dissolveSpeed = dna[46] || 1.0;       // Controls transition smoothness
      const echoTrail = dna[47] || 0.5;           // Afterimage effect
      const boundaryFuzz = dna[48] || 0.5;        // Blur amount
      const reactivityGain = dna[49] || 1.0;      // Audio sensitivity

      // Audio reactivity
      const bassReactivity = audioAnalysis ? (audioAnalysis.bassLevel / 100) : 0;
      const trebleReactivity = audioAnalysis ? (audioAnalysis.trebleLevel / 100) : 0;
      const amplitude = audioAnalysis ? (audioAnalysis.amplitude / 100) : 0;

      // Enhanced effects
      const scale = 1 + (warpElasticity - 1) * bassReactivity * 0.2 * reactivityGain;
      const rotation = trebleReactivity * 0.02 * reactivityGain; // Subtle rotation
      const blur = boundaryFuzz * 2 + amplitude * 3 * reactivityGain;
      const brightness = 1.0 + amplitude * 0.2 * reactivityGain;
      const contrast = 1.0 + bassReactivity * 0.3 * reactivityGain;
      const saturation = 1.0 + trebleReactivity * 0.2 * reactivityGain;

      // Calculate aspect-fit dimensions
      const imgAspect = currentImg.width / currentImg.height;
      const canvasAspect = width / height;
      
      let drawWidth, drawHeight, drawX, drawY;
      
      if (imgAspect > canvasAspect) {
        drawHeight = height;
        drawWidth = height * imgAspect;
        drawX = (width - drawWidth) / 2;
        drawY = 0;
      } else {
        drawWidth = width;
        drawHeight = width / imgAspect;
        drawX = 0;
        drawY = (height - drawHeight) / 2;
      }

      // Render current frame with effects
      ctx.save();
      
      // Apply transforms
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.rotate(rotation);
      ctx.translate(-width / 2, -height / 2);

      // Apply filters (combined for better performance)
      const filters = [];
      if (blur > 0.5) {
        filters.push(`blur(${Math.min(blur, 10)}px)`);
      }
      filters.push(`brightness(${brightness})`);
      filters.push(`contrast(${contrast})`);
      filters.push(`saturate(${saturation})`);
      
      ctx.filter = filters.join(' ');
      ctx.globalAlpha = currentFrame.opacity;
      
      ctx.drawImage(currentImg, drawX, drawY, drawWidth, drawHeight);
      
      ctx.restore();

      // Echo trail effect (ghosting/afterimage)
      if (echoTrail > 1.5 && currentFrame.opacity > 0.5) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.3, (echoTrail - 1.5) * 0.2);
        ctx.filter = `blur(${echoTrail * 2}px)`;
        ctx.drawImage(currentImg, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();
      }

      // Render next frame with crossfade
      if (nextFrame && nextFrame.opacity > 0) {
        const nextImg = await this.loadImage(nextFrame.imageUrl);
        
        // Recalculate dimensions for next image
        const nextImgAspect = nextImg.width / nextImg.height;
        if (nextImgAspect > canvasAspect) {
          drawHeight = height;
          drawWidth = height * nextImgAspect;
          drawX = (width - drawWidth) / 2;
          drawY = 0;
        } else {
          drawWidth = width;
          drawHeight = width / nextImgAspect;
          drawX = 0;
          drawY = (height - drawHeight) / 2;
        }
        
        ctx.save();
        
        // Apply subtle zoom-in effect to next frame
        const nextScale = 1.0 + (1.0 - nextFrame.opacity) * 0.05;
        ctx.translate(width / 2, height / 2);
        ctx.scale(nextScale, nextScale);
        ctx.translate(-width / 2, -height / 2);
        
        // Dissolve effect based on DNA
        const dissolveBlur = (1.0 - nextFrame.opacity) * dissolveSpeed * 5;
        ctx.filter = `blur(${dissolveBlur}px) brightness(${1.0 + (1.0 - nextFrame.opacity) * 0.2})`;
        ctx.globalAlpha = nextFrame.opacity;
        
        ctx.drawImage(nextImg, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();
      }
      
    } catch (e) {
      console.error('[Tier1Renderer] Render error:', e);
    }
  }

  destroy(): void {
    if (this.canvas && this.container) {
      this.container.removeChild(this.canvas);
    }
    this.imageCache.clear();
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    console.log('[Tier1Renderer] Destroyed');
  }
}
