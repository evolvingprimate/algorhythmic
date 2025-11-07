import { DNAVector } from './dna';
import type { AudioAnalysis } from '@shared/schema';
import { vertexShaderSource, flowFieldFragmentShader, feedbackFragmentShader, traceExtractionFragmentShader, bloomFragmentShader, compositeFragmentShader, bloomPassthroughFragmentShader } from './shaders';
import { ParticleSystem } from './particleSystem';

export interface RendererFrame {
  imageUrl: string;
  opacity: number;
}

export class WebGLMorphRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private container: HTMLElement | null = null;
  
  // Core readiness flag - CRITICAL for preventing render() on uninitialized state
  private coreReady: boolean = false;
  
  // Programs
  private flowProgram: WebGLProgram | null = null;
  private feedbackProgram: WebGLProgram | null = null;
  private traceProgram: WebGLProgram | null = null;
  private bloomProgram: WebGLProgram | null = null;
  private compositeProgram: WebGLProgram | null = null;
  private bloomPassthroughProgram: WebGLProgram | null = null;
  
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
  
  // Trace extraction system (for dreamy birthing effect)
  private traceFramebuffer: WebGLFramebuffer | null = null;
  private traceTextureCurrent: WebGLTexture | null = null;
  private traceTexturePrevious: WebGLTexture | null = null;
  
  // Bloom system (for dreamy glow effect)
  private bloomFramebuffer: WebGLFramebuffer | null = null;
  private bloomTexture: WebGLTexture | null = null;
  
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
    this.recreateTraceFramebuffer();
    this.recreateBloomFramebuffer();
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
    
    // Compile core shaders (required)
    const vertexShader = this.compileShader(vertexShaderSource, this.gl.VERTEX_SHADER);
    const flowFragShader = this.compileShader(flowFieldFragmentShader, this.gl.FRAGMENT_SHADER);
    const feedbackFragShader = this.compileShader(feedbackFragmentShader, this.gl.FRAGMENT_SHADER);
    
    // Compile optional effect shaders (trace, bloom, composite)
    const traceFragShader = this.compileShader(traceExtractionFragmentShader, this.gl.FRAGMENT_SHADER);
    const bloomFragShader = this.compileShader(bloomFragmentShader, this.gl.FRAGMENT_SHADER);
    const compositeFragShader = this.compileShader(compositeFragmentShader, this.gl.FRAGMENT_SHADER);
    
    // CRITICAL: Only fail if CORE shaders fail
    if (!vertexShader || !flowFragShader || !feedbackFragShader) {
      console.error('[WebGLMorphRenderer] ❌ Failed to compile CORE shaders');
      return;
    }
    
    // Create core programs (required)
    this.flowProgram = this.createProgram(vertexShader, flowFragShader);
    this.feedbackProgram = this.createProgram(vertexShader, feedbackFragShader);
    
    // Create optional effect programs
    if (traceFragShader) {
      this.traceProgram = this.createProgram(vertexShader, traceFragShader);
      if (!this.traceProgram) {
        console.warn('[WebGLMorphRenderer] ⚠️ Failed to create trace program (optional, disabling trace effects)');
      }
    } else {
      console.warn('[WebGLMorphRenderer] ⚠️ Trace shader compilation failed (optional, disabling trace effects)');
    }
    
    if (bloomFragShader) {
      this.bloomProgram = this.createProgram(vertexShader, bloomFragShader);
      if (!this.bloomProgram) {
        console.warn('[WebGLMorphRenderer] ⚠️ Failed to create bloom program (optional, disabling bloom effects)');
      }
    } else {
      console.warn('[WebGLMorphRenderer] ⚠️ Bloom shader compilation failed (optional, disabling bloom effects)');
    }
    
    if (compositeFragShader) {
      this.compositeProgram = this.createProgram(vertexShader, compositeFragShader);
      if (!this.compositeProgram) {
        console.warn('[WebGLMorphRenderer] ⚠️ Failed to create composite program (optional, disabling chromatic drift)');
      }
    } else {
      console.warn('[WebGLMorphRenderer] ⚠️ Composite shader compilation failed (optional, disabling chromatic drift)');
    }
    
    if (bloomPassthroughFragmentShader) {
      this.bloomPassthroughProgram = this.createProgram(vertexShader, bloomPassthroughFragmentShader);
      if (!this.bloomPassthroughProgram) {
        console.warn('[WebGLMorphRenderer] ⚠️ Failed to create bloom passthrough program (optional, bloom will use composite shader)');
      }
    } else {
      console.warn('[WebGLMorphRenderer] ⚠️ Bloom passthrough shader compilation failed (optional, bloom will use composite shader)');
    }
    
    // CRITICAL: Only fail if CORE programs fail
    if (!this.flowProgram || !this.feedbackProgram) {
      console.error('[WebGLMorphRenderer] ❌ Failed to create CORE programs');
      this.coreReady = false;
      return;
    }
    
    // Validate programs before marking ready
    if (!this.gl.getProgramParameter(this.flowProgram, this.gl.LINK_STATUS) ||
        !this.gl.getProgramParameter(this.feedbackProgram, this.gl.LINK_STATUS)) {
      console.error('[WebGLMorphRenderer] ❌ Core programs failed validation');
      this.coreReady = false;
      return;
    }
    
    this.setupGeometry();
    this.setupTextures();
    
    // Setup optional effects (don't fail if they error)
    try {
      if (this.traceProgram) {
        this.setupTraceTextures();
        this.setupTraceFramebuffer();
        console.log('[WebGLMorphRenderer] ✅ Trace extraction enabled');
      }
    } catch (e) {
      console.warn('[WebGLMorphRenderer] ⚠️ Trace setup failed (disabling):', e);
      this.traceProgram = null;
    }
    
    // Initialize particle system
    if (this.canvas && this.gl) {
      try {
        this.particleSystem = new ParticleSystem(this.canvas, this.gl);
        console.log('[WebGLMorphRenderer] ✅ Particle system initialized');
      } catch (e) {
        console.warn('[WebGLMorphRenderer] ⚠️ Particle system failed (disabling):', e);
      }
    }
    
    this.setupFramebuffer();
    
    // Setup bloom (optional, don't fail if it errors)
    try {
      if (this.bloomProgram) {
        this.setupBloom();
        console.log('[WebGLMorphRenderer] ✅ Bloom effects enabled');
      }
    } catch (e) {
      console.warn('[WebGLMorphRenderer] ⚠️ Bloom setup failed (disabling):', e);
      this.bloomProgram = null;
    }
    
    // Mark core as ready ONLY after all critical setup succeeds
    this.coreReady = true;
    console.log('[WebGLMorphRenderer] ✅ WebGL initialization complete (core + optional effects)');
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

  private recreateTraceFramebuffer(): void {
    if (!this.gl || !this.canvas) return;
    
    // Reallocate trace textures with new canvas size
    [this.traceTextureCurrent, this.traceTexturePrevious].forEach(texture => {
      if (!texture) return;
      this.gl!.bindTexture(this.gl!.TEXTURE_2D, texture);
      this.gl!.texImage2D(
        this.gl!.TEXTURE_2D, 0, this.gl!.RGBA,
        this.canvas!.width, this.canvas!.height, 0,
        this.gl!.RGBA, this.gl!.UNSIGNED_BYTE, null
      );
    });
  }

  private recreateBloomFramebuffer(): void {
    if (!this.gl || !this.canvas || !this.bloomTexture || !this.bloomFramebuffer) return;
    
    // Reallocate downsampled bloom texture
    const bloomWidth = Math.floor(this.canvas.width / 4);
    const bloomHeight = Math.floor(this.canvas.height / 4);
    
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.bloomTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D, 0, this.gl.RGBA,
      bloomWidth, bloomHeight, 0,
      this.gl.RGBA, this.gl.UNSIGNED_BYTE, null
    );
    
    // Reattach to framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.bloomFramebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      this.bloomTexture,
      0
    );
    
    // Verify framebuffer is still complete
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      console.error('[WebGLMorphRenderer] ❌ Bloom framebuffer incomplete after resize:', status);
    }
    
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  private setupTraceTextures(): void {
    if (!this.gl) return;
    
    // Create two textures for ping-pong temporal accumulation
    this.traceTextureCurrent = this.gl.createTexture();
    this.traceTexturePrevious = this.gl.createTexture();
    
    [this.traceTextureCurrent, this.traceTexturePrevious].forEach(texture => {
      this.gl!.bindTexture(this.gl!.TEXTURE_2D, texture);
      this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_WRAP_S, this.gl!.CLAMP_TO_EDGE);
      this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_WRAP_T, this.gl!.CLAMP_TO_EDGE);
      this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_MIN_FILTER, this.gl!.LINEAR);
      this.gl!.texParameteri(this.gl!.TEXTURE_2D, this.gl!.TEXTURE_MAG_FILTER, this.gl!.LINEAR);
    });
    
    console.log('[WebGLMorphRenderer] Trace textures initialized for dreamy birthing effect');
  }

  private setupTraceFramebuffer(): void {
    if (!this.gl || !this.canvas) return;
    
    this.traceFramebuffer = this.gl.createFramebuffer();
    
    // Initialize trace textures with canvas size
    [this.traceTextureCurrent, this.traceTexturePrevious].forEach(texture => {
      if (!texture) return;
      this.gl!.bindTexture(this.gl!.TEXTURE_2D, texture);
      this.gl!.texImage2D(
        this.gl!.TEXTURE_2D, 0, this.gl!.RGBA,
        this.canvas!.width, this.canvas!.height, 0,
        this.gl!.RGBA, this.gl!.UNSIGNED_BYTE, null
      );
    });
    
    console.log('[WebGLMorphRenderer] Trace framebuffer initialized');
  }

  private setupBloom(): void {
    if (!this.gl || !this.canvas) return;
    
    // Create downsampled framebuffer (1/4 resolution)
    this.bloomFramebuffer = this.gl.createFramebuffer();
    this.bloomTexture = this.gl.createTexture();
    
    // Configure bloom texture
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.bloomTexture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    
    // Allocate downsampled texture (1/4 resolution)
    const bloomWidth = Math.floor(this.canvas.width / 4);
    const bloomHeight = Math.floor(this.canvas.height / 4);
    
    this.gl.texImage2D(
      this.gl.TEXTURE_2D, 0, this.gl.RGBA,
      bloomWidth, bloomHeight, 0,
      this.gl.RGBA, this.gl.UNSIGNED_BYTE, null
    );
    
    // CRITICAL FIX: Attach texture to framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.bloomFramebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      this.bloomTexture,
      0
    );
    
    // Verify framebuffer is complete
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      console.error('[WebGLMorphRenderer] ❌ Bloom framebuffer incomplete:', status);
      return;
    }
    
    // Unbind framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    
    console.log(`[WebGLMorphRenderer] ✅ Bloom framebuffer complete: ${bloomWidth}x${bloomHeight}`);
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
    beatBurst: number = 0.0,
    // DJ Crossfade & Ken Burns parameters
    zoomBias: number = 0.0,
    parallaxStrength: number = 0.0,
    burnIntensity: number = 0.0
  ): Promise<void> {
    // CRITICAL: Check coreReady flag first to prevent GL_INVALID_OPERATION
    if (!this.coreReady) {
      console.warn('[WebGLMorphRenderer] Core not ready - skipping render');
      return;
    }
    
    if (!this.gl || !this.canvas || !this.flowProgram || !this.feedbackProgram) {
      console.error('[WebGLMorphRenderer] ❌ Core components missing after ready flag set!');
      this.coreReady = false;
      return;
    }
    
    // Clear any existing GL errors before rendering (don't block on stale errors)
    this.gl.getError();

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
      const colorShiftRate = 0.0; // Disabled - user feedback: color shift too fast
      const detailLevel = (dna[48] ?? 1.0) * audioIntensity;
      const anomalyFactor = (dna[49] ?? 0.5) * audioIntensity;
      
      // ====== PASS 1: Trace Extraction (NEW) ======
      // Extract luminance/edge trace from Frame B for dreamy birthing effect
      if (this.traceProgram && this.traceFramebuffer && this.traceTextureCurrent && this.traceTexturePrevious) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.traceFramebuffer);
        this.gl.useProgram(this.traceProgram);
        
        // Set vertex attributes for trace program
        const tracePosLoc = this.gl.getAttribLocation(this.traceProgram, 'a_position');
        const traceTexLoc = this.gl.getAttribLocation(this.traceProgram, 'a_texCoord');
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.enableVertexAttribArray(tracePosLoc);
        this.gl.vertexAttribPointer(tracePosLoc, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
        this.gl.enableVertexAttribArray(traceTexLoc);
        this.gl.vertexAttribPointer(traceTexLoc, 2, this.gl.FLOAT, false, 0, 0);
        
        // Bind Frame B texture (unit 0)
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.imageTextureB);
        this.gl.uniform1i(this.gl.getUniformLocation(this.traceProgram, 'u_imageB'), 0);
        
        // Bind previous trace texture (unit 1) for temporal accumulation
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.traceTexturePrevious);
        this.gl.uniform1i(this.gl.getUniformLocation(this.traceProgram, 'u_previousTrace'), 1);
        
        // Set resolution uniform
        this.gl.uniform2f(this.gl.getUniformLocation(this.traceProgram, 'u_resolution'), this.canvas.width, this.canvas.height);
        
        // DNA[49]: Trace decay (0-3 → 0.85-0.95 range)
        const traceDecay = 0.85 + ((dna[49] ?? 0) / 10) * 0.1;
        this.gl.uniform1f(this.gl.getUniformLocation(this.traceProgram, 'u_traceDecay'), traceDecay);
        
        // DNA[47]: Trace intensity (0-3 → 0-1 range)
        const traceIntensity = (dna[47] ?? 0) / 3;
        this.gl.uniform1f(this.gl.getUniformLocation(this.traceProgram, 'u_traceIntensity'), traceIntensity);
        
        // Attach traceTextureCurrent to framebuffer
        this.gl.framebufferTexture2D(
          this.gl.FRAMEBUFFER,
          this.gl.COLOR_ATTACHMENT0,
          this.gl.TEXTURE_2D,
          this.traceTextureCurrent,
          0
        );
        
        // Draw quad to extract trace
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
        
        // Ping-pong swap: traceTextureCurrent ↔ traceTexturePrevious
        [this.traceTextureCurrent, this.traceTexturePrevious] = [this.traceTexturePrevious, this.traceTextureCurrent];
      }
      
      // ====== PASS 2: Flow Field (MODIFIED - Added trace texture uniforms) ======
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
      
      // DJ Crossfade & Ken Burns uniforms
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_zoomBias'), zoomBias);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_parallaxStrength'), parallaxStrength);
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_burnIntensity'), burnIntensity);
      
      // Trace texture uniforms (dreamy birthing effect)
      if (this.traceTextureCurrent) {
        // Bind trace texture to unit 2
        this.gl.activeTexture(this.gl.TEXTURE2);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.traceTextureCurrent);
        this.gl.uniform1i(this.gl.getUniformLocation(this.flowProgram, 'u_traceTexture'), 2);
        
        // DNA[47]: Trace multiply strength (0-3 → 0-0.5 range, clamped for safety)
        const traceMultiplyStrength = Math.min(Math.max(((dna[47] ?? 0) / 3) * 0.5, 0), 1);
        this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_traceMultiplyStrength'), traceMultiplyStrength);
        
        // Trace parallax offset in pixels (uses parallaxStrength)
        const traceParallaxOffset = parallaxStrength * 10.0;
        this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_traceParallaxOffset'), traceParallaxOffset);
      }
      
      // DNA[47]: Chromatic drift intensity (0-3 → 0-1.5 pixels)
      // Scale by morphProgress for easing effect
      const chromaticDrift = ((dna[47] ?? 0) / 3) * 1.5 * morphProgress;
      this.gl.uniform1f(this.gl.getUniformLocation(this.flowProgram, 'u_chromaticDrift'), chromaticDrift);
      
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
      
      // ====== PASS 2.5: BLOOM EXTRACTION (NEW) ======
      if (this.bloomProgram && this.bloomFramebuffer && this.bloomTexture) {
        // Render downsampled bloom to bloomTexture
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.bloomFramebuffer);
        const bloomWidth = Math.floor(this.canvas.width / 4);
        const bloomHeight = Math.floor(this.canvas.height / 4);
        this.gl.viewport(0, 0, bloomWidth, bloomHeight);
        
        this.gl.useProgram(this.bloomProgram);
        
        // Set vertex attributes for bloom program
        const bloomPosLoc = this.gl.getAttribLocation(this.bloomProgram, 'a_position');
        const bloomTexLoc = this.gl.getAttribLocation(this.bloomProgram, 'a_texCoord');
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.enableVertexAttribArray(bloomPosLoc);
        this.gl.vertexAttribPointer(bloomPosLoc, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
        this.gl.enableVertexAttribArray(bloomTexLoc);
        this.gl.vertexAttribPointer(bloomTexLoc, 2, this.gl.FLOAT, false, 0, 0);
        
        // Bind flow field output as input
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.renderTexture);
        
        // Set uniforms
        this.gl.uniform1i(this.gl.getUniformLocation(this.bloomProgram, 'u_image'), 0);
        this.gl.uniform2f(this.gl.getUniformLocation(this.bloomProgram, 'u_resolution'), bloomWidth, bloomHeight);
        
        // DNA[48] controls bloom intensity (0-3 → 0-0.8)
        const bloomIntensity = ((dna[48] ?? 1.0) / 3) * 0.8 * burnIntensity;
        this.gl.uniform1f(this.gl.getUniformLocation(this.bloomProgram, 'u_bloomIntensity'), bloomIntensity);
        this.gl.uniform1f(this.gl.getUniformLocation(this.bloomProgram, 'u_bloomThreshold'), 0.6);
        
        // Attach bloom texture to framebuffer
        this.gl.framebufferTexture2D(
          this.gl.FRAMEBUFFER,
          this.gl.COLOR_ATTACHMENT0,
          this.gl.TEXTURE_2D,
          this.bloomTexture,
          0
        );
        
        // Draw bloom
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
        
        // Restore viewport for main render
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      }
      
      // ====== PASS 3: Feedback (UNCHANGED) ======
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
      
      // ====== PASS 3.5: COMPOSITE SAFETY PASS (ALWAYS RUNS) ======
      // CRITICAL: This pass MUST run every frame to apply the composite shader's safety floor
      // It also applies chromatic drift when appropriate
      if (this.compositeProgram) {
        // Calculate morph progress from frame opacities (0 = hold, 1 = full morph)
        const chromaticMorphProgress = nextFrame ? 1.0 - currentFrame.opacity : 0.0;
        
        // DNA[47]: Chromatic drift intensity (0-3 → 0-1.5px), scaled by morphProgress
        // Will be 0 when not morphing or DNA[47] is 0, but we still run the pass for safety floor
        const chromaticDrift = ((dna[47] ?? 0) / 3) * 1.5 * chromaticMorphProgress;
        
        // Copy current screen to feedbackTexture for sampling
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.feedbackTexture);
        this.gl.copyTexImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 0, 0, this.canvas.width, this.canvas.height, 0);
        
        // Apply composite shader (chromatic drift + safety floor)
        this.gl.useProgram(this.compositeProgram);
        
        // Set vertex attributes
        const compositePosLoc = this.gl.getAttribLocation(this.compositeProgram, 'a_position');
        const compositeTexLoc = this.gl.getAttribLocation(this.compositeProgram, 'a_texCoord');
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.enableVertexAttribArray(compositePosLoc);
        this.gl.vertexAttribPointer(compositePosLoc, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
        this.gl.enableVertexAttribArray(compositeTexLoc);
        this.gl.vertexAttribPointer(compositeTexLoc, 2, this.gl.FLOAT, false, 0, 0);
        
        // Bind feedback texture (current screen content)
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.feedbackTexture);
        
        // Set uniforms for chromatic drift (0.0 when not needed, still applies safety floor)
        this.gl.uniform1i(this.gl.getUniformLocation(this.compositeProgram, 'u_texture'), 0);
        this.gl.uniform1f(this.gl.getUniformLocation(this.compositeProgram, 'u_chromaticDrift'), chromaticDrift);
        this.gl.uniform2f(this.gl.getUniformLocation(this.compositeProgram, 'u_resolution'), this.canvas.width, this.canvas.height);
        
        // Draw (ALWAYS - applies safety floor even when chromatic drift is 0)
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
      }
      
      // ====== PASS 3.6: BLOOM COMPOSITE (NEW) ======
      // Composite bloom additively on top of the final image
      // CRITICAL: Use bloomPassthroughProgram (NO safety floor) to avoid adding constant offset
      if (this.bloomTexture && this.bloomPassthroughProgram) {
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.ONE, this.gl.ONE); // Additive blend
        
        this.gl.useProgram(this.bloomPassthroughProgram);
        
        // Set vertex attributes for bloom passthrough program
        const bloomPosLoc = this.gl.getAttribLocation(this.bloomPassthroughProgram, 'a_position');
        const bloomTexLoc = this.gl.getAttribLocation(this.bloomPassthroughProgram, 'a_texCoord');
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.enableVertexAttribArray(bloomPosLoc);
        this.gl.vertexAttribPointer(bloomPosLoc, 2, this.gl.FLOAT, false, 0, 0);
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
        this.gl.enableVertexAttribArray(bloomTexLoc);
        this.gl.vertexAttribPointer(bloomTexLoc, 2, this.gl.FLOAT, false, 0, 0);
        
        // Bind bloom texture
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.bloomTexture);
        
        // Set uniforms (simple passthrough, no safety floor)
        this.gl.uniform1i(this.gl.getUniformLocation(this.bloomPassthroughProgram, 'u_texture'), 0);
        
        // Draw bloom additive (pure bloom, no constant offset)
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
        
        this.gl.disable(this.gl.BLEND);
      }
      
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
      if (this.traceProgram) this.gl.deleteProgram(this.traceProgram);
      if (this.bloomProgram) this.gl.deleteProgram(this.bloomProgram);
      if (this.compositeProgram) this.gl.deleteProgram(this.compositeProgram);
      if (this.bloomPassthroughProgram) this.gl.deleteProgram(this.bloomPassthroughProgram);
      if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
      if (this.texCoordBuffer) this.gl.deleteBuffer(this.texCoordBuffer);
      if (this.imageTextureA) this.gl.deleteTexture(this.imageTextureA);
      if (this.imageTextureB) this.gl.deleteTexture(this.imageTextureB);
      if (this.feedbackTexture) this.gl.deleteTexture(this.feedbackTexture);
      if (this.renderTexture) this.gl.deleteTexture(this.renderTexture);
      if (this.traceTextureCurrent) this.gl.deleteTexture(this.traceTextureCurrent);
      if (this.traceTexturePrevious) this.gl.deleteTexture(this.traceTexturePrevious);
      if (this.bloomTexture) this.gl.deleteTexture(this.bloomTexture);
      if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
      if (this.traceFramebuffer) this.gl.deleteFramebuffer(this.traceFramebuffer);
      if (this.bloomFramebuffer) this.gl.deleteFramebuffer(this.bloomFramebuffer);
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
