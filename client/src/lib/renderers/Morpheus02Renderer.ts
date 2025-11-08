import type { IMorphRenderer, RenderContext } from './types';

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
  uniform float u_morphProgress;
  uniform vec4 u_viewA;
  uniform vec4 u_viewB;
  varying vec2 v_texCoord;
  
  void main() {
    vec2 uvA = u_viewA.xy + v_texCoord * u_viewA.zw;
    vec2 uvB = u_viewB.xy + v_texCoord * u_viewB.zw;
    
    vec4 colorA = texture2D(u_imageA, uvA);
    vec4 colorB = texture2D(u_imageB, uvB);
    
    gl_FragColor = mix(colorA, colorB, u_morphProgress);
  }
`;

interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Morpheus02Renderer implements IMorphRenderer {
  readonly name = 'Morpheus 0.2';
  readonly version = '0.2.0';
  readonly description = 'Cross-fade with Ken Burns effect (pan & zoom)';
  
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  
  initialize(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = this.createProgram(gl, vertexShader, fragmentShader);
    if (!this.program) {
      console.error('[Morpheus02] Failed to create shader program');
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
    
    console.log('[Morpheus02] Initialized');
  }
  
  render(context: RenderContext): void {
    const { gl, frameA, frameB, morphState, canvas } = context;
    
    if (!this.program) {
      console.error('[Morpheus02] Program not initialized');
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
    
    const morphProgress = morphState.morphProgress;
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_morphProgress'), morphProgress);
    
    const viewA = this.calculateKenBurnsView(
      frameA.imageData.width,
      frameA.imageData.height,
      canvas.width,
      canvas.height,
      morphState.totalProgress,
      morphState.currentDNA
    );
    
    const viewB = this.calculateKenBurnsView(
      frameB.imageData.width,
      frameB.imageData.height,
      canvas.width,
      canvas.height,
      morphState.totalProgress,
      morphState.currentDNA
    );
    
    gl.uniform4f(
      gl.getUniformLocation(this.program, 'u_viewA'),
      viewA.x, viewA.y, viewA.w, viewA.h
    );
    
    gl.uniform4f(
      gl.getUniformLocation(this.program, 'u_viewB'),
      viewB.x, viewB.y, viewB.w, viewB.h
    );
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  
  private calculateKenBurnsView(
    imageW: number,
    imageH: number,
    screenW: number,
    screenH: number,
    progress: number,
    dna: number[]
  ): ViewRect {
    const screenAspect = screenW / screenH;
    const imageAspect = imageW / imageH;
    
    const zoomStart = 0.5 + (dna[0] ?? 0.5) * 0.2;
    const zoomEnd = 0.85 + (dna[1] ?? 0.5) * 0.15;
    
    const t = this.smootherstep(progress);
    const zoom = zoomStart + (zoomEnd - zoomStart) * t;
    
    let viewW, viewH;
    if (screenAspect > imageAspect) {
      viewW = zoom;
      viewH = zoom * screenAspect / imageAspect;
    } else {
      viewH = zoom;
      viewW = zoom * imageAspect / screenAspect;
    }
    
    viewW = Math.min(viewW, 1.0);
    viewH = Math.min(viewH, 1.0);
    
    const panX = (dna[2] ?? 0.5) - 0.5;
    const panY = (dna[3] ?? 0.5) - 0.5;
    
    const panProgress = this.smootherstep(progress);
    const currentPanX = panX * panProgress * 0.3;
    const currentPanY = panY * panProgress * 0.3;
    
    let x = 0.5 - viewW / 2 + currentPanX;
    let y = 0.5 - viewH / 2 + currentPanY;
    
    x = Math.max(0, Math.min(1 - viewW, x));
    y = Math.max(0, Math.min(1 - viewH, y));
    
    return { x, y, w: viewW, h: viewH };
  }
  
  private smootherstep(x: number): number {
    x = Math.max(0, Math.min(1, x));
    return x * x * x * (x * (x * 6 - 15) + 10);
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
    console.log('[Morpheus02] Destroyed (WebGL resources cleaned up)');
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
      console.error('[Morpheus02] Program link error:', gl.getProgramInfoLog(program));
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
      console.error('[Morpheus02] Shader compile error:', gl.getShaderInfoLog(shader));
      return null;
    }
    
    return shader;
  }
}
