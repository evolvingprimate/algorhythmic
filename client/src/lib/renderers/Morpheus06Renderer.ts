import type { IMorphRenderer, RenderContext } from './types';
import { AnchorDetector, type AnchorPoint } from './morpheus06/AnchorDetector';

const vertexShader = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  
  uniform vec2 u_cameraTranslate;
  uniform float u_cameraZoom;
  
  void main() {
    v_texCoord = a_texCoord;
    
    vec2 position = a_position;
    position *= u_cameraZoom;
    position += u_cameraTranslate;
    
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  uniform sampler2D u_imageA;
  uniform sampler2D u_imageB;
  uniform float u_morphProgress;
  uniform vec2 u_anchorCenter;
  uniform float u_anchorSize;
  varying vec2 v_texCoord;
  
  void main() {
    vec4 colorA = texture2D(u_imageA, v_texCoord);
    vec4 colorB = texture2D(u_imageB, v_texCoord);
    
    // Radial mask from anchor center (for subtle effect, not to block full transition)
    vec2 centered = v_texCoord - u_anchorCenter;
    float aspectRatio = 16.0 / 9.0;
    centered.x *= aspectRatio;
    
    float dist = length(centered);
    float radius = u_anchorSize * 1.5;
    float maskInfluence = smoothstep(radius, 0.0, dist);
    
    // Ensure blend reaches 1.0 at morphProgress=1.0 everywhere
    // Inner regions (high maskInfluence) fade in slightly faster
    float blendAmount = u_morphProgress + (1.0 - u_morphProgress) * maskInfluence * 0.3;
    blendAmount = clamp(blendAmount, 0.0, 1.0);
    
    gl_FragColor = mix(colorA, colorB, blendAmount);
  }
`;

export class Morpheus06Renderer implements IMorphRenderer {
  readonly name = 'Morpheus 0.6';
  readonly version = '0.6.0-alpha';
  readonly description = 'Smart anchor zoom - AI finds interesting regions';
  
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  private anchorDetector: AnchorDetector;
  
  private currentAnchor: AnchorPoint | null = null;
  private lastFrameAId: string | null = null;
  
  private uniforms: {
    imageA: WebGLUniformLocation | null;
    imageB: WebGLUniformLocation | null;
    morphProgress: WebGLUniformLocation | null;
    cameraTranslate: WebGLUniformLocation | null;
    cameraZoom: WebGLUniformLocation | null;
    anchorCenter: WebGLUniformLocation | null;
    anchorSize: WebGLUniformLocation | null;
  } | null = null;
  
  constructor() {
    this.anchorDetector = new AnchorDetector();
  }
  
  initialize(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = this.createProgram(gl, vertexShader, fragmentShader);
    if (!this.program) {
      console.error('[Morpheus06] Failed to create shader program');
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
    
    this.uniforms = {
      imageA: gl.getUniformLocation(this.program, 'u_imageA'),
      imageB: gl.getUniformLocation(this.program, 'u_imageB'),
      morphProgress: gl.getUniformLocation(this.program, 'u_morphProgress'),
      cameraTranslate: gl.getUniformLocation(this.program, 'u_cameraTranslate'),
      cameraZoom: gl.getUniformLocation(this.program, 'u_cameraZoom'),
      anchorCenter: gl.getUniformLocation(this.program, 'u_anchorCenter'),
      anchorSize: gl.getUniformLocation(this.program, 'u_anchorSize'),
    };
    
    console.log('[Morpheus06] Initialized - Smart anchor zoom ready');
  }
  
  render(context: RenderContext): void {
    const { gl, frameA, frameB, morphState, canvas } = context;
    
    if (!this.program || !this.uniforms) {
      console.error('[Morpheus06] Program or uniforms not initialized');
      return;
    }
    
    // Detect anchor on first render or when Frame A changes
    const frameAId = frameA.imageData.src;
    if (!this.currentAnchor || this.lastFrameAId !== frameAId) {
      this.currentAnchor = this.anchorDetector.detectAnchor(frameA.imageData);
      this.lastFrameAId = frameAId;
      console.log('[Morpheus06] Anchor detected:', this.currentAnchor);
    }
    
    // Compute zoom transform
    const progress = morphState.morphProgress;
    const { cameraZoom, cameraTranslate } = this.computeZoomTransform(
      progress,
      this.currentAnchor
    );
    
    // Setup rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.useProgram(this.program);
    
    // Bind buffers
    const posLoc = gl.getAttribLocation(this.program, 'a_position');
    const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    
    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frameA.texture);
    gl.uniform1i(this.uniforms.imageA, 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameB.texture);
    gl.uniform1i(this.uniforms.imageB, 1);
    
    // Set uniforms (cached locations for performance)
    gl.uniform1f(this.uniforms.morphProgress, progress);
    gl.uniform2f(
      this.uniforms.cameraTranslate,
      cameraTranslate.x,
      cameraTranslate.y
    );
    gl.uniform1f(this.uniforms.cameraZoom, cameraZoom);
    gl.uniform2f(
      this.uniforms.anchorCenter,
      this.currentAnchor.centerX,
      this.currentAnchor.centerY
    );
    gl.uniform1f(
      this.uniforms.anchorSize,
      this.currentAnchor.size
    );
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  
  /**
   * Compute camera zoom and translation to move toward anchor
   */
  private computeZoomTransform(
    progress: number,
    anchor: AnchorPoint
  ): { cameraZoom: number; cameraTranslate: { x: number; y: number } } {
    // Cubic-in easing with slight overshoot
    const t = progress;
    const easedProgress = t * t * t;
    
    // Zoom from 1.0 to 1.06 (6% zoom in)
    const maxZoom = 1.06;
    const cameraZoom = 1.0 + easedProgress * (maxZoom - 1.0);
    
    // Translate to center the anchor
    // Convert anchor coords (0-1 space) to NDC (-1 to 1 space)
    const targetX = (anchor.centerX - 0.5) * 2.0;
    const targetY = -(anchor.centerY - 0.5) * 2.0; // Flip Y for WebGL
    
    // Smooth movement toward anchor
    const cameraTranslate = {
      x: -targetX * easedProgress * 0.3, // 30% movement
      y: -targetY * easedProgress * 0.3,
    };
    
    return { cameraZoom, cameraTranslate };
  }
  
  destroy(): void {
    if (this.gl) {
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
    }
    this.gl = null;
    this.currentAnchor = null;
    this.lastFrameAId = null;
    this.uniforms = null;
    console.log('[Morpheus06] Destroyed (WebGL resources cleaned up)');
  }
  
  private createProgram(gl: WebGL2RenderingContext, vSource: string, fSource: string): WebGLProgram | null {
    const vShader = this.compileShader(gl, vSource, gl.VERTEX_SHADER);
    const fShader = this.compileShader(gl, fSource, gl.FRAGMENT_SHADER);
    
    if (!vShader || !fShader) return null;
    
    const program = gl.createProgram();
    if (!program) return null;
    
    gl.attachShader(program, vShader);
    gl.attachShader(program, fShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[Morpheus06] Program link error:', gl.getProgramInfoLog(program));
      return null;
    }
    
    return program;
  }
  
  private compileShader(gl: WebGL2RenderingContext, source: string, type: number): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[Morpheus06] Shader compile error:', gl.getShaderInfoLog(shader));
      return null;
    }
    
    return shader;
  }
}
