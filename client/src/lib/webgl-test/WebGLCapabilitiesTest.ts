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

  /**
   * Phase 2: Image Loading Tests
   */
  async runPhase2Tests(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    results.push(await this.testLoadImageFromURL());
    results.push(await this.testCreateTextureFromImage());
    results.push(await this.testRenderTextureToCanvas());
    
    return results;
  }

  private async testLoadImageFromURL(): Promise<TestResult> {
    const testName = "Load Image from URL";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      const testImageURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      
      const img = await this.loadImage(testImageURL);
      
      const duration = performance.now() - startTime;
      this.onProgress(testName, 'passed', `Image loaded: ${img.width}x${img.height}px`);

      return {
        name: testName,
        status: 'passed',
        message: `Image loaded: ${img.width}x${img.height}px`,
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

  private async testCreateTextureFromImage(): Promise<TestResult> {
    const testName = "Create Texture from Image";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      if (!this.gl) throw new Error('WebGL2 context not available');

      // Create a simple test image (1x1 red pixel)
      const testImageURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
      const img = await this.loadImage(testImageURL);

      // Create texture
      const texture = this.gl.createTexture();
      if (!texture) throw new Error('Failed to create texture');

      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        img
      );

      // Set texture parameters
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

      // Cleanup
      this.gl.deleteTexture(texture);

      const duration = performance.now() - startTime;
      this.onProgress(testName, 'passed', 'Texture created from image successfully');

      return {
        name: testName,
        status: 'passed',
        message: 'Texture created from image successfully',
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

  private async testRenderTextureToCanvas(): Promise<TestResult> {
    const testName = "Render Texture to Canvas";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      if (!this.gl) throw new Error('WebGL2 context not available');

      // Create a simple vertex shader
      const vertexShaderSource = `#version 300 es
        in vec2 a_position;
        in vec2 a_texCoord;
        out vec2 v_texCoord;
        
        void main() {
          gl_Position = vec4(a_position, 0.0, 1.0);
          v_texCoord = a_texCoord;
        }
      `;

      // Create a simple fragment shader
      const fragmentShaderSource = `#version 300 es
        precision highp float;
        in vec2 v_texCoord;
        out vec4 outColor;
        uniform sampler2D u_texture;
        
        void main() {
          outColor = texture(u_texture, v_texCoord);
        }
      `;

      // Compile shaders
      const vertexShader = this.compileShader(vertexShaderSource, this.gl.VERTEX_SHADER);
      const fragmentShader = this.compileShader(fragmentShaderSource, this.gl.FRAGMENT_SHADER);

      // Create program
      const program = this.gl.createProgram();
      if (!program) throw new Error('Failed to create program');

      this.gl.attachShader(program, vertexShader);
      this.gl.attachShader(program, fragmentShader);
      this.gl.linkProgram(program);

      if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
        const log = this.gl.getProgramInfoLog(program);
        throw new Error(`Program linking failed: ${log}`);
      }

      // Create geometry (fullscreen quad)
      const positions = new Float32Array([
        -1, -1, 0, 0,
        1, -1, 1, 0,
        -1, 1, 0, 1,
        1, 1, 1, 1,
      ]);

      const buffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

      // Setup attributes
      const positionLoc = this.gl.getAttribLocation(program, 'a_position');
      const texCoordLoc = this.gl.getAttribLocation(program, 'a_texCoord');

      this.gl.enableVertexAttribArray(positionLoc);
      this.gl.vertexAttribPointer(positionLoc, 2, this.gl.FLOAT, false, 16, 0);
      this.gl.enableVertexAttribArray(texCoordLoc);
      this.gl.vertexAttribPointer(texCoordLoc, 2, this.gl.FLOAT, false, 16, 8);

      // Create and bind texture
      const testImageURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
      const img = await this.loadImage(testImageURL);

      const texture = this.gl.createTexture();
      if (!texture) throw new Error('Failed to create texture');

      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

      // Render
      this.gl.useProgram(program);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

      // Cleanup
      this.gl.deleteTexture(texture);
      this.gl.deleteBuffer(buffer);
      this.gl.deleteShader(vertexShader);
      this.gl.deleteShader(fragmentShader);
      this.gl.deleteProgram(program);

      const duration = performance.now() - startTime;
      this.onProgress(testName, 'passed', 'Texture rendered to canvas successfully');

      return {
        name: testName,
        status: 'passed',
        message: 'Texture rendered to canvas successfully',
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

  // Helper: Load image from URL
  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image from ${url}`));
      img.src = url;
    });
  }

  // Helper: Compile shader
  private compileShader(source: string, type: number): WebGLShader {
    if (!this.gl) throw new Error('WebGL2 context not available');

    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const log = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${log}`);
    }

    return shader;
  }

  /**
   * Phase 4: External Libraries (OpenCV.js priority test)
   */
  async runPhase4Tests(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    results.push(await this.testOpenCVLoading());
    results.push(await this.testCvMatCreation());
    
    return results;
  }

  private async testOpenCVLoading(): Promise<TestResult> {
    const testName = "OpenCV.js Loading";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      // Test the EXACT same URL that our emergency fix uses
      const cvUrl = 'https://docs.opencv.org/4.5.2/opencv.js';
      
      console.log('[WebGLTest] Testing OpenCV.js load from:', cvUrl);

      // Load OpenCV.js with timeout (same as emergency fix: 10s)
      const loaded = await Promise.race([
        new Promise<boolean>((resolve) => {
          const script = document.createElement('script');
          script.src = cvUrl;
          script.async = true;
          
          script.onload = () => {
            console.log('[WebGLTest] OpenCV.js script loaded');
            resolve(true);
          };
          
          script.onerror = (error) => {
            console.error('[WebGLTest] OpenCV.js script error:', error);
            resolve(false);
          };
          
          document.head.appendChild(script);
        }),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            console.warn('[WebGLTest] OpenCV.js load timeout (10s)');
            resolve(false);
          }, 10000); // Match emergency fix timeout
        }),
      ]);

      if (!loaded) {
        throw new Error('Failed to load OpenCV.js script (timeout or error)');
      }

      // Wait for cv to be ready
      const cvReady = await new Promise<boolean>((resolve) => {
        const checkInterval = setInterval(() => {
          if (typeof (window as any).cv !== 'undefined') {
            clearInterval(checkInterval);
            console.log('[WebGLTest] OpenCV.js cv object available');
            resolve(true);
          }
        }, 100);

        setTimeout(() => {
          clearInterval(checkInterval);
          console.warn('[WebGLTest] cv object not available after 10s');
          resolve(false);
        }, 10000);
      });

      if (!cvReady) {
        throw new Error('OpenCV.js loaded but cv object not available');
      }

      const duration = performance.now() - startTime;
      this.onProgress(testName, 'passed', `OpenCV.js loaded successfully from ${cvUrl} in ${duration.toFixed(0)}ms`);

      return {
        name: testName,
        status: 'passed',
        message: `OpenCV.js loaded successfully in ${duration.toFixed(0)}ms`,
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.onProgress(testName, 'failed', message);

      console.error('[WebGLTest] OpenCV.js loading failed:', error);

      return {
        name: testName,
        status: 'failed',
        message: `Failed: ${message}`,
        duration,
      };
    }
  }

  private async testCvMatCreation(): Promise<TestResult> {
    const testName = "cv.Mat Creation";
    this.onProgress(testName, 'running');
    const startTime = performance.now();

    try {
      // Check if OpenCV is available
      if (typeof (window as any).cv === 'undefined') {
        throw new Error('OpenCV.js not loaded - cannot test cv.Mat creation');
      }

      const cv = (window as any).cv;

      // Wait for cv to be ready
      if (!cv.Mat) {
        await new Promise<void>((resolve, reject) => {
          cv.onRuntimeInitialized = () => resolve();
          setTimeout(() => reject(new Error('cv.onRuntimeInitialized timeout')), 5000);
        });
      }

      // Create a test Mat
      const mat = new cv.Mat(100, 100, cv.CV_8UC4);
      
      if (!mat || mat.rows !== 100 || mat.cols !== 100) {
        throw new Error('cv.Mat creation failed or dimensions incorrect');
      }

      // Cleanup
      mat.delete();

      const duration = performance.now() - startTime;
      this.onProgress(testName, 'passed', 'cv.Mat created and deleted successfully');

      return {
        name: testName,
        status: 'passed',
        message: 'cv.Mat created and deleted successfully',
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.onProgress(testName, 'failed', message);

      console.error('[WebGLTest] cv.Mat creation failed:', error);

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
