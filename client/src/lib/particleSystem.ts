import { particleVertexShader, particleFragmentShader } from './shaders';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: [number, number, number];
}

export class ParticleSystem {
  private gl: WebGLRenderingContext;
  private canvas: HTMLCanvasElement;
  private program: WebGLProgram | null = null;
  private particles: Particle[] = [];
  private maxParticles: number = 500;
  private emissionRate: number = 20; // particles per burst (increased for impact)
  
  // Beat detection for burst emission
  private lastBassLevel: number = 0;
  private cooldownTimer: number = 0;
  private cooldownDuration: number = 0; // Random cooldown between bursts
  private bassThreshold: number = 0.6; // Threshold for beat detection
  
  private positionBuffer: WebGLBuffer | null = null;
  private velocityBuffer: WebGLBuffer | null = null;
  private lifeBuffer: WebGLBuffer | null = null;
  private colorBuffer: WebGLBuffer | null = null;

  constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.initShaders();
    this.initBuffers();
  }

  private initShaders(): void {
    const vertexShader = this.compileShader(particleVertexShader, this.gl.VERTEX_SHADER);
    const fragmentShader = this.compileShader(particleFragmentShader, this.gl.FRAGMENT_SHADER);

    if (!vertexShader || !fragmentShader) {
      console.error('[ParticleSystem] Failed to compile shaders');
      return;
    }

    this.program = this.gl.createProgram();
    if (!this.program) {
      console.error('[ParticleSystem] Failed to create program');
      return;
    }

    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      console.error('[ParticleSystem] Program link error:', this.gl.getProgramInfoLog(this.program));
      this.program = null;
    }
  }

  private compileShader(source: string, type: number): WebGLShader | null {
    const shader = this.gl.createShader(type);
    if (!shader) return null;

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('[ParticleSystem] Shader compile error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private initBuffers(): void {
    this.positionBuffer = this.gl.createBuffer();
    this.velocityBuffer = this.gl.createBuffer();
    this.lifeBuffer = this.gl.createBuffer();
    this.colorBuffer = this.gl.createBuffer();
  }

  // Sample color from image at position
  private sampleImageColor(imageData: ImageData, x: number, y: number): [number, number, number] {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const idx = (iy * imageData.width + ix) * 4;
    
    return [
      imageData.data[idx] / 255,
      imageData.data[idx + 1] / 255,
      imageData.data[idx + 2] / 255
    ];
  }

  // Calculate luminance gradient (edge detection)
  private calculateGradient(imageData: ImageData, x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    
    // Sobel operator for edge detection
    const getLum = (dx: number, dy: number): number => {
      const px = Math.max(0, Math.min(imageData.width - 1, ix + dx));
      const py = Math.max(0, Math.min(imageData.height - 1, iy + dy));
      const idx = (py * imageData.width + px) * 4;
      return (imageData.data[idx] * 0.299 + imageData.data[idx + 1] * 0.587 + imageData.data[idx + 2] * 0.114) / 255;
    };
    
    const gx = -getLum(-1, -1) + getLum(1, -1) - 2 * getLum(-1, 0) + 2 * getLum(1, 0) - getLum(-1, 1) + getLum(1, 1);
    const gy = -getLum(-1, -1) - 2 * getLum(0, -1) - getLum(1, -1) + getLum(-1, 1) + 2 * getLum(0, 1) + getLum(1, 1);
    
    return Math.sqrt(gx * gx + gy * gy);
  }

  // Find edge positions for emission (rejection sampling)
  private findEdgePosition(imageData: ImageData): { x: number; y: number } {
    // Try rejection sampling up to 10 times to find edge
    for (let attempts = 0; attempts < 10; attempts++) {
      const x = Math.random() * imageData.width;
      const y = Math.random() * imageData.height;
      const gradient = this.calculateGradient(imageData, x, y);
      
      // Accept positions with gradient > threshold (edges)
      if (gradient > 0.3) {
        // Scale to canvas coordinates
        return {
          x: (x / imageData.width) * this.canvas.width,
          y: (y / imageData.height) * this.canvas.height
        };
      }
    }
    
    // Fallback to random if no edge found
    return {
      x: Math.random() * this.canvas.width,
      y: Math.random() * this.canvas.height
    };
  }

  // Emit new particles that trace from foreground to background image
  emitParticles(
    foregroundData: ImageData,
    backgroundData: ImageData,
    audioIntensity: number,
    morphProgress: number,
    bassLevel: number = 0
  ): void {
    if (audioIntensity === 0) return; // No emission during hold phase

    // Detect bass peak (beat) for burst emission
    const bassPeak = bassLevel > this.bassThreshold && bassLevel > this.lastBassLevel + 0.1;
    this.lastBassLevel = bassLevel;
    
    // Only emit on bass peaks when not in cooldown
    if (!bassPeak || this.cooldownTimer > 0) {
      return; // No constant emission - only bursts!
    }
    
    // Start cooldown with random duration (1-3 seconds)
    this.cooldownDuration = 60 + Math.random() * 120; // 60-180 frames @ 60fps
    this.cooldownTimer = this.cooldownDuration;
    
    const emissionCount = Math.floor(this.emissionRate);
    
    for (let i = 0; i < emissionCount; i++) {
      if (this.particles.length >= this.maxParticles) {
        // Remove oldest particle
        this.particles.shift();
      }

      // Find edge position from foreground image for shape tracing
      const edgePos = this.findEdgePosition(foregroundData);
      const x = edgePos.x;
      const y = edgePos.y;

      // Scale to image dimensions
      const imgX = (x / this.canvas.width) * foregroundData.width;
      const imgY = (y / this.canvas.height) * foregroundData.height;

      // Sample colors from both images at same UV position
      const colorFg = this.sampleImageColor(foregroundData, imgX, imgY);
      const colorBg = this.sampleImageColor(backgroundData, imgX, imgY);

      // Interpolate color based on morph progress
      const color: [number, number, number] = [
        colorFg[0] * (1 - morphProgress) + colorBg[0] * morphProgress,
        colorFg[1] * (1 - morphProgress) + colorBg[1] * morphProgress,
        colorFg[2] * (1 - morphProgress) + colorBg[2] * morphProgress,
      ];

      // Velocity with outward flow (tracing from foreground through background)
      const centerX = this.canvas.width / 2;
      const centerY = this.canvas.height / 2;
      const angle = Math.atan2(y - centerY, x - centerX) + (Math.random() - 0.5) * 0.5;
      const speed = 0.5 + Math.random() * 1.5;

      // Shorter, randomized lifetimes (0.5-1.0 seconds)
      const maxLife = 0.5 + Math.random() * 0.5;
      
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: maxLife, // Start at maxLife, not 1.0!
        maxLife: maxLife,
        color
      });
    }
  }

  update(deltaTime: number): void {
    const dt = deltaTime / 16.67; // Normalize to 60fps
    
    // Decrement cooldown timer based on actual elapsed time (not frames)
    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= dt; // Use normalized delta time, not frame count
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      // Update position
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      
      // Apply gravity/drag
      p.vy += 0.1 * dt;
      p.vx *= 0.99;
      p.vy *= 0.99;
      
      // Decrease life proportional to elapsed time
      // dt is normalized to 60fps, so 1 second = 60 normalized units
      p.life -= dt / 60.0; // Particle dies after maxLife seconds
      
      // Remove dead particles
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  render(): void {
    if (!this.program || this.particles.length === 0) return;

    this.gl.useProgram(this.program);
    
    // Prepare data arrays
    const positions = new Float32Array(this.particles.length * 2);
    const velocities = new Float32Array(this.particles.length * 2);
    const lives = new Float32Array(this.particles.length);
    const colors = new Float32Array(this.particles.length * 3);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      positions[i * 2] = p.x;
      positions[i * 2 + 1] = p.y;
      velocities[i * 2] = p.vx;
      velocities[i * 2 + 1] = p.vy;
      lives[i] = p.life;
      colors[i * 3] = p.color[0];
      colors[i * 3 + 1] = p.color[1];
      colors[i * 3 + 2] = p.color[2];
    }

    // Upload buffers
    const posLoc = this.gl.getAttribLocation(this.program, 'a_position');
    const velLoc = this.gl.getAttribLocation(this.program, 'a_velocity');
    const lifeLoc = this.gl.getAttribLocation(this.program, 'a_life');
    const colorLoc = this.gl.getAttribLocation(this.program, 'a_color');

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.DYNAMIC_DRAW);
    this.gl.enableVertexAttribArray(posLoc);
    this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.velocityBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, velocities, this.gl.DYNAMIC_DRAW);
    this.gl.enableVertexAttribArray(velLoc);
    this.gl.vertexAttribPointer(velLoc, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.lifeBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, lives, this.gl.DYNAMIC_DRAW);
    this.gl.enableVertexAttribArray(lifeLoc);
    this.gl.vertexAttribPointer(lifeLoc, 1, this.gl.FLOAT, false, 0, 0);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, colors, this.gl.DYNAMIC_DRAW);
    this.gl.enableVertexAttribArray(colorLoc);
    this.gl.vertexAttribPointer(colorLoc, 3, this.gl.FLOAT, false, 0, 0);

    // Set uniforms
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_time'), Date.now() / 1000);
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_pointSize'), 6.0);
    this.gl.uniform2f(
      this.gl.getUniformLocation(this.program, 'u_resolution'),
      this.canvas.width,
      this.canvas.height
    );

    // Enable blending for transparency
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE); // Additive blending for glow

    // Draw particles
    this.gl.drawArrays(this.gl.POINTS, 0, this.particles.length);

    // Restore blend mode
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  destroy(): void {
    if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
    if (this.velocityBuffer) this.gl.deleteBuffer(this.velocityBuffer);
    if (this.lifeBuffer) this.gl.deleteBuffer(this.lifeBuffer);
    if (this.colorBuffer) this.gl.deleteBuffer(this.colorBuffer);
    if (this.program) this.gl.deleteProgram(this.program);
  }
}
