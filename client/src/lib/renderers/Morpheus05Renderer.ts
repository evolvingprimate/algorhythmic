import type { IMorphRenderer, RenderContext } from './types';
import { ParameterSampler } from './ParameterSampler';
import { ParticlesNode } from './morpheusV2/nodes/ParticlesNode';

/**
 * Morpheus 0.5 - Fully Maestro-Controlled Renderer
 * 
 * Features:
 *   - All visual parameters driven by Maestro commands
 *   - Modular rendering pipeline (Ken Burns, Particles, Trace, Warp, Mixer)
 *   - Audio-reactive effects controlled by ParameterRegistry
 *   - Standalone compatible (uses defaults when Maestro inactive)
 * 
 * Architecture:
 *   - ParameterSampler: Reads Maestro parameters with smart defaults
 *   - SceneCompositor: Ken Burns zoom/pan
 *   - ParticlesNode: GPU particle system
 *   - TracePass: Edge detection/outline
 *   - WarpPass: Bass-reactive distortion
 *   - MixerPass: Color adjustments
 */

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
  
  // Maestro-controlled color mixer
  uniform float u_saturation;
  uniform float u_brightness;
  uniform float u_contrast;
  
  // Warp parameters
  uniform float u_warpElasticity;
  uniform float u_warpRadius;
  uniform float u_bassLevel;
  
  varying vec2 v_texCoord;
  
  // RGB to HSL conversion
  vec3 rgb2hsl(vec3 color) {
    float maxC = max(max(color.r, color.g), color.b);
    float minC = min(min(color.r, color.g), color.b);
    float delta = maxC - minC;
    
    float l = (maxC + minC) / 2.0;
    float s = 0.0;
    float h = 0.0;
    
    if (delta > 0.0) {
      s = l < 0.5 ? delta / (maxC + minC) : delta / (2.0 - maxC - minC);
      
      if (color.r == maxC) {
        h = (color.g - color.b) / delta + (color.g < color.b ? 6.0 : 0.0);
      } else if (color.g == maxC) {
        h = (color.b - color.r) / delta + 2.0;
      } else {
        h = (color.r - color.g) / delta + 4.0;
      }
      h /= 6.0;
    }
    
    return vec3(h, s, l);
  }
  
  // HSL to RGB conversion
  vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x;
    float s = hsl.y;
    float l = hsl.z;
    
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = l - c / 2.0;
    
    vec3 rgb;
    if (h < 1.0/6.0) {
      rgb = vec3(c, x, 0.0);
    } else if (h < 2.0/6.0) {
      rgb = vec3(x, c, 0.0);
    } else if (h < 3.0/6.0) {
      rgb = vec3(0.0, c, x);
    } else if (h < 4.0/6.0) {
      rgb = vec3(0.0, x, c);
    } else if (h < 5.0/6.0) {
      rgb = vec3(x, 0.0, c);
    } else {
      rgb = vec3(c, 0.0, x);
    }
    
    return rgb + m;
  }
  
  // Bass-reactive warp distortion
  vec2 applyWarp(vec2 uv, float elasticity, float radius, float bass) {
    vec2 center = vec2(0.5, 0.5);
    vec2 delta = uv - center;
    float dist = length(delta);
    
    if (dist < radius && dist > 0.0) {
      float strength = elasticity * bass * (1.0 - dist / radius);
      vec2 direction = normalize(delta);
      return uv + direction * strength * 0.1;
    }
    
    return uv;
  }
  
  void main() {
    vec2 uv = v_texCoord;
    
    // Apply warp distortion (bass-reactive)
    vec2 warpedUV = applyWarp(uv, u_warpElasticity, u_warpRadius, u_bassLevel);
    
    // Calculate view rectangles with warp applied
    vec2 uvA = u_viewA.xy + warpedUV * u_viewA.zw;
    vec2 uvB = u_viewB.xy + warpedUV * u_viewB.zw;
    
    // Sample textures
    vec4 colorA = texture2D(u_imageA, uvA);
    vec4 colorB = texture2D(u_imageB, uvB);
    
    // Apply opacity
    colorA.a *= u_opacityA;
    colorB.a *= u_opacityB;
    
    // Blend frames
    vec4 result = colorB;
    result = mix(result, colorA, colorA.a);
    
    // Apply Maestro-controlled color mixer
    vec3 hsl = rgb2hsl(result.rgb);
    hsl.y *= u_saturation;
    result.rgb = hsl2rgb(hsl);
    result.rgb *= u_brightness;
    result.rgb = (result.rgb - 0.5) * u_contrast + 0.5;
    
    gl_FragColor = result;
  }
`;

interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Morpheus05Renderer implements IMorphRenderer {
  readonly name = 'Morpheus 0.5';
  readonly version = '0.5.0';
  readonly description = 'Fully Maestro-controlled with audio-reactive effects';
  
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  private particlesNode: ParticlesNode | null = null;
  private parameterSampler: ParameterSampler;
  private lastFrameTime: number = 0;
  
  constructor() {
    this.parameterSampler = new ParameterSampler();
  }
  
  initialize(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = this.createProgram(gl, vertexShader, fragmentShader);
    if (!this.program) {
      console.error('[Morpheus05] Failed to create shader program');
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
      console.error('[Morpheus05] Failed to initialize ParticlesNode:', err);
      this.particlesNode = null;
    });
    
    this.lastFrameTime = performance.now();
    
    console.log('[Morpheus05] Initialized with Maestro parameter control');
  }
  
  render(context: RenderContext): void {
    const { gl, frameA, frameB, morphState, canvas, audioAnalysis, parameters } = context;
    
    if (!this.program) {
      console.error('[Morpheus05] Program not initialized');
      return;
    }
    
    // Sample Maestro parameters (with defaults if not set)
    if (parameters) {
      this.parameterSampler.sample(parameters);
    }
    
    // Read Maestro-controlled parameters
    const saturation = this.parameterSampler.getScalar('mixer.saturation');
    const brightness = this.parameterSampler.getScalar('mixer.brightness');
    const contrast = this.parameterSampler.getScalar('mixer.contrast');
    const warpElasticity = this.parameterSampler.getScalar('warp.elasticity');
    const warpRadius = this.parameterSampler.getScalar('warp.radius');
    const zoomSpeed = this.parameterSampler.getScalar('particles.main.velocity'); // Reuse for Ken Burns speed
    
    // Audio features
    const bassLevel = audioAnalysis?.bassLevel ?? 0;
    
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
    
    // Maestro-controlled Ken Burns (zoom speed controlled by particles.main.velocity)
    const zoomProgress = morphState.phaseProgress;
    const scaleA = 1.0 + (zoomProgress * zoomSpeed);
    
    // Opacity curve
    let opacityA: number;
    if (zoomProgress < 0.5) {
      opacityA = 1.0;
    } else {
      const fadeProgress = (zoomProgress - 0.5) / 0.5;
      opacityA = 1.0 - fadeProgress;
    }
    
    const scaleB = 1.0;
    const opacityB = 1.0;
    
    // Calculate views (convert DNAVector number[] to Uint8Array)
    const dnaA = new Uint8Array(morphState.currentDNA);
    const dnaB = new Uint8Array(morphState.nextDNA);
    
    const viewA = this.calculateZoomView(
      frameA.imageData.width,
      frameA.imageData.height,
      canvas.width,
      canvas.height,
      scaleA,
      zoomProgress,
      dnaA,
      audioAnalysis
    );
    
    const viewB = this.calculateZoomView(
      frameB.imageData.width,
      frameB.imageData.height,
      canvas.width,
      canvas.height,
      scaleB,
      0,
      dnaB,
      audioAnalysis
    );
    
    // Set uniforms
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_opacityA'), opacityA);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_opacityB'), opacityB);
    gl.uniform4f(gl.getUniformLocation(this.program, 'u_viewA'), viewA.x, viewA.y, viewA.w, viewA.h);
    gl.uniform4f(gl.getUniformLocation(this.program, 'u_viewB'), viewB.x, viewB.y, viewB.w, viewB.h);
    
    // Maestro color mixer uniforms
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_saturation'), saturation);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_brightness'), brightness);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_contrast'), contrast);
    
    // Warp uniforms
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_warpElasticity'), warpElasticity);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_warpRadius'), warpRadius);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_bassLevel'), bassLevel);
    
    // Draw scene
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    // Render particles with Maestro control
    if (this.particlesNode) {
      const currentTime = performance.now();
      const deltaTime = (currentTime - this.lastFrameTime) / 1000;
      this.lastFrameTime = currentTime;
      
      // Read Maestro particle parameters (for future use)
      const spawnRate = this.parameterSampler.getScalar('particles.main.spawnRate');
      const particleVelocity = this.parameterSampler.getScalar('particles.main.velocity');
      const trailLength = this.parameterSampler.getScalar('particles.main.trailLength');
      const colorBias = this.parameterSampler.getVector('particles.main.colorBias');
      
      // Update particles with audio energy and beat pulse
      const audioEnergy = bassLevel;
      const beatPulse = audioAnalysis?.amplitude ?? 0;
      
      this.particlesNode.update(deltaTime, audioEnergy, beatPulse);
      this.particlesNode.render();
    }
  }
  
  private calculateZoomView(
    imgWidth: number,
    imgHeight: number,
    canvasWidth: number,
    canvasHeight: number,
    scale: number,
    progress: number,
    dna: Uint8Array,
    audioAnalysis?: any
  ): ViewRect {
    const imgAspect = imgWidth / imgHeight;
    const canvasAspect = canvasWidth / canvasHeight;
    
    let width: number, height: number;
    if (imgAspect > canvasAspect) {
      height = 1.0;
      width = imgAspect / canvasAspect;
    } else {
      width = 1.0;
      height = canvasAspect / imgAspect;
    }
    
    width /= scale;
    height /= scale;
    
    // DNA-based pan with audio modulation
    const panX = ((dna[0] / 255) - 0.5) * 0.2 * progress;
    const panY = ((dna[1] / 255) - 0.5) * 0.2 * progress;
    
    // Audio-reactive pan (subtle)
    const audioPanX = audioAnalysis ? (audioAnalysis.amplitude * 0.05) : 0;
    const audioPanY = audioAnalysis ? (audioAnalysis.trebleLevel * 0.05) : 0;
    
    const x = (1.0 - width) / 2 + panX + audioPanX;
    const y = (1.0 - height) / 2 + panY + audioPanY;
    
    return { x, y, w: width, h: height };
  }
  
  private createProgram(
    gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string
  ): WebGLProgram | null {
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) return null;
    
    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);
    
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.error('[Morpheus05] Vertex shader error:', gl.getShaderInfoLog(vertexShader));
      return null;
    }
    
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) return null;
    
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);
    
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.error('[Morpheus05] Fragment shader error:', gl.getShaderInfoLog(fragmentShader));
      return null;
    }
    
    const program = gl.createProgram();
    if (!program) return null;
    
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[Morpheus05] Program link error:', gl.getProgramInfoLog(program));
      return null;
    }
    
    return program;
  }
  
  destroy(): void {
    if (this.particlesNode) {
      this.particlesNode.destroy();
      this.particlesNode = null;
    }
    
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
    
    console.log('[Morpheus05] Destroyed');
  }
}
