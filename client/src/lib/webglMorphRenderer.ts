import { DNAVector } from './dna';
import type { AudioAnalysis } from '@shared/schema';
import { vertexShaderSource, flowFieldFragmentShader, feedbackFragmentShader } from './shaders';
import { ParticleSystem } from './particleSystem';

export interface RendererFrame {
  imageUrl: string;
  opacity: number;
}

export class WebGLMorphRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private container: HTMLElement | null = null;
  
  // Programs
  private flowProgram: WebGLProgram | null = null;
  private feedbackProgram: WebGLProgram | null = null;
  
  // Buffers
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  
  // Textures
  private imageTextureA: WebGLTexture | null = null;
  private imageTextureB: WebGLTexture | null = null;
  private feedbackTexture: WebGLTexture | null = null;
  
  // Framebuffers for multi-pass rendering
  private framebuffer: WebGLFramebuffer | null = null;
  private renderTexture: WebGLTexture | null = null;
  
  // Image cache
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private imageDataCache: Map<string, ImageData> = new Map();
  
  // Particle system
  private particleSystem: ParticleSystem | null = null;
  private lastFrameTime: number = Date.now();
  
  // Time tracking
  private startTime: number = Date.now();
  
  constructor(containerId: string) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`[WebGLMorphRenderer] Container ${containerId} not found`);
      return;
    }

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    
    this.gl = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: false,
    });
    
    if (!this.gl) {
      console.error('[WebGLMorphRenderer] WebGL not supported');
      return;
    }
    
    if (this.container && this.canvas) {
      this.container.appendChild(this.canvas);
    }
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    this.initializeWebGL();
    
    console.log('[WebGLMorphRenderer] Initialized WebGL morphing renderer');
  }

  private resize(): void {
    if (!this.canvas || !this.container || !this.gl) return;
    
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.gl.viewport(0, 0, rect.width, rect.height);
    
    this.recreateFramebuffer();
  }

  private compileShader(source: string, type: number): WebGLShader | null {
    if (!this.gl) return null;
    
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('[WebGLMorphRenderer] Shader compile error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }

  private createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null {
    if (!this.gl) return null;
    
    const program = this.gl.createProgram();
    if (!program) return null;
    
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('[WebGLMorphRenderer] Program link error:', this.gl.getProgramInfoLog(program));
      this.gl.deleteProgram(program);
      return null;
    }
    
    return program;
  }

  private initializeWebGL(): void {
    if (!this.gl) return;
    
    const vertexShader = this.compileShader(vertexShaderSource, this.gl.VERTEX_SHADER);
    const flowFragShader = this.compileShader(flowFieldFragmentShader, this.gl.FRAGMENT_SHADER);
    const feedbackFragShader = this.compileShader(feedbackFragmentShader, this.gl.FRAGMENT_SHADER);
    
    if (!vertexShader || !flowFragShader || !feedbackFragShader) {
      console.error('[WebGLMorphRenderer] Failed to compile shaders');
      return;
    }
    
    this.flowProgram = this.createProgram(vertexShader, flowFragShader);
    this.feedbackProgram = this.createProgram(vertexShader, feedbackFragShader);
    
    if (!this.flowProgram || !this.feedbackProgram) {
      console.error('[WebGLMorphRenderer] Failed to create programs');
      return;
    }
    
    this.setupGeometry();
    this.setupTextures();
    
    // Initialize particle system
    if (this.canvas && this.gl) {
      this.particleSystem = new ParticleSystem(this.canvas, this.gl);
      console.log('[WebGLMorphRenderer] Particle system initialized');
    }
    this.setupFramebuffer();
    
    console.log('[WebGLMorphRenderer] WebGL initialization complete');
  }

  private setupGeometry(): void {
    if (!this.gl) return;
    
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);
    
    const texCoords = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ]);
    
    this.positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
    
    this.texCoordBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, texCoords, this.gl.STATIC_DRAW);
  }

  private setupTextures(): void {
    if (!this.gl) return;
    
    this.imageTextureA = this.gl.createTexture();
    this.imageTextureB = this.gl.createTexture();
    this.feedbackTexture = this.gl.createTexture();
    
    // Setup image textures A and B with mipmaps for pyramid blending
    [this.imageTextureA, this.imageTextureB].forEach(texture => {
      this.gl!.bindTexture(this.gl!.TEXTURE_2D, texture);
      this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_WRAP_S, this.gl!.CLAMP_TO_EDGE);
      this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_WRAP_T, this.gl!.CLAMP_TO_EDGE);
      // Use mipmap filtering for Laplacian pyramid
      this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_MIN_FILTER, this.gl!.LINEAR_MIPMAP_LINEAR);
      this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_MAG_FILTER, this.gl!.LINEAR);
    });
    
    // Feedback texture doesn't need mipmaps
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.feedbackTexture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
  }

  private setupFramebuffer(): void {
    if (!this.gl || !this.canvas) return;
    
    this.framebuffer = this.gl.createFramebuffer();
    this.renderTexture = this.gl.createTexture();
    
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.renderTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D, 0, this.gl.RGBA,
      this.canvas.width, this.canvas.height, 0,
      this.gl.RGBA, this.gl.UNSIGNED_BYTE, null
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      this.renderTexture,
      0
    );
  }

  private recreateFramebuffer(): void {
    if (!this.gl || !this.canvas || !this.renderTexture) return;
    
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.renderTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D, 0, this.gl.RGBA,
      this.canvas.width, this.canvas.height, 0,
      this.gl.RGBA, this.gl.UNSIGNED_BYTE, null
    );
  }

  private async loadImage(url: string): Promise<HTMLImageElement> {
    if (this.imageCache.has(url)) {
      console.log(`[WebGLMorphRenderer] Using cached image: ${url.substring(0, 60)}...`);
      return this.imageCache.get(url)!;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      // 10-second timeout for image loading
      const timeout = setTimeout(() => {
        console.error('[WebGLMorphRenderer] ❌ Image load TIMEOUT (10s):', url);
        reject(new Error(`Image load timeout: ${url}`));
      }, 10000);
      
      img.onload = () => {
        clearTimeout(timeout);
        this.imageCache.set(url, img);
        console.log(`[WebGLMorphRenderer] ✅ Image loaded successfully: ${url.substring(0, 60)}... (${img.width}x${img.height})`);
        resolve(img);
      };
      
      img.onerror = (e) => {
        clearTimeout(timeout);
        console.error('[WebGLMorphRenderer] ❌ Failed to load image:', url, e);
        reject(e);
      };
      
      console.log(`[WebGLMorphRenderer] Starting image load: ${url}`);
      img.src = url;
    });
  }

  async preloadImage(url: string): Promise<void> {
    try {
      await this.loadImage(url);
      console.log(`[WebGLMorphRenderer] Preloaded image: ${url.substring(0, 50)}...`);
    } catch (e) {
      console.error('[WebGLMorphRenderer] Failed to preload image:', e);
    }
  }

  private getImageData(img: HTMLImageElement, url: string): ImageData | null {
    // Check cache first
    if (this.imageDataCache.has(url)) {
      return this.imageDataCache.get(url)!;
    }

    // Create and cache new ImageData
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    tempCtx.drawImage(img, 0, 0);
    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    
    // Cache it (limit cache size to prevent memory leaks)
    if (this.imageDataCache.size > 10) {
      const firstKey = this.imageDataCache.keys().next().value;
      if (firstKey !== undefined) {
        this.imageDataCache.delete(firstKey);
      }
    }
    this.imageDataCache.set(url, imageData);
    
    return imageData;
  }

  private uploadTexture(texture: WebGLTexture, image: HTMLImageElement): void {
    if (!this.gl) {
      console.error('[WebGLMorphRenderer] ❌ Cannot upload texture: WebGL context is null');
      return;
    }
    
    if (!image.complete || !image.width || !image.height) {
      console.error('[WebGLMorphRenderer] ❌ Cannot upload texture: Image not loaded', {
        complete: image.complete,
        width: image.width,
        height: image.height
      });
      return;
    }
    
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D, 0, this.gl.RGBA,
      this.gl.RGBA, this.gl.UNSIGNED_BYTE, image
    );
    
    // Generate mipmaps for Laplacian pyramid blending
    this.gl.generateMipmap(this.gl.TEXTURE_2D);
    
    console.log(`[WebGLMorphRenderer] ✅ Texture uploaded: ${image.width}x${image.height}`);
  }

  private createPlaceholderImage(): HTMLImageElement {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // Create gradient background
      const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
      gradient.addColorStop(0, '#9333ea');   // Purple
      gradient.addColorStop(0.5, '#3b82f6'); // Blue  
      gradient.addColorStop(1, '#ec4899');   // Pink
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1024, 1024);
      
      // Add text
      ctx.fillStyle = 'white';
      ctx.font = 'bold 48px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Image Loading...', 512, 512);
    }
    
    const img = new Image();
    img.src = canvas.toDataURL();
    console.log('[WebGLMorphRenderer] Created placeholder image');
    return img;
  }

  async render(
    currentFrame: { imageUrl: string; opacity: number },
    nextFrame: { imageUrl: string; opacity: number } | null,
    dna: DNAVector,
    audioAnalysis: AudioAnalysis | null,
    audioIntensity: number = 1.0,
    beatBurst: number = 0.0
  ): Promise<void> {
    if (!this.gl || !this.canvas || !this.flowProgram || !this.feedbackProgram) {
      console.warn('[WebGLMorphRenderer] Renderer not ready');
      return;
    }

    try {
      let currentImg: HTMLImageElement;
      let nextImg: HTMLImageElement;
      
      // Load current image with fallback
      try {
        currentImg = await this.loadImage(currentFrame.imageUrl);
      } catch (e) {
        console.error('[WebGLMorphRenderer] ❌ Failed to load current frame, using placeholder:', e);
        currentImg = this.createPlaceholderImage();
      }
      
      // Load next image with fallback
      if (nextFrame) {
        try {
          nextImg = await this.loadImage(nextFrame.imageUrl);
        } catch (e) {
          console.error('[WebGLMorphRenderer] ❌ Failed to load next frame, using placeholder:', e);
          nextImg = this.createPlaceholderImage();
        }
      } else {
        nextImg = currentImg;
      }
      
      this.uploadTexture(this.imageTextureA!, currentImg);
      this.uploadTexture(this.imageTextureB!, nextImg);
      
      const morphProgress = nextFrame ? nextFrame.opacity : 0.0;
      const time = (Date.now() - this.startTime) / 1000;
      
      // Scale ALL audio parameters by audioIntensity to prevent hold-phase leakage
      const bassLevel = (audioAnalysis ? audioAnalysis.bassLevel / 100 : 0) * audioIntensity;
      const trebleLevel = (audioAnalysis ? audioAnalysis.trebleLevel / 100 : 0) * audioIntensity;
      const amplitude = (audioAnalysis ? audioAnalysis.amplitude / 100 : 0) * audioIntensity;
      
      // Scale all effects by audioIntensity (0 during hold phase, ramping up, then 1.0)
      const flowSpeed = (dna[44] ?? 1.5) * 0.3 * audioIntensity;
      const flowScale = (dna[45] ?? 2.0) * 2.0;
      const warpIntensity = (dna[46] ?? 1.0) * 0.02 * audioIntensity;
      const colorShiftRate = (dna[47] ?? 1.0) * 0.5 * audioIntensity;
      const detailLevel = (dna[48] ?? 1.0) * audioIntensity;
      const anomalyFactor = (dna[49] ?? 0.5) * audioIntensity;
      
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
      this.gl.useProgram(this.flowProgram);
      
      const posLoc = this.gl.getAttribLocation(this.flowProgram, 'a_position');
      const texLoc = this.gl.getAttribLocation(this.flowProgram, 'a_texCoord');
      
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
      this.gl.enableVertexAttribArray(posLoc);
      this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);
      
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
      this.gl.enableVertexAttribArray(texLoc);
      this.gl.vertexAttribPointer(texLoc, 2, this.gl.FLOAT, false, 0, 0);
      
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.imageTextureA);
      this.gl.uniform1i(this.gl.getUniformLocation(this.flowProgram, 'u_imageA'), 0);
      
      this.gl.activeTexture(this.gl.TEXTURE1);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.imageTextureB);
      this.gl.uniform1i(this.gl.getUniformLocation(this.flowProgram, 'u_imageB'), 1);
      
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_time'), time);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_morphProgress'), morphProgress);
      this.gl.uniform2f(this.gl.getUniformLocation(this.flowProgram, 'u_resolution'), this.canvas.width, this.canvas.height);
      
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_flowSpeed'), flowSpeed);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_flowScale'), flowScale);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_warpIntensity'), warpIntensity);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_colorShiftRate'), colorShiftRate);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_detailLevel'), detailLevel);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_anomalyFactor'), anomalyFactor);
      
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_bassLevel'), bassLevel);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_trebleLevel'), trebleLevel);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_amplitude'), amplitude);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_beatBurst'), beatBurst);
      
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
      
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.useProgram(this.feedbackProgram);
      
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.renderTexture);
      this.gl.uniform1i(this.gl.getUniformLocation(this.feedbackProgram, 'u_texture'), 0);
      
      this.gl.activeTexture(this.gl.TEXTURE1);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.feedbackTexture);
      this.gl.uniform1i(this.gl.getUniformLocation(this.feedbackProgram, 'u_feedback'), 1);
      
      this.gl.uniform1f(this.gl.getUniformLocation(this.feedbackProgram, 'u_time'), time);
      this.gl.uniform1f(this.gl.getUniformLocation(this.feedbackProgram, 'u_feedbackAmount'), amplitude * 0.5 * audioIntensity);
      this.gl.uniform2f(this.gl.getUniformLocation(this.feedbackProgram, 'u_resolution'), this.canvas.width, this.canvas.height);
      
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
      
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.feedbackTexture);
      this.gl.copyTexImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 0, 0, this.canvas.width, this.canvas.height, 0);
      
      // Particle system pass (G-Force-like tracing effect)
      if (this.particleSystem && audioIntensity > 0) {
        const now = Date.now();
        const deltaTime = now - this.lastFrameTime;
        this.lastFrameTime = now;

        // Get cached image data from both frames
        const currentImageData = this.getImageData(currentImg, currentFrame.imageUrl);
        const nextImageData = this.getImageData(nextImg, nextFrame ? nextFrame.imageUrl : currentFrame.imageUrl);
        
        if (currentImageData && nextImageData) {
          // Emit particles that trace from foreground to background
          // Pass bassLevel for beat-triggered burst emission
          this.particleSystem.emitParticles(
            currentImageData,
            nextImageData,
            audioIntensity,
            morphProgress,
            bassLevel
          );
        }
        
        // Update particle physics
        this.particleSystem.update(deltaTime);
        
        // Render particles on top
        this.particleSystem.render();
      }
      
    } catch (e) {
      console.error('[WebGLMorphRenderer] Render error:', e);
    }
  }

  destroy(): void {
    if (this.canvas && this.container) {
      this.container.removeChild(this.canvas);
    }
    
    if (this.gl) {
      if (this.flowProgram) this.gl.deleteProgram(this.flowProgram);
      if (this.feedbackProgram) this.gl.deleteProgram(this.feedbackProgram);
      if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
      if (this.texCoordBuffer) this.gl.deleteBuffer(this.texCoordBuffer);
      if (this.imageTextureA) this.gl.deleteTexture(this.imageTextureA);
      if (this.imageTextureB) this.gl.deleteTexture(this.imageTextureB);
      if (this.feedbackTexture) this.gl.deleteTexture(this.feedbackTexture);
      if (this.renderTexture) this.gl.deleteTexture(this.renderTexture);
      if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
    }
    
    this.imageCache.clear();
    this.imageDataCache.clear();
    
    if (this.particleSystem) {
      this.particleSystem.destroy();
      this.particleSystem = null;
    }
    
    this.canvas = null;
    this.gl = null;
    this.container = null;
    
    console.log('[WebGLMorphRenderer] Destroyed');
  }
}
