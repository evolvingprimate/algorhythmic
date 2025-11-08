/**
 * ParticlesNode - GPGPU Particle System with Transform Feedback
 * 
 * Features:
 * - Ping-pong transform feedback for particle physics on GPU
 * - Audio-reactive spawning, velocity, and color
 * - Integration with Maestro parameter system
 * - Efficient rendering with instanced drawing
 */

interface ParticleAttributes {
  position: number[];  // vec3
  velocity: number[];  // vec3
  life: number;       // float (0-1)
  seed: number;       // float (random seed)
}

interface ParticleUniforms {
  deltaTime: number;
  audioEnergy: number;
  beatPulse: number;
  spawnRate: number;
  damping: number;
  velocity: number;
  colorBias: number[];  // RGB
  trailLength: number;
  time: number;
}

export class ParticlesNode {
  private gl: WebGL2RenderingContext;
  private maxParticles: number = 10000;
  
  // Transform feedback (ping-pong buffers)
  private currentVAO: WebGLVertexArrayObject | null = null;
  private nextVAO: WebGLVertexArrayObject | null = null;
  private currentBuffer: WebGLBuffer | null = null;
  private nextBuffer: WebGLBuffer | null = null;
  
  // Shader programs
  private updateProgram: WebGLProgram | null = null;
  private renderProgram: WebGLProgram | null = null;
  
  // Transform feedback object
  private transformFeedback: WebGLTransformFeedback | null = null;
  
  // Uniforms
  private uniforms: ParticleUniforms = {
    deltaTime: 0,
    audioEnergy: 0,
    beatPulse: 0,
    spawnRate: 0.1,
    damping: 0.98,
    velocity: 1.0,
    colorBias: [1.0, 1.0, 1.0],
    trailLength: 0.5,
    time: 0,
  };
  
  private lastUpdateTime: number = 0;
  private isInitialized: boolean = false;
  
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  
  /**
   * Initialize buffers, shaders, and transform feedback
   */
  async initialize(): Promise<void> {
    console.log('[ParticlesNode] Initializing...');
    
    try {
      // Create ping-pong buffers
      this.createBuffers();
      
      // Create shader programs
      await this.createShaders();
      
      // Create transform feedback object
      this.transformFeedback = this.gl.createTransformFeedback();
      
      this.isInitialized = true;
      this.lastUpdateTime = performance.now();
      
      console.log('[ParticlesNode] Initialized successfully');
    } catch (error) {
      console.error('[ParticlesNode] Initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Create ping-pong buffers for transform feedback
   * 
   * Buffer layout per particle (8 floats = 32 bytes):
   * - position: vec3 (12 bytes)
   * - velocity: vec3 (12 bytes)
   * - life: float (4 bytes)
   * - seed: float (4 bytes)
   */
  private createBuffers(): void {
    const floatsPerParticle = 8; // pos(3) + vel(3) + life(1) + seed(1)
    const bufferSize = this.maxParticles * floatsPerParticle;
    
    // Initialize particle data (all dead particles)
    const initialData = new Float32Array(bufferSize);
    for (let i = 0; i < this.maxParticles; i++) {
      const offset = i * floatsPerParticle;
      // Position (random in normalized space)
      initialData[offset + 0] = (Math.random() - 0.5) * 2;
      initialData[offset + 1] = (Math.random() - 0.5) * 2;
      initialData[offset + 2] = 0;
      // Velocity
      initialData[offset + 3] = 0;
      initialData[offset + 4] = 0;
      initialData[offset + 5] = 0;
      // Life (0 = dead)
      initialData[offset + 6] = 0;
      // Seed (random)
      initialData[offset + 7] = Math.random();
    }
    
    // Create buffer A
    this.currentBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.currentBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, initialData, this.gl.DYNAMIC_COPY);
    
    // Create buffer B (same data)
    this.nextBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.nextBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, initialData, this.gl.DYNAMIC_COPY);
    
    // Create VAO for buffer A
    if (!this.currentBuffer || !this.nextBuffer) {
      throw new Error('Failed to create particle buffers');
    }
    this.currentVAO = this.createVAO(this.currentBuffer);
    
    // Create VAO for buffer B
    this.nextVAO = this.createVAO(this.nextBuffer);
    
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
    this.gl.bindVertexArray(null);
    
    console.log(`[ParticlesNode] Created buffers for ${this.maxParticles} particles`);
  }
  
  /**
   * Create a VAO for a given buffer with particle attributes
   */
  private createVAO(buffer: WebGLBuffer): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray();
    this.gl.bindVertexArray(vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    
    const stride = 8 * 4; // 8 floats * 4 bytes
    
    // Position (location 0)
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 3, this.gl.FLOAT, false, stride, 0);
    
    // Velocity (location 1)
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 3, this.gl.FLOAT, false, stride, 12);
    
    // Life (location 2)
    this.gl.enableVertexAttribArray(2);
    this.gl.vertexAttribPointer(2, 1, this.gl.FLOAT, false, stride, 24);
    
    // Seed (location 3)
    this.gl.enableVertexAttribArray(3);
    this.gl.vertexAttribPointer(3, 1, this.gl.FLOAT, false, stride, 28);
    
    return vao!;
  }
  
  /**
   * Create and compile shader programs
   */
  private async createShaders(): Promise<void> {
    // Update shader (transform feedback)
    const updateVertSrc = this.getUpdateVertexShader();
    const updateFragSrc = `#version 300 es
      void main() {
        // Transform feedback only, no fragment output
      }
    `;
    
    this.updateProgram = this.createProgram(updateVertSrc, updateFragSrc, [
      'out_position',
      'out_velocity',
      'out_life',
      'out_seed',
    ]);
    
    // Render shader
    const renderVertSrc = this.getRenderVertexShader();
    const renderFragSrc = this.getRenderFragmentShader();
    
    this.renderProgram = this.createProgram(renderVertSrc, renderFragSrc);
  }
  
  /**
   * Create shader program with optional transform feedback varyings
   */
  private createProgram(
    vertSrc: string,
    fragSrc: string,
    varyings?: string[]
  ): WebGLProgram {
    const vertShader = this.compileShader(this.gl.VERTEX_SHADER, vertSrc);
    const fragShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragSrc);
    
    const program = this.gl.createProgram()!;
    this.gl.attachShader(program, vertShader);
    this.gl.attachShader(program, fragShader);
    
    // Set transform feedback varyings before linking
    // Use INTERLEAVED_ATTRIBS since our buffer has all attributes in one interleaved stream
    if (varyings) {
      this.gl.transformFeedbackVaryings(program, varyings, this.gl.INTERLEAVED_ATTRIBS);
    }
    
    this.gl.linkProgram(program);
    
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program);
      throw new Error(`Shader program link failed: ${info}`);
    }
    
    return program;
  }
  
  /**
   * Compile a shader
   */
  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${info}`);
    }
    
    return shader;
  }
  
  /**
   * Update particle simulation (transform feedback pass)
   */
  update(deltaTime: number, audioEnergy: number, beatPulse: number): void {
    if (!this.isInitialized || !this.updateProgram) return;
    
    this.uniforms.deltaTime = deltaTime;
    this.uniforms.audioEnergy = audioEnergy;
    this.uniforms.beatPulse = beatPulse;
    this.uniforms.time = performance.now() / 1000;
    
    // Use update program
    this.gl.useProgram(this.updateProgram);
    
    // Set uniforms
    this.setUpdateUniforms();
    
    // Bind input VAO (current particles)
    this.gl.bindVertexArray(this.currentVAO);
    
    // Bind transform feedback (output to next buffer)
    // Using INTERLEAVED_ATTRIBS, so bind to index 0 only
    this.gl.bindTransformFeedback(this.gl.TRANSFORM_FEEDBACK, this.transformFeedback);
    this.gl.bindBufferBase(this.gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.nextBuffer);
    
    // Disable rasterization (we only want transform feedback)
    this.gl.enable(this.gl.RASTERIZER_DISCARD);
    
    // Run transform feedback
    this.gl.beginTransformFeedback(this.gl.POINTS);
    this.gl.drawArrays(this.gl.POINTS, 0, this.maxParticles);
    this.gl.endTransformFeedback();
    
    // Re-enable rasterization
    this.gl.disable(this.gl.RASTERIZER_DISCARD);
    
    // Unbind
    this.gl.bindTransformFeedback(this.gl.TRANSFORM_FEEDBACK, null);
    this.gl.bindVertexArray(null);
    
    // Swap buffers (ping-pong)
    this.swapBuffers();
  }
  
  /**
   * Render particles to screen
   */
  render(viewMatrix?: number[], projectionMatrix?: number[]): void {
    if (!this.isInitialized || !this.renderProgram) return;
    
    this.gl.useProgram(this.renderProgram);
    
    // Set render uniforms
    this.setRenderUniforms(viewMatrix, projectionMatrix);
    
    // Bind current VAO
    this.gl.bindVertexArray(this.currentVAO);
    
    // Enable blending for particle trails
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    
    // Draw particles
    this.gl.drawArrays(this.gl.POINTS, 0, this.maxParticles);
    
    // Cleanup
    this.gl.disable(this.gl.BLEND);
    this.gl.bindVertexArray(null);
  }
  
  /**
   * Update parameters from Maestro
   */
  updateParameters(params: Map<string, number | number[] | boolean | string>): void {
    // Read parameters from Maestro's parameter store
    const spawnRate = params.get('particles.spawnRate');
    if (typeof spawnRate === 'number') this.uniforms.spawnRate = spawnRate;
    
    const damping = params.get('particles.damping');
    if (typeof damping === 'number') this.uniforms.damping = damping;
    
    const velocity = params.get('particles.velocity');
    if (typeof velocity === 'number') this.uniforms.velocity = velocity;
    
    const colorBias = params.get('mixer.colorBias');
    if (Array.isArray(colorBias)) this.uniforms.colorBias = colorBias.slice(0, 3);
    
    const trailLength = params.get('particles.trailLength');
    if (typeof trailLength === 'number') this.uniforms.trailLength = trailLength;
  }
  
  /**
   * Swap ping-pong buffers
   */
  private swapBuffers(): void {
    // Swap VAOs
    const tempVAO = this.currentVAO;
    this.currentVAO = this.nextVAO;
    this.nextVAO = tempVAO;
    
    // Swap buffers
    const tempBuffer = this.currentBuffer;
    this.currentBuffer = this.nextBuffer;
    this.nextBuffer = tempBuffer;
  }
  
  /**
   * Set uniforms for update shader
   */
  private setUpdateUniforms(): void {
    if (!this.updateProgram) return;
    
    const loc = (name: string) => this.gl.getUniformLocation(this.updateProgram!, name);
    
    this.gl.uniform1f(loc('u_deltaTime'), this.uniforms.deltaTime);
    this.gl.uniform1f(loc('u_audioEnergy'), this.uniforms.audioEnergy);
    this.gl.uniform1f(loc('u_beatPulse'), this.uniforms.beatPulse);
    this.gl.uniform1f(loc('u_spawnRate'), this.uniforms.spawnRate);
    this.gl.uniform1f(loc('u_damping'), this.uniforms.damping);
    this.gl.uniform1f(loc('u_velocity'), this.uniforms.velocity);
    this.gl.uniform1f(loc('u_time'), this.uniforms.time);
  }
  
  /**
   * Set uniforms for render shader
   */
  private setRenderUniforms(viewMatrix?: number[], projectionMatrix?: number[]): void {
    if (!this.renderProgram) return;
    
    const loc = (name: string) => this.gl.getUniformLocation(this.renderProgram!, name);
    
    this.gl.uniform3fv(loc('u_colorBias'), this.uniforms.colorBias);
    this.gl.uniform1f(loc('u_trailLength'), this.uniforms.trailLength);
    this.gl.uniform1f(loc('u_time'), this.uniforms.time);
    
    // Optional view/projection matrices for 3D
    if (viewMatrix) {
      this.gl.uniformMatrix4fv(loc('u_viewMatrix'), false, viewMatrix);
    }
    if (projectionMatrix) {
      this.gl.uniformMatrix4fv(loc('u_projectionMatrix'), false, projectionMatrix);
    }
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.currentBuffer) this.gl.deleteBuffer(this.currentBuffer);
    if (this.nextBuffer) this.gl.deleteBuffer(this.nextBuffer);
    if (this.currentVAO) this.gl.deleteVertexArray(this.currentVAO);
    if (this.nextVAO) this.gl.deleteVertexArray(this.nextVAO);
    if (this.updateProgram) this.gl.deleteProgram(this.updateProgram);
    if (this.renderProgram) this.gl.deleteProgram(this.renderProgram);
    if (this.transformFeedback) this.gl.deleteTransformFeedback(this.transformFeedback);
    
    this.isInitialized = false;
    console.log('[ParticlesNode] Destroyed');
  }
  
  // Shader source code (to be implemented next)
  private getUpdateVertexShader(): string {
    return `#version 300 es
precision highp float;

// Input attributes
in vec3 position;
in vec3 velocity;
in float life;
in float seed;

// Output attributes (transform feedback)
out vec3 out_position;
out vec3 out_velocity;
out float out_life;
out float out_seed;

// Uniforms
uniform float u_deltaTime;
uniform float u_audioEnergy;
uniform float u_beatPulse;
uniform float u_spawnRate;
uniform float u_damping;
uniform float u_velocity;
uniform float u_time;

// Simple hash function for pseudo-random numbers
float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

vec3 hash3(float n) {
  return vec3(
    hash(n),
    hash(n + 1.0),
    hash(n + 2.0)
  );
}

void main() {
  // Dead particle check
  if (life <= 0.0) {
    // Spawn new particle based on spawn rate + beat pulse
    float spawnChance = u_spawnRate + u_beatPulse * 0.5;
    float rnd = hash(seed + u_time);
    
    if (rnd < spawnChance * u_deltaTime * 60.0) {
      // Spawn at center with random velocity
      vec3 rndVec = hash3(seed + u_time * 3.0) * 2.0 - 1.0;
      
      out_position = vec3(0.0, 0.0, 0.0);
      out_velocity = normalize(rndVec) * u_velocity * (0.5 + u_audioEnergy);
      out_life = 1.0;
      out_seed = seed;
    } else {
      // Stay dead
      out_position = position;
      out_velocity = velocity;
      out_life = 0.0;
      out_seed = seed;
    }
  } else {
    // Update living particle
    vec3 newVelocity = velocity * u_damping;
    vec3 newPosition = position + newVelocity * u_deltaTime;
    float newLife = life - u_deltaTime * 0.3; // Decay over ~3 seconds
    
    out_position = newPosition;
    out_velocity = newVelocity;
    out_life = max(newLife, 0.0);
    out_seed = seed;
  }
}
`;
  }
  
  private getRenderVertexShader(): string {
    return `#version 300 es
precision highp float;

// Input attributes
in vec3 position;
in vec3 velocity;
in float life;
in float seed;

// Outputs to fragment shader
out float v_life;
out vec3 v_velocity;
out float v_seed;

// Uniforms
uniform vec3 u_colorBias;
uniform float u_trailLength;
uniform float u_time;

void main() {
  // Only render living particles
  if (life > 0.0) {
    gl_Position = vec4(position, 1.0);
    gl_PointSize = mix(1.0, 8.0, life) * (1.0 + length(velocity) * 0.5);
    
    v_life = life;
    v_velocity = velocity;
    v_seed = seed;
  } else {
    // Dead particles off-screen
    gl_Position = vec4(0.0, 0.0, -10.0, 1.0);
    gl_PointSize = 0.0;
    v_life = 0.0;
    v_velocity = vec3(0.0);
    v_seed = seed;
  }
}
`;
  }
  
  private getRenderFragmentShader(): string {
    return `#version 300 es
precision highp float;

// Inputs from vertex shader
in float v_life;
in vec3 v_velocity;
in float v_seed;

// Output
out vec4 fragColor;

// Uniforms
uniform vec3 u_colorBias;
uniform float u_trailLength;
uniform float u_time;

void main() {
  // Circular particle shape
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  
  // Soft edge
  float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
  
  // Color based on velocity and life
  vec3 color = u_colorBias;
  color += normalize(abs(v_velocity)) * 0.3;
  
  // Trail effect (fade based on life)
  alpha *= v_life * (0.3 + u_trailLength * 0.7);
  
  fragColor = vec4(color, alpha);
}
`;
  }
}
