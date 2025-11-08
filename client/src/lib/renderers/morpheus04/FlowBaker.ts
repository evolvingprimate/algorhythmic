/**
 * Flow Baker Module
 * Computes dense optical flow using Farneback algorithm
 */

import type { FlowData } from './types';
import { createTexture } from './utils';

// OpenCV.js global
declare const cv: any;

export class FlowBaker {
  /**
   * Bake optical flow data using Farneback algorithm
   */
  async bake(
    imageA: HTMLImageElement | ImageData,
    imageB: HTMLImageElement | ImageData,
    options: {
      targetRes?: number;
      pyrScale?: number;
      levels?: number;
      winsize?: number;
      iterations?: number;
      polyN?: number;
      polySigma?: number;
      smoothing?: boolean;
    } = {}
  ): Promise<FlowData> {
    const {
      targetRes = 512,
      pyrScale = 0.5,
      levels = 3,
      winsize = 15,
      iterations = 3,
      polyN = 5,
      polySigma = 1.2,
      smoothing = true
    } = options;

    console.log('[FlowBaker] Computing optical flow...');

    // Ensure OpenCV is loaded
    if (typeof cv === 'undefined' || !cv.Mat) {
      throw new Error('OpenCV.js not loaded');
    }

    // Convert images to OpenCV Mats
    const matA = this.imageToMat(imageA, targetRes);
    const matB = this.imageToMat(imageB, targetRes);

    // Convert to grayscale
    const grayA = new cv.Mat();
    const grayB = new cv.Mat();
    cv.cvtColor(matA, grayA, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(matB, grayB, cv.COLOR_RGBA2GRAY);

    // Compute optical flow
    const flow = new cv.Mat();
    cv.calcOpticalFlowFarneback(
      grayA,
      grayB,
      flow,
      pyrScale,
      levels,
      winsize,
      iterations,
      polyN,
      polySigma,
      0 // flags
    );

    // Extract flow field
    const flowField = this.extractFlowField(flow);

    // Compute confidence map
    const confidence = this.computeConfidence(flow, matA.cols, matA.rows);

    // Optional: smooth flow field
    if (smoothing) {
      this.smoothFlow(flowField, matA.cols, matA.rows);
    }

    // Clean up
    matA.delete();
    matB.delete();
    grayA.delete();
    grayB.delete();
    flow.delete();

    console.log(`[FlowBaker] Flow computed: ${matA.cols}x${matA.rows}`);

    return {
      flowField,
      confidence,
      width: matA.cols,
      height: matA.rows,
      flowTexture: null, // Will be created by renderer
      confidenceTexture: null
    };
  }

  private imageToMat(image: HTMLImageElement | ImageData, targetRes: number): any {
    let mat: any;

    if (image instanceof HTMLImageElement) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      const scale = Math.min(targetRes / image.width, targetRes / image.height);
      canvas.width = Math.floor(image.width * scale);
      canvas.height = Math.floor(image.height * scale);
      
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      mat = cv.imread(canvas);
    } else {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.putImageData(image, 0, 0);
      
      if (image.width > targetRes || image.height > targetRes) {
        const scale = Math.min(targetRes / image.width, targetRes / image.height);
        const newWidth = Math.floor(image.width * scale);
        const newHeight = Math.floor(image.height * scale);
        
        const resizeCanvas = document.createElement('canvas');
        const resizeCtx = resizeCanvas.getContext('2d')!;
        resizeCanvas.width = newWidth;
        resizeCanvas.height = newHeight;
        resizeCtx.drawImage(canvas, 0, 0, newWidth, newHeight);
        
        mat = cv.imread(resizeCanvas);
      } else {
        mat = cv.imread(canvas);
      }
    }

    return mat;
  }

  /**
   * Extract flow field from OpenCV flow Mat (CV_32FC2)
   */
  private extractFlowField(flow: any): Float32Array {
    const width = flow.cols;
    const height = flow.rows;
    const flowField = new Float32Array(width * height * 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 2;
        
        // OpenCV flow is CV_32FC2 (2-channel float)
        const flowX = flow.floatAt(y, x * 2);
        const flowY = flow.floatAt(y, x * 2 + 1);
        
        flowField[idx] = flowX;
        flowField[idx + 1] = flowY;
      }
    }

    return flowField;
  }

  /**
   * Compute confidence map based on flow magnitude and consistency
   */
  private computeConfidence(flow: any, width: number, height: number): Float32Array {
    const confidence = new Float32Array(width * height);

    // Compute statistics
    let maxMagnitude = 0;
    const magnitudes: number[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const flowX = flow.floatAt(y, x * 2);
        const flowY = flow.floatAt(y, x * 2 + 1);
        const mag = Math.sqrt(flowX * flowX + flowY * flowY);
        magnitudes.push(mag);
        maxMagnitude = Math.max(maxMagnitude, mag);
      }
    }

    // Compute median for outlier detection
    const sortedMags = [...magnitudes].sort((a, b) => a - b);
    const median = sortedMags[Math.floor(sortedMags.length / 2)];
    const mad = this.computeMAD(magnitudes, median);

    // Assign confidence based on magnitude and local consistency
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const mag = magnitudes[idx];

        // Confidence decreases for outliers
        const outlierScore = Math.abs(mag - median) / (mad + 1e-6);
        const baseConfidence = Math.exp(-outlierScore);

        // Boost confidence for moderate flow (not too small, not too large)
        const normalizedMag = mag / (maxMagnitude + 1e-6);
        const magnitudeScore = 1 - Math.abs(normalizedMag - 0.3);

        confidence[idx] = baseConfidence * Math.max(0.1, magnitudeScore);
      }
    }

    return confidence;
  }

  /**
   * Compute Median Absolute Deviation
   */
  private computeMAD(values: number[], median: number): number {
    const deviations = values.map(v => Math.abs(v - median));
    deviations.sort((a, b) => a - b);
    return deviations[Math.floor(deviations.length / 2)];
  }

  /**
   * Smooth flow field using Laplacian smoothing
   */
  private smoothFlow(flowField: Float32Array, width: number, height: number): void {
    const smoothed = new Float32Array(flowField.length);
    const iterations = 3;
    const alpha = 0.5; // Smoothing strength

    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = (y * width + x) * 2;

          // 4-connected neighbors
          const neighbors = [
            ((y - 1) * width + x) * 2,
            ((y + 1) * width + x) * 2,
            (y * width + (x - 1)) * 2,
            (y * width + (x + 1)) * 2
          ];

          // Average neighbors
          let sumX = 0;
          let sumY = 0;
          for (const nIdx of neighbors) {
            sumX += flowField[nIdx];
            sumY += flowField[nIdx + 1];
          }
          const avgX = sumX / 4;
          const avgY = sumY / 4;

          // Blend with original
          smoothed[idx] = flowField[idx] * (1 - alpha) + avgX * alpha;
          smoothed[idx + 1] = flowField[idx + 1] * (1 - alpha) + avgY * alpha;
        }
      }

      // Copy back
      flowField.set(smoothed);
    }
  }

  /**
   * Create WebGL texture from flow field
   */
  createFlowTexture(
    gl: WebGL2RenderingContext,
    flowData: FlowData
  ): WebGLTexture | null {
    const texture = createTexture(
      gl,
      flowData.width,
      flowData.height,
      gl.RG32F,
      gl.RG,
      gl.FLOAT,
      flowData.flowField
    );

    console.log(`[FlowBaker] Flow texture created: ${flowData.width}x${flowData.height}`);

    return texture;
  }

  /**
   * Create WebGL texture from confidence map
   */
  createConfidenceTexture(
    gl: WebGL2RenderingContext,
    flowData: FlowData
  ): WebGLTexture | null {
    const texture = createTexture(
      gl,
      flowData.width,
      flowData.height,
      gl.R32F,
      gl.RED,
      gl.FLOAT,
      flowData.confidence
    );

    console.log(`[FlowBaker] Confidence texture created: ${flowData.width}x${flowData.height}`);

    return texture;
  }

  /**
   * Visualize flow field as RGB (for debugging)
   */
  visualizeFlow(flowData: FlowData): ImageData {
    const { flowField, width, height } = flowData;
    const imageData = new ImageData(width, height);

    // Find max magnitude for normalization
    let maxMag = 0;
    for (let i = 0; i < flowField.length; i += 2) {
      const fx = flowField[i];
      const fy = flowField[i + 1];
      const mag = Math.sqrt(fx * fx + fy * fy);
      maxMag = Math.max(maxMag, mag);
    }

    // Convert to HSV color wheel
    for (let i = 0; i < flowField.length / 2; i++) {
      const fx = flowField[i * 2];
      const fy = flowField[i * 2 + 1];

      // Magnitude and angle
      const mag = Math.sqrt(fx * fx + fy * fy);
      const angle = Math.atan2(fy, fx);

      // HSV: hue = direction, value = magnitude
      const hue = ((angle + Math.PI) / (2 * Math.PI)) * 360;
      const saturation = 1;
      const value = Math.min(1, mag / (maxMag + 1e-6));

      // Convert HSV to RGB
      const rgb = this.hsvToRgb(hue, saturation, value);

      imageData.data[i * 4] = rgb.r;
      imageData.data[i * 4 + 1] = rgb.g;
      imageData.data[i * 4 + 2] = rgb.b;
      imageData.data[i * 4 + 3] = 255;
    }

    return imageData;
  }

  private hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r = 0, g = 0, b = 0;

    if (h >= 0 && h < 60) {
      r = c; g = x; b = 0;
    } else if (h >= 60 && h < 120) {
      r = x; g = c; b = 0;
    } else if (h >= 120 && h < 180) {
      r = 0; g = c; b = x;
    } else if (h >= 180 && h < 240) {
      r = 0; g = x; b = c;
    } else if (h >= 240 && h < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }

    return {
      r: Math.floor((r + m) * 255),
      g: Math.floor((g + m) * 255),
      b: Math.floor((b + m) * 255)
    };
  }
}
