import type { IMorphRenderer, RenderContext } from './types';
import { ParticlesNode } from './morpheusV2/nodes/ParticlesNode';

const vertexShader = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  
  void main() {
    v_texCoord = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  uniform sampler2D u_imageA;
  uniform sampler2D u_imageB;
  uniform float u_opacityA;
  uniform float u_opacityB;
  uniform vec4 u_viewA;
  uniform vec4 u_viewB;
  varying vec2 v_texCoord;
  
  void main() {
    vec2 uvA = u_viewA.xy + v_texCoord * u_viewA.zw;
    vec2 uvB = u_viewB.xy + v_texCoord * u_viewB.zw;
    
    vec4 colorA = texture2D(u_imageA, uvA);
    vec4 colorB = texture2D(u_imageB, uvB);
    
    // Apply opacity to each frame
    colorA.a *= u_opacityA;
    colorB.a *= u_opacityB;
    
    // Blend: Frame B is background, Frame A is foreground
    vec4 result = colorB;
    result = mix(result, colorA, colorA.a);
    
    gl_FragColor = result;
  }
`;

interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Morpheus03Renderer implements IMorphRenderer {
  readonly name = 'Morpheus 0.3';
  readonly version = '0.3.0';
  readonly description = 'Single-direction zoom toward camera with music-reactive pan';
  
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  private particlesNode: ParticlesNode | null = null;
  private lastFrameTime: number = 0;
  
  initialize(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = this.createProgram(gl, vertexShader, fragmentShader);
    if (!this.program) {
      console.error('[Morpheus03] Failed to create shader program');
      return;
    }
    
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    const texCoords = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ]);
    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    
    // Initialize particle system
    this.particlesNode = new ParticlesNode(gl);
    this.particlesNode.initialize().catch(err => {
      console.error('[Morpheus03] Failed to initialize ParticlesNode:', err);
      this.particlesNode = null;
    });
    
    this.lastFrameTime = performance.now();
    
    console.log('[Morpheus03] Initialized with particle system');
  }
  
  render(context: RenderContext): void {
    const { gl, frameA, frameB, morphState, canvas, audioAnalysis } = context;
    
    if (!this.program) {
      console.error('[Morpheus03] Program not initialized');
      return;
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.useProgram(this.program);
    
    const posLoc = gl.getAttribLocation(this.program, 'a_position');
    const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frameA.texture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_imageA'), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameB.texture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_imageB'), 1);
    
    // Calculate zoom progress (0 to 1 over 5 minutes)
    // phaseProgress is already 0-1 from morphEngine
    const zoomProgress = morphState.phaseProgress;
    
    // Frame A: Zooms from 100% to 200%
    // Scale: 1.0 + (zoomProgress * 1.0) = 1.0 to 2.0
    const scaleA = 1.0 + zoomProgress;
    
    // Opacity: 100% until 50% progress (150% scale), then fades to 0% by 100% progress (200% scale)
    let opacityA: number;
    if (zoomProgress < 0.5) {
      opacityA = 1.0;
    } else {
      // Fade from 100% to 0% over the second half of the cycle
      const fadeProgress = (zoomProgress - 0.5) / 0.5;
      opacityA = 1.0 - fadeProgress;
    }
    
    // Frame B: Static at 100% scale, 100% opacity (background)
    const scaleB = 1.0;
    const opacityB = 1.0;
    
    // Calculate views with music-reactive pan
    const viewA = this.calculateZoomView(
      frameA.imageData.width,
      frameA.imageData.height,
      canvas.width,
      canvas.height,
      scaleA,
      zoomProgress,
      morphState.currentDNA,
      audioAnalysis
    );
    
    const viewB = this.calculateZoomView(
      frameB.imageData.width,
      frameB.imageData.height,
      canvas.width,
      canvas.height,
      scaleB,
      0, // Static, no pan
      morphState.nextDNA,
      undefined // No audio reactivity for background
    );
    
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_opacityA'), opacityA);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_opacityB'), opacityB);
    gl.uniform4f(gl.getUniformLocation(this.program, 'u_viewA'), viewA.x, viewA.y, viewA.w, viewA.h);
    gl.uniform4f(gl.getUniformLocation(this.program, 'u_viewB'), viewB.x, viewB.y, viewB.w, viewB.h);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    gl.disable(gl.BLEND);
    
    // Update and render particles overlay
    if (this.particlesNode && context.parameters) {
      const now = performance.now();
      const deltaTime = (now - this.lastFrameTime) / 1000; // Convert to seconds
      this.lastFrameTime = now;
      
      // Update particles from Maestro parameters
      this.particlesNode.updateParameters(context.parameters);
      
      // Update particle simulation
      const audioEnergy = audioAnalysis?.amplitude || 0;
      const beatPulse = (audioAnalysis?.bassLevel || 0) + (audioAnalysis?.trebleLevel || 0);
      this.particlesNode.update(deltaTime, audioEnergy, beatPulse);
      
      // Render particles as overlay
      this.particlesNode.render();
    }
  }
  
  private calculateZoomView(
    imgW: number,
    imgH: number,
    canvasW: number,
    canvasH: number,
    scale: number,
    progress: number,
    dna: number[],
    audioAnalysis?: { bassLevel: number; trebleLevel: number }
  ): ViewRect {
    const imgAspect = imgW / imgH;
    const canvasAspect = canvasW / canvasH;
    
    let viewW: number, viewH: number;
    if (imgAspect > canvasAspect) {
      viewH = 1;
      viewW = canvasAspect / imgAspect;
    } else {
      viewW = 1;
      viewH = imgAspect / canvasAspect;
    }
    
    // Apply zoom scale (inverse because we're zooming into the texture)
    viewW /= scale;
    viewH /= scale;
    
    // Generate subtle pan path based on DNA (like a dancer gently swaying)
    const panSeedX = dna[0] || 0.5; // DNA[0] controls horizontal direction
    const panSeedY = dna[1] || 0.5; // DNA[1] controls vertical direction
    
    // Very subtle base target (±2% max) - gentle directional bias
    const targetX = (panSeedX - 0.5) * 0.04; // ±2% horizontal
    const targetY = (panSeedY - 0.5) * 0.04; // ±2% vertical
    
    // Slow, smooth progression with gentle easing
    const easedProgress = progress < 0.5 
      ? 2 * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    
    let panX = targetX * easedProgress;
    let panY = targetY * easedProgress;
    
    // Subtle beat-reactive sway (±1% max) - like a dancer moving to the beat
    if (audioAnalysis) {
      // Normalize to center around 0 and scale down to ±1%
      const bassModulation = (audioAnalysis.bassLevel - 0.5) * 0.02; // Bass affects X (±1%)
      const trebleModulation = (audioAnalysis.trebleLevel - 0.5) * 0.02; // Treble affects Y (±1%)
      
      panX += bassModulation;
      panY += trebleModulation;
    }
    
    // Calculate view position (centered, then panned)
    let x = 0.5 - viewW / 2 + panX;
    let y = 0.5 - viewH / 2 + panY;
    
    // Clamp UV coordinates to prevent texture repeat or black borders
    // Ensure view rect stays within [0, 1] texture bounds
    x = Math.max(0, Math.min(1 - viewW, x));
    y = Math.max(0, Math.min(1 - viewH, y));
    
    return { x, y, w: viewW, h: viewH };
  }
  
  private createProgram(
    gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string
  ): WebGLProgram | null {
    const vertexShader = this.createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    
    if (!vertexShader || !fragmentShader) {
      return null;
    }
    
    const program = gl.createProgram();
    if (!program) {
      return null;
    }
    
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[Morpheus03] Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    
    return program;
  }
  
  private createShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) {
      return null;
    }
    
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[Morpheus03] Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }
  
  destroy(): void {
    if (!this.gl) return;
    
    if (this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
    
    if (this.positionBuffer) {
      this.gl.deleteBuffer(this.positionBuffer);
      this.positionBuffer = null;
    }
    
    if (this.texCoordBuffer) {
      this.gl.deleteBuffer(this.texCoordBuffer);
      this.texCoordBuffer = null;
    }
    
    if (this.particlesNode) {
      this.particlesNode.destroy();
      this.particlesNode = null;
    }
    
    console.log('[Morpheus03] Destroyed');
  }
}
