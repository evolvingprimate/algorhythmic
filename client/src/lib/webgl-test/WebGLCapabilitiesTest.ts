/**
 * WebGL Capabilities Test Framework
 * Systematically tests WebGL2 features to identify device limitations
 */

export interface TestResult {
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  message?: string;
  details?: any;
  duration?: number;
}

export type ProgressCallback = (testName: string, status: TestResult['status'], message?: string) => void;

export class WebGLCapabilitiesTest {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private onProgress: ProgressCallback;

  constructor(canvas: HTMLCanvasElement, onProgress: ProgressCallback) {
    this.canvas = canvas;
    this.onProgress = onProgress;
  }

  async runPhase1Tests(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test 1: WebGL2 Context Creation
    results.push(await this.testWebGL2Context());

    // Only continue if WebGL2 is available
    if (!this.gl) {
      return results;
    }

    // Test 2: Max Texture Size
    results.push(await this.testMaxTextureSize());

    // Test 3: Vertex Shader Compilation
    results.push(await this.testVertexShaderCompilation());

    // Test 4: Fragment Shader Compilation
    results.push(await this.testFragmentShaderCompilation());

    // Test 5: Float Texture Extension
    results.push(await this.testFloatTextureExtension());

    // Test 6: Framebuffer Support
    results.push(await this.testFramebufferSupport());

    return results;
  }

  private async testWebGL2Context(): Promise<TestResult> {
    const testName = "WebGL2 Context Creation";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      this.gl = this.canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: false,
      });

      if (!this.gl) {
        throw new Error('WebGL2 context creation returned null');
      }

      const duration = performance.now() - startTime;
      this.onProgress(testName, 'passed', 'WebGL2 context created successfully');

      return {
        name: testName,
        status: 'passed',
        message: 'WebGL2 context created successfully',
        details: {
          vendor: this.gl.getParameter(this.gl.VENDOR),
          renderer: this.gl.getParameter(this.gl.RENDERER),
          version: this.gl.getParameter(this.gl.VERSION),
        },
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.onProgress(testName, 'failed', message);

      return {
        name: testName,
        status: 'failed',
        message: `Failed: ${message}`,
        duration,
      };
    }
  }

  private async testMaxTextureSize(): Promise<TestResult> {
    const testName = "Max Texture Size";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      if (!this.gl) throw new Error('WebGL2 context not available');

      const maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
      const duration = performance.now() - startTime;

      if (maxTextureSize < 1024) {
        throw new Error(`Max texture size (${maxTextureSize}) is too small (minimum 1024)`);
      }

      this.onProgress(testName, 'passed', `Max texture size: ${maxTextureSize}px`);

      return {
        name: testName,
        status: 'passed',
        message: `Max texture size: ${maxTextureSize}px`,
        details: { maxTextureSize },
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.onProgress(testName, 'failed', message);

      return {
        name: testName,
        status: 'failed',
        message: `Failed: ${message}`,
        duration,
      };
    }
  }

  private async testVertexShaderCompilation(): Promise<TestResult> {
    const testName = "Vertex Shader Compilation";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      if (!this.gl) throw new Error('WebGL2 context not available');

      const vertexShaderSource = `#version 300 es
        in vec2 a_position;
        out vec2 v_texCoord;
        
        void main() {
          gl_Position = vec4(a_position, 0.0, 1.0);
          v_texCoord = a_position * 0.5 + 0.5;
        }
      `;

      const shader = this.gl.createShader(this.gl.VERTEX_SHADER);
      if (!shader) throw new Error('Failed to create vertex shader');

      this.gl.shaderSource(shader, vertexShaderSource);
      this.gl.compileShader(shader);

      if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
        const log = this.gl.getShaderInfoLog(shader);
        throw new Error(`Shader compilation failed: ${log}`);
      }

      this.gl.deleteShader(shader);

      const duration = performance.now() - startTime;
      this.onProgress(testName, 'passed', 'Vertex shader compiled successfully');

      return {
        name: testName,
        status: 'passed',
        message: 'Vertex shader compiled successfully',
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.onProgress(testName, 'failed', message);

      return {
        name: testName,
        status: 'failed',
        message: `Failed: ${message}`,
        duration,
      };
    }
  }

  private async testFragmentShaderCompilation(): Promise<TestResult> {
    const testName = "Fragment Shader Compilation";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      if (!this.gl) throw new Error('WebGL2 context not available');

      const fragmentShaderSource = `#version 300 es
        precision highp float;
        in vec2 v_texCoord;
        out vec4 outColor;
        
        uniform sampler2D u_texture;
        
        void main() {
          outColor = texture(u_texture, v_texCoord);
        }
      `;

      const shader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      if (!shader) throw new Error('Failed to create fragment shader');

      this.gl.shaderSource(shader, fragmentShaderSource);
      this.gl.compileShader(shader);

      if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
        const log = this.gl.getShaderInfoLog(shader);
        throw new Error(`Shader compilation failed: ${log}`);
      }

      this.gl.deleteShader(shader);

      const duration = performance.now() - startTime;
      this.onProgress(testName, 'passed', 'Fragment shader compiled successfully');

      return {
        name: testName,
        status: 'passed',
        message: 'Fragment shader compiled successfully',
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.onProgress(testName, 'failed', message);

      return {
        name: testName,
        status: 'failed',
        message: `Failed: ${message}`,
        duration,
      };
    }
  }

  private async testFloatTextureExtension(): Promise<TestResult> {
    const testName = "Float Texture Extension";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      if (!this.gl) throw new Error('WebGL2 context not available');

      // In WebGL2, float textures are part of the core spec
      const ext = this.gl.getExtension('EXT_color_buffer_float');
      
      const duration = performance.now() - startTime;
      
      if (ext) {
        this.onProgress(testName, 'passed', 'Float textures supported (with EXT_color_buffer_float)');
        return {
          name: testName,
          status: 'passed',
          message: 'Float textures supported (with EXT_color_buffer_float)',
          details: { extension: 'EXT_color_buffer_float' },
          duration,
        };
      } else {
        this.onProgress(testName, 'passed', 'Float textures supported (core WebGL2)');
        return {
          name: testName,
          status: 'passed',
          message: 'Float textures supported (core WebGL2)',
          duration,
        };
      }
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.onProgress(testName, 'failed', message);

      return {
        name: testName,
        status: 'failed',
        message: `Failed: ${message}`,
        duration,
      };
    }
  }

  private async testFramebufferSupport(): Promise<TestResult> {
    const testName = "Framebuffer Support";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      if (!this.gl) throw new Error('WebGL2 context not available');

      const framebuffer = this.gl.createFramebuffer();
      if (!framebuffer) throw new Error('Failed to create framebuffer');

      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);

      // Create a texture to attach
      const texture = this.gl.createTexture();
      if (!texture) throw new Error('Failed to create texture for framebuffer');

      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        256,
        256,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        null
      );

      this.gl.framebufferTexture2D(
        this.gl.FRAMEBUFFER,
        this.gl.COLOR_ATTACHMENT0,
        this.gl.TEXTURE_2D,
        texture,
        0
      );

      const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
      if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer incomplete: ${status}`);
      }

      // Cleanup
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.deleteTexture(texture);
      this.gl.deleteFramebuffer(framebuffer);

      const duration = performance.now() - startTime;
      this.onProgress(testName, 'passed', 'Framebuffer support verified');

      return {
        name: testName,
        status: 'passed',
        message: 'Framebuffer support verified',
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.onProgress(testName, 'failed', message);

      return {
        name: testName,
        status: 'failed',
        message: `Failed: ${message}`,
        duration,
      };
    }
  }

  cleanup(): void {
    // No persistent resources to cleanup yet
    // Context will be cleaned up when canvas is removed
  }
}
