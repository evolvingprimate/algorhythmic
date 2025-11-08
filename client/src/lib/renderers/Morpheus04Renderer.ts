/**
 * Morpheus 0.4 Renderer
 * Feature-based morphing with intelligent stage selection
 */

import type { IMorphRenderer, RenderContext } from './types';
import { ImageAnalyzer } from './morpheus04/ImageAnalyzer';
import { MorphPlanner } from './morpheus04/MorphPlanner';
import { MeshBaker } from './morpheus04/MeshBaker';
import { TPSBaker } from './morpheus04/TPSBaker';
import { FlowBaker } from './morpheus04/FlowBaker';
import type { 
  ImageAnalysisResult, 
  MorphPlan, 
  MorphStage,
  MeshData,
  TPSData,
  FlowData,
  Point2D
} from './morpheus04/types';
import {
  createShaderPrograms,
  fullscreenVertexShader
} from './morpheus04/shaders';
import { loadOpenCV } from './morpheus04/opencvLoader';

export class Morpheus04Renderer implements IMorphRenderer {
  readonly name = 'Morpheus 0.4';
  readonly version = '0.4.0';
  readonly description = 'Feature-based morphing with intelligent stage selection (mesh/TPS/flow)';

  // Analysis modules
  private imageAnalyzer: ImageAnalyzer = new ImageAnalyzer();
  private morphPlanner: MorphPlanner = new MorphPlanner();
  private meshBaker: MeshBaker = new MeshBaker();
  private tpsBaker: TPSBaker = new TPSBaker();
  private flowBaker: FlowBaker = new FlowBaker();

  // Cached analysis and plan
  private currentAnalysis: ImageAnalysisResult | null = null;
  private currentPlan: MorphPlan | null = null;
  private lastFrameAUrl: string = '';
  private lastFrameBUrl: string = '';

  // Baked data
  private meshData: MeshData | null = null;
  private tpsData: TPSData | null = null;
  private flowData: FlowData | null = null;

  // WebGL resources
  private gl: WebGL2RenderingContext | null = null;
  private programs: {
    mesh: WebGLProgram | null;
    tps: WebGLProgram | null;
    flow: WebGLProgram | null;
    crossfade: WebGLProgram | null;
  } = { mesh: null, tps: null, flow: null, crossfade: null };
  
  // Fullscreen quad
  private quadVAO: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;

  // Stage transition tracking
  private lastBarBoundary: boolean = false;

  private initialized: boolean = false;

  async initialize(gl: WebGL2RenderingContext): Promise<void> {
    this.gl = gl;

    console.log('[Morpheus04] Initializing...');

    try {
      // Load OpenCV.js (required for analysis)
      await loadOpenCV();

      // Ensure analyzer is ready
      await this.imageAnalyzer.ensureReady();

      // Create shader programs
      this.programs = createShaderPrograms(gl);

      if (!this.programs.crossfade) {
        throw new Error('Failed to create crossfade shader program');
      }

      // Create fullscreen quad
      this.createQuad(gl);

      this.initialized = true;
      console.log('[Morpheus04] Initialized successfully');
    } catch (error) {
      console.error('[Morpheus04] Initialization failed:', error);
      throw error;
    }
  }

  private createQuad(gl: WebGL2RenderingContext): void {
    // Create VAO
    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);

    // Create VBO with fullscreen quad positions
    const positions = new Float32Array([
      -1, -1,  // Bottom-left
       1, -1,  // Bottom-right
      -1,  1,  // Top-left
       1,  1   // Top-right
    ]);

    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // Setup vertex attribute
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  async render(context: RenderContext): Promise<void> {
    if (!this.initialized || !this.gl) {
      console.warn('[Morpheus04] Not initialized, falling back to simple crossfade');
      this.renderCrossfade(context);
      return;
    }

    // Check if frames changed - if so, re-analyze
    const frameAUrl = context.frameA.imageData.src;
    const frameBUrl = context.frameB.imageData.src;

    if (frameAUrl !== this.lastFrameAUrl || frameBUrl !== this.lastFrameBUrl) {
      await this.analyzeAndPlan(
        context.frameA.imageData,
        context.frameB.imageData
      );
      this.lastFrameAUrl = frameAUrl;
      this.lastFrameBUrl = frameBUrl;
    }

    // Render based on plan
    if (this.currentPlan) {
      this.renderWithPlan(context);
    } else {
      // Fallback to simple crossfade
      this.renderCrossfade(context);
    }
  }

  private async analyzeAndPlan(
    imageA: HTMLImageElement,
    imageB: HTMLImageElement
  ): Promise<void> {
    console.log('[Morpheus04] Analyzing frames...');

    try {
      // Analyze images
      this.currentAnalysis = await this.imageAnalyzer.analyze(imageA, imageB, {
        targetRes: 512,
        maxFeatures: 500,
        enableSegmentation: false
      });

      // Create morph plan
      this.currentPlan = this.morphPlanner.plan(this.currentAnalysis);
      this.currentPlan = this.morphPlanner.validatePlan(this.currentPlan);

      console.log('[Morpheus04] Plan:', this.morphPlanner.describePlan(this.currentPlan));

      // Bake data for required stages
      await this.bakeStageData(imageA, imageB);
    } catch (error) {
      console.error('[Morpheus04] Analysis/planning failed:', error);
      this.currentPlan = null;
    }
  }

  private async bakeStageData(
    imageA: HTMLImageElement,
    imageB: HTMLImageElement
  ): Promise<void> {
    if (!this.currentPlan || !this.currentAnalysis || !this.gl) return;

    // Check which modes are needed
    const needsMesh = this.currentPlan.stages.some(s => s.mode === 'mesh');
    const needsTPS = this.currentPlan.stages.some(s => s.mode === 'tps');
    const needsFlow = this.currentPlan.stages.some(s => s.mode === 'flow');

    // TODO: Extract control points from analysis (missing implementation)
    // This is a critical gap - need to extract matched feature points from ImageAnalyzer
    // and convert them to Point2D arrays for the bakers
    const controlPointsA: Point2D[] = []; // Would extract from this.currentAnalysis matches
    const controlPointsB: Point2D[] = []; // Would extract from this.currentAnalysis matches

    // For now, use placeholder control points
    const width = imageA.width;
    const height = imageA.height;

    // CRITICAL TODO: If controlPointsA/B are empty, we cannot proceed with mesh/TPS
    // Need to implement: extractControlPoints(analysis: ImageAnalysisResult): {A: Point2D[], B: Point2D[]}
    if (controlPointsA.length < 3) {
      console.warn('[Morpheus04] Insufficient control points, skipping advanced morphing');
      return; // Fall back to crossfade
    }

    // Bake mesh if needed
    if (needsMesh && controlPointsA.length >= 3) {
      try {
        this.meshData = this.meshBaker.bake(
          controlPointsA,
          controlPointsB,
          width,
          height,
          { triCount: 150 }
        );
      } catch (error) {
        console.error('[Morpheus04] Mesh baking failed:', error);
      }
    }

    // Bake TPS if needed
    if (needsTPS && controlPointsA.length >= 3) {
      try {
        this.tpsData = this.tpsBaker.bake(controlPointsA, controlPointsB, {
          lambda: 0.02,
          mapResolution: 256
        });
      } catch (error) {
        console.error('[Morpheus04] TPS baking failed:', error);
      }
    }

    // Bake flow if needed
    if (needsFlow) {
      try {
        this.flowData = await this.flowBaker.bake(imageA, imageB, {
          targetRes: 512,
          smoothing: true
        });
      } catch (error) {
        console.error('[Morpheus04] Flow baking failed:', error);
      }
    }
  }

  private renderWithPlan(context: RenderContext): void {
    if (!this.currentPlan || !this.gl) {
      this.renderCrossfade(context);
      return;
    }

    // Get active stage based on morph progress
    const t = context.morphState.morphProgress;
    const { current, next, blendFactor } = this.morphPlanner.getActiveStages(
      this.currentPlan,
      t
    );

    if (!current) {
      this.renderCrossfade(context);
      return;
    }

    // Check for bar boundary stage transitions (Task 13)
    const audioAnalysis = context.audioAnalysis;
    if (audioAnalysis && next && blendFactor > 0) {
      // Would need to implement bar boundary detection from audio
      // For now, allow transitions
    }

    // Render current stage
    switch (current.mode) {
      case 'mesh':
        this.renderMesh(context, current);
        break;
      case 'tps':
        this.renderTPS(context, current);
        break;
      case 'flow':
        this.renderFlow(context, current);
        break;
      case 'crossfade':
      default:
        this.renderCrossfade(context);
        break;
    }
  }

  private renderCrossfade(context: RenderContext): void {
    const gl = this.gl!;
    const program = this.programs.crossfade!;

    gl.useProgram(program);
    gl.bindVertexArray(this.quadVAO);

    // Set uniforms
    const uTextureA = gl.getUniformLocation(program, 'uTextureA');
    const uTextureB = gl.getUniformLocation(program, 'uTextureB');
    const uMorphProgress = gl.getUniformLocation(program, 'uMorphProgress');

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, context.frameA.texture);
    gl.uniform1i(uTextureA, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, context.frameB.texture);
    gl.uniform1i(uTextureB, 1);

    gl.uniform1f(uMorphProgress, context.morphState.morphProgress);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private renderMesh(context: RenderContext, stage: MorphStage): void {
    // Mesh rendering would require mesh geometry and triangle rendering
    // For now, fall back to crossfade
    console.log('[Morpheus04] Mesh rendering not yet fully implemented, using crossfade');
    this.renderCrossfade(context);
  }

  private renderTPS(context: RenderContext, stage: MorphStage): void {
    const gl = this.gl!;
    const program = this.programs.tps;

    if (!program || !this.tpsData) {
      this.renderCrossfade(context);
      return;
    }

    // Generate displacement map if not already created
    if (!this.tpsData.displacementMap) {
      this.tpsData.displacementMap = this.tpsBaker.generateDisplacementMap(
        gl,
        this.tpsData,
        context.canvas.width,
        context.canvas.height,
        256
      );
    }

    gl.useProgram(program);
    gl.bindVertexArray(this.quadVAO);

    // Set uniforms
    const uTextureA = gl.getUniformLocation(program, 'uTextureA');
    const uTextureB = gl.getUniformLocation(program, 'uTextureB');
    const uDisplacementMap = gl.getUniformLocation(program, 'uDisplacementMap');
    const uMorphProgress = gl.getUniformLocation(program, 'uMorphProgress');
    const uDispAmp = gl.getUniformLocation(program, 'uDispAmp');
    const uImageSize = gl.getUniformLocation(program, 'uImageSize');

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, context.frameA.texture);
    gl.uniform1i(uTextureA, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, context.frameB.texture);
    gl.uniform1i(uTextureB, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.tpsData.displacementMap);
    gl.uniform1i(uDisplacementMap, 2);

    gl.uniform1f(uMorphProgress, context.morphState.morphProgress);
    gl.uniform1f(uDispAmp, stage.dispAmp || 0.006);
    gl.uniform2f(uImageSize, context.canvas.width, context.canvas.height);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private renderFlow(context: RenderContext, stage: MorphStage): void {
    const gl = this.gl!;
    const program = this.programs.flow;

    if (!program || !this.flowData) {
      this.renderCrossfade(context);
      return;
    }

    // Generate flow textures if not already created
    if (!this.flowData.flowTexture) {
      this.flowData.flowTexture = this.flowBaker.createFlowTexture(gl, this.flowData);
    }
    if (!this.flowData.confidenceTexture) {
      this.flowData.confidenceTexture = this.flowBaker.createConfidenceTexture(gl, this.flowData);
    }

    gl.useProgram(program);
    gl.bindVertexArray(this.quadVAO);

    // Set uniforms
    const uTextureA = gl.getUniformLocation(program, 'uTextureA');
    const uTextureB = gl.getUniformLocation(program, 'uTextureB');
    const uFlowTexture = gl.getUniformLocation(program, 'uFlowTexture');
    const uConfidenceTexture = gl.getUniformLocation(program, 'uConfidenceTexture');
    const uMorphProgress = gl.getUniformLocation(program, 'uMorphProgress');
    const uFlowWeight = gl.getUniformLocation(program, 'uFlowWeight');
    const uImageSize = gl.getUniformLocation(program, 'uImageSize');

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, context.frameA.texture);
    gl.uniform1i(uTextureA, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, context.frameB.texture);
    gl.uniform1i(uTextureB, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.flowData.flowTexture);
    gl.uniform1i(uFlowTexture, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.flowData.confidenceTexture);
    gl.uniform1i(uConfidenceTexture, 3);

    gl.uniform1f(uMorphProgress, context.morphState.morphProgress);
    gl.uniform1f(uFlowWeight, stage.flowWeight || 0.8);
    gl.uniform2f(uImageSize, context.canvas.width, context.canvas.height);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy(): void {
    const gl = this.gl;
    if (!gl) return;

    // Delete shader programs
    if (this.programs.mesh) gl.deleteProgram(this.programs.mesh);
    if (this.programs.tps) gl.deleteProgram(this.programs.tps);
    if (this.programs.flow) gl.deleteProgram(this.programs.flow);
    if (this.programs.crossfade) gl.deleteProgram(this.programs.crossfade);

    // Delete quad buffers
    if (this.quadVBO) gl.deleteBuffer(this.quadVBO);
    if (this.quadVAO) gl.deleteVertexArray(this.quadVAO);

    // Delete baked textures
    if (this.meshData?.textureA) gl.deleteTexture(this.meshData.textureA);
    if (this.meshData?.textureB) gl.deleteTexture(this.meshData.textureB);
    if (this.tpsData?.displacementMap) gl.deleteTexture(this.tpsData.displacementMap);
    if (this.flowData?.flowTexture) gl.deleteTexture(this.flowData.flowTexture);
    if (this.flowData?.confidenceTexture) gl.deleteTexture(this.flowData.confidenceTexture);

    this.initialized = false;
    console.log('[Morpheus04] Destroyed');
  }
}
