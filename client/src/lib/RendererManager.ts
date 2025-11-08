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
  private resizeHandler: (() => void) | null = null;
  
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
    this.resizeHandler = () => this.resize();
    window.addEventListener('resize', this.resizeHandler);
    
    this.createTextures();
    
    // Initialize with the initial engine asynchronously
    this.switchEngine(initialEngine).catch((error) => {
      console.error('[RendererManager] Failed to initialize initial engine:', error);
    });
    
    console.log('[RendererManager] Initializing with engine:', initialEngine);
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
  
  async switchEngine(engineKey: string, fallbackEngines: string[] = ['morpheus_0.3', 'morpheus_0.2', 'morpheus_0.1']): Promise<boolean> {
    if (!this.gl) {
      console.error('[RendererManager] Cannot switch engine - GL not initialized');
      return false;
    }
    
    if (this.currentEngineKey === engineKey) {
      return true;
    }
    
    if (this.currentEngine) {
      this.currentEngine.destroy();
      this.currentEngine = null;
    }
    
    const registry = EngineRegistry.getInstance();
    const newEngine = registry.create(engineKey);
    
    if (!newEngine) {
      console.error('[RendererManager] Failed to create engine:', engineKey);
      return false;
    }
    
    try {
      console.log(`[RendererManager] Initializing engine: ${engineKey}...`);
      await newEngine.initialize(this.gl);
      this.currentEngine = newEngine;
      this.currentEngineKey = engineKey;
      this.pendingEngineKey = null;
      console.log(`[RendererManager] ✅ Successfully switched to engine: ${engineKey}`);
      return true;
    } catch (error) {
      console.error(`[RendererManager] ❌ Failed to initialize ${engineKey}:`, error);
      newEngine.destroy();
      
      // Try fallback engines
      for (const fallback of fallbackEngines) {
        if (fallback === engineKey) continue; // Skip the one we just tried
        
        console.warn(`[RendererManager] 🔄 Attempting fallback to ${fallback}...`);
        const fallbackEngine = registry.create(fallback);
        
        if (!fallbackEngine) {
          console.error(`[RendererManager] Fallback engine ${fallback} not found`);
          continue;
        }
        
        try {
          await fallbackEngine.initialize(this.gl);
          this.currentEngine = fallbackEngine;
          this.currentEngineKey = fallback;
          this.pendingEngineKey = null;
          console.log(`[RendererManager] ✅ Fallback successful: ${fallback}`);
          
          // Emit fallback event for UI notification
          window.dispatchEvent(new CustomEvent('renderer-fallback', {
            detail: {
              attempted: engineKey,
              fallback: fallback,
              reason: error instanceof Error ? error.message : 'Unknown error'
            }
          }));
          
          return true;
        } catch (fallbackError) {
          console.error(`[RendererManager] Fallback ${fallback} also failed:`, fallbackError);
          fallbackEngine.destroy();
        }
      }
      
      console.error('[RendererManager] ❌ All engines failed to initialize');
      return false;
    }
  }
  
  requestEngineSwitch(engineKey: string): void {
    this.pendingEngineKey = engineKey;
    console.log(`[RendererManager] Engine switch requested: ${engineKey} (will apply at cycle boundary)`);
  }
  
  async applyPendingEngineSwitch(): Promise<void> {
    if (this.pendingEngineKey) {
      await this.switchEngine(this.pendingEngineKey);
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
    // Remove resize listener
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    
    // Destroy current engine
    if (this.currentEngine) {
      this.currentEngine.destroy();
      this.currentEngine = null;
    }
    
    // Delete textures
    if (this.gl) {
      if (this.imageTextureA) {
        this.gl.deleteTexture(this.imageTextureA);
        this.imageTextureA = null;
      }
      if (this.imageTextureB) {
        this.gl.deleteTexture(this.imageTextureB);
        this.imageTextureB = null;
      }
    }
    
    // Remove canvas from DOM
    if (this.canvas && this.container) {
      this.container.removeChild(this.canvas);
    }
    
    // Clear caches
    this.imageCache.clear();
    
    // Null out references
    this.canvas = null;
    this.gl = null;
    this.container = null;
    this.imageDataA = null;
    this.imageDataB = null;
    
    console.log('[RendererManager] Destroyed (all resources cleaned up)');
  }
}
