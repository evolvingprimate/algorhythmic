import { EngineRegistry, type IMorphRenderer, type RenderContext } from './renderers';
import type { MorphState } from './morphEngine';
import type { AudioAnalysis } from '@shared/schema';

export class RendererManager {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private container: HTMLElement | null = null;
  
  private currentEngine: IMorphRenderer | null = null;
  private currentEngineKey: string = '';
  private pendingEngineKey: string | null = null;
  
  private imageTextureA: WebGLTexture | null = null;
  private imageTextureB: WebGLTexture | null = null;
  private imageDataA: HTMLImageElement | null = null;
  private imageDataB: HTMLImageElement | null = null;
  
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private startTime: number = Date.now();
  
  constructor(containerId: string, initialEngine: string) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`[RendererManager] Container ${containerId} not found`);
      return;
    }
    
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'webgl-canvas';
    this.canvas.setAttribute('data-testid', 'webgl-canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.zIndex = '0';
    
    this.gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: false,
    });
    
    if (!this.gl) {
      console.error('[RendererManager] WebGL2 not supported');
      return;
    }
    
    if (this.container && this.canvas) {
      this.container.appendChild(this.canvas);
    }
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    this.createTextures();
    
    this.switchEngine(initialEngine);
    
    console.log('[RendererManager] Initialized with engine:', initialEngine);
  }
  
  private resize(): void {
    if (!this.canvas || !this.container || !this.gl) return;
    
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.gl.viewport(0, 0, rect.width, rect.height);
  }
  
  private createTextures(): void {
    if (!this.gl) return;
    
    this.imageTextureA = this.gl.createTexture();
    this.imageTextureB = this.gl.createTexture();
    
    [this.imageTextureA, this.imageTextureB].forEach((texture) => {
      if (!texture || !this.gl) return;
      
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    });
    
    console.log('[RendererManager] Textures created');
  }
  
  switchEngine(engineKey: string): void {
    if (!this.gl) {
      console.error('[RendererManager] Cannot switch engine - GL not initialized');
      return;
    }
    
    if (this.currentEngineKey === engineKey) {
      return;
    }
    
    if (this.currentEngine) {
      this.currentEngine.destroy();
      this.currentEngine = null;
    }
    
    const registry = EngineRegistry.getInstance();
    const newEngine = registry.create(engineKey);
    
    if (!newEngine) {
      console.error('[RendererManager] Failed to create engine:', engineKey);
      return;
    }
    
    newEngine.initialize(this.gl);
    this.currentEngine = newEngine;
    this.currentEngineKey = engineKey;
    this.pendingEngineKey = null;
    
    console.log(`[RendererManager] Switched to engine: ${engineKey}`);
  }
  
  requestEngineSwitch(engineKey: string): void {
    this.pendingEngineKey = engineKey;
    console.log(`[RendererManager] Engine switch requested: ${engineKey} (will apply at cycle boundary)`);
  }
  
  applyPendingEngineSwitch(): void {
    if (this.pendingEngineKey) {
      this.switchEngine(this.pendingEngineKey);
    }
  }
  
  async render(
    imageUrlA: string,
    imageUrlB: string,
    morphState: MorphState,
    audioAnalysis?: AudioAnalysis
  ): Promise<void> {
    if (!this.gl || !this.canvas || !this.currentEngine) {
      return;
    }
    
    if (!this.imageTextureA || !this.imageTextureB) {
      console.error('[RendererManager] Textures not initialized');
      return;
    }
    
    try {
      const imgA = await this.loadImage(imageUrlA);
      const imgB = await this.loadImage(imageUrlB);
      
      this.uploadTexture(this.imageTextureA, imgA);
      this.uploadTexture(this.imageTextureB, imgB);
      
      this.imageDataA = imgA;
      this.imageDataB = imgB;
      
      const context: RenderContext = {
        gl: this.gl,
        canvas: this.canvas,
        frameA: {
          texture: this.imageTextureA,
          imageData: imgA,
        },
        frameB: {
          texture: this.imageTextureB,
          imageData: imgB,
        },
        morphState,
        audioAnalysis,
        time: (Date.now() - this.startTime) / 1000,
      };
      
      this.currentEngine.render(context);
      
    } catch (e) {
      console.error('[RendererManager] Render error:', e);
    }
  }
  
  private async loadImage(url: string): Promise<HTMLImageElement> {
    if (this.imageCache.has(url)) {
      return this.imageCache.get(url)!;
    }
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        this.imageCache.set(url, img);
        resolve(img);
      };
      
      img.onerror = () => {
        reject(new Error(`Failed to load image: ${url}`));
      };
      
      img.src = url;
    });
  }
  
  private uploadTexture(texture: WebGLTexture, image: HTMLImageElement): void {
    if (!this.gl) return;
    
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      image
    );
  }
  
  destroy(): void {
    if (this.currentEngine) {
      this.currentEngine.destroy();
      this.currentEngine = null;
    }
    
    if (this.gl) {
      if (this.imageTextureA) this.gl.deleteTexture(this.imageTextureA);
      if (this.imageTextureB) this.gl.deleteTexture(this.imageTextureB);
    }
    
    if (this.canvas && this.container) {
      this.container.removeChild(this.canvas);
    }
    
    this.imageCache.clear();
    
    this.canvas = null;
    this.gl = null;
    this.container = null;
    
    console.log('[RendererManager] Destroyed');
  }
}
