import { EngineRegistry, type IMorphRenderer, type RenderContext } from './renderers';
import type { MorphState } from './morphEngine';
import type { AudioAnalysis } from '@shared/schema';
import type { Command } from '@shared/maestroTypes';

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
  
  // Maestro parameter store
  private parameterStore: Map<string, number | number[] | boolean | string> = new Map();
  private activeRamps: Map<string, {
    from: number | number[];
    to: number | number[];
    startTime: number;
    durationMs: number;
    curve: "linear" | "easeInOut" | "expo";
  }> = new Map();
  private activePulses: Map<string, {
    baseValue: number | number[];
    pulseAmount: number | number[];
    startTime: number;
    decayMs: number;
  }> = new Map();
  
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
    
    // Update parameter animations (ramps and pulses)
    this.updateParameterAnimations();
    
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
        // Maestro parameters (exposed to engines)
        parameters: this.parameterStore,
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
  
  /**
   * Dispatch commands from Maestro to the rendering pipeline
   * 
   * This is the bridge between Maestro's command system and the
   * existing rendering engines. Commands update parameterStore
   * regardless of engine lifecycle, ensuring no commands are dropped.
   */
  dispatchCommands(commands: Command[]): void {
    // Execute commands even if engine is not ready yet
    // parameterStore updates are independent of engine lifecycle
    if (commands.length > 0) {
      console.log(`[RendererManager] Dispatching ${commands.length} commands (engine: ${this.currentEngineKey || 'none'})`);
      
      for (const command of commands) {
        this.executeCommand(command);
      }
    }
  }
  
  /**
   * Execute a single command (functional implementation)
   */
  private executeCommand(command: Command): void {
    switch (command.kind) {
      case "SET":
        // Set parameter immediately
        this.parameterStore.set(command.path, command.value);
        console.log(`[RendererManager] SET ${command.path} = ${command.value}`);
        break;
        
      case "RAMP":
        // Ramp parameter over time
        const currentValue = this.parameterStore.get(command.path) ?? 0;
        const durationMs = command.durationBars * (60000 / 120); // Assume 120 BPM for now
        
        // Only create ramps for numeric values
        if (typeof currentValue === "number" || Array.isArray(currentValue)) {
          this.activeRamps.set(command.path, {
            from: currentValue as number | number[],
            to: command.to,
            startTime: performance.now(),
            durationMs: durationMs,
            curve: command.curve ?? "linear",
          });
          
          console.log(`[RendererManager] RAMP ${command.path} to ${command.to} over ${command.durationBars} bars (${durationMs}ms)`);
        } else {
          console.warn(`[RendererManager] Cannot RAMP non-numeric parameter: ${command.path}`);
        }
        break;
        
      case "PULSE":
        // Pulse parameter (spike and decay)
        const baseValue = this.parameterStore.get(command.path) ?? 0;
        const decayMs = command.decayBeats * (60000 / 120); // Assume 120 BPM for now
        
        // Only create pulses for numeric values
        if (typeof baseValue === "number" || Array.isArray(baseValue)) {
          this.activePulses.set(command.path, {
            baseValue: baseValue as number | number[],
            pulseAmount: command.amount,
            startTime: performance.now(),
            decayMs: decayMs,
          });
          
          console.log(`[RendererManager] PULSE ${command.path} by ${command.amount} with ${command.decayBeats} beat decay (${decayMs}ms)`);
        } else {
          console.warn(`[RendererManager] Cannot PULSE non-numeric parameter: ${command.path}`);
        }
        break;
        
      case "SCHEDULE":
        // Schedule future commands (logged for now)
        console.log(`[RendererManager] SCHEDULE ${command.commands.length} commands at bar ${command.atBar}`);
        break;
        
      case "ATTACH_EMITTER":
        // Attach particle emitter (Phase 3)
        console.log(`[RendererManager] ATTACH_EMITTER ${command.source} to ${command.path}`);
        break;
        
      case "SET_PALETTE":
        // Set color palette (Phase 3)
        console.log(`[RendererManager] SET_PALETTE ${command.paletteId} at ${command.path}`);
        break;
        
      default:
        console.warn('[RendererManager] Unknown command kind:', (command as any).kind);
    }
  }
  
  /**
   * Update parameter animations (ramps and pulses)
   * Call this every frame before rendering
   */
  private updateParameterAnimations(): void {
    const now = performance.now();
    
    // Update ramps
    this.activeRamps.forEach((ramp, path) => {
      const elapsed = now - ramp.startTime;
      const progress = Math.min(elapsed / ramp.durationMs, 1.0);
      
      // Apply easing curve
      let easedProgress = progress;
      switch (ramp.curve) {
        case "easeInOut":
          easedProgress = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          break;
        case "expo":
          easedProgress = progress === 0 ? 0 : Math.pow(2, 10 * progress - 10);
          break;
      }
      
      // Interpolate value (support both scalars and arrays)
      if (typeof ramp.from === "number" && typeof ramp.to === "number") {
        const value = ramp.from + (ramp.to - ramp.from) * easedProgress;
        this.parameterStore.set(path, value);
      } else if (Array.isArray(ramp.from) && Array.isArray(ramp.to)) {
        const fromArray = ramp.from as number[];
        const toArray = ramp.to as number[];
        const value = fromArray.map((fromVal, i) => {
          const toVal = toArray[i] ?? fromVal;
          return fromVal + (toVal - fromVal) * easedProgress;
        });
        this.parameterStore.set(path, value);
      }
      
      // Remove completed ramps
      if (progress >= 1.0) {
        this.activeRamps.delete(path);
      }
    });
    
    // Update pulses
    this.activePulses.forEach((pulse, path) => {
      const elapsed = now - pulse.startTime;
      const progress = Math.min(elapsed / pulse.decayMs, 1.0);
      
      // Exponential decay
      const decay = Math.exp(-5 * progress); // Decay factor
      
      // Apply pulse on top of base value (support both scalars and arrays)
      if (typeof pulse.baseValue === "number" && typeof pulse.pulseAmount === "number") {
        const value = pulse.baseValue + pulse.pulseAmount * decay;
        this.parameterStore.set(path, value);
      } else if (Array.isArray(pulse.baseValue) && Array.isArray(pulse.pulseAmount)) {
        const baseArray = pulse.baseValue as number[];
        const pulseArray = pulse.pulseAmount as number[];
        const value = baseArray.map((baseVal, i) => {
          const pulseVal = pulseArray[i] ?? 0;
          return baseVal + pulseVal * decay;
        });
        this.parameterStore.set(path, value);
      }
      
      // Remove completed pulses
      if (progress >= 1.0) {
        this.parameterStore.set(path, pulse.baseValue);
        this.activePulses.delete(path);
      }
    });
  }
  
  /**
   * Get parameter value from store
   */
  getParameter(path: string): number | number[] | boolean | string | undefined {
    return this.parameterStore.get(path);
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
