/**
 * TPS (Thin Plate Spline) Baker Module
 * Solves TPS weights and generates displacement map texture
 */

import type { TPSData, Point2D } from './types';
import { createTexture } from './utils';

export class TPSBaker {
  /**
   * Bake TPS data from control point correspondences
   */
  bake(
    controlPointsA: Point2D[],
    controlPointsB: Point2D[],
    options: {
      lambda?: number; // regularization parameter
      mapResolution?: number; // displacement map resolution
    } = {}
  ): TPSData {
    const { lambda = 0.02, mapResolution = 256 } = options;

    console.log('[TPSBaker] Baking TPS data...');

    if (controlPointsA.length !== controlPointsB.length) {
      throw new Error('Control point arrays must have equal length');
    }

    if (controlPointsA.length < 3) {
      throw new Error('Need at least 3 control points for TPS');
    }

    // Solve TPS system
    const solution = this.solveTPS(controlPointsA, controlPointsB, lambda);

    console.log(`[TPSBaker] TPS solved for ${controlPointsA.length} control points`);

    return {
      controlPointsA,
      controlPointsB,
      weights: solution.weights,
      affine: solution.affine,
      displacementMap: null // Will be created by renderer when needed
    };
  }

  /**
   * Solve the TPS linear system
   * Returns weights for RBF kernel and affine parameters
   */
  private solveTPS(
    srcPoints: Point2D[],
    dstPoints: Point2D[],
    lambda: number
  ): {
    weights: number[];  // RBF weights (2 * n values: wx[], wy[])
    affine: number[];   // affine component [a1, a2, a3, b1, b2, b3]
  } {
    const n = srcPoints.length;

    // Build kernel matrix K (n x n)
    // K[i,j] = φ(||p_i - p_j||) where φ(r) = r² log(r)
    const K: number[][] = [];
    for (let i = 0; i < n; i++) {
      K[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          K[i][j] = lambda; // Regularization on diagonal
        } else {
          const dx = srcPoints[i].x - srcPoints[j].x;
          const dy = srcPoints[i].y - srcPoints[j].y;
          const r = Math.sqrt(dx * dx + dy * dy);
          K[i][j] = this.tpsKernel(r);
        }
      }
    }

    // Build constraint matrix P (n x 3)
    // P[i] = [1, x_i, y_i]
    const P: number[][] = [];
    for (let i = 0; i < n; i++) {
      P[i] = [1, srcPoints[i].x, srcPoints[i].y];
    }

    // Build augmented system:
    // [K  P] [w] = [v]
    // [P^T 0] [a]   [0]
    //
    // where v is the target displacement and a is affine component

    const systemSize = n + 3;
    const A: number[][] = [];
    for (let i = 0; i < systemSize; i++) {
      A[i] = new Array(systemSize).fill(0);
    }

    // Fill top-left block with K
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        A[i][j] = K[i][j];
      }
    }

    // Fill top-right block with P
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 3; j++) {
        A[i][n + j] = P[i][j];
      }
    }

    // Fill bottom-left block with P^T
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < n; j++) {
        A[n + i][j] = P[j][i];
      }
    }

    // Bottom-right block is already 0

    // Solve for X coordinates
    const bX = new Array(systemSize).fill(0);
    for (let i = 0; i < n; i++) {
      bX[i] = dstPoints[i].x;
    }
    const solutionX = this.solveLinearSystem(A, bX);

    // Solve for Y coordinates
    const bY = new Array(systemSize).fill(0);
    for (let i = 0; i < n; i++) {
      bY[i] = dstPoints[i].y;
    }
    const solutionY = this.solveLinearSystem(A, bY);

    // Extract weights and affine parameters
    const weightsX = solutionX.slice(0, n);
    const weightsY = solutionY.slice(0, n);
    const affineX = solutionX.slice(n);
    const affineY = solutionY.slice(n);

    // Combine weights (interleaved: wx0, wy0, wx1, wy1, ...)
    const weights: number[] = [];
    for (let i = 0; i < n; i++) {
      weights.push(weightsX[i], weightsY[i]);
    }

    // Affine: [a1, a2, a3, b1, b2, b3]
    const affine = [...affineX, ...affineY];

    return { weights, affine };
  }

  /**
   * TPS radial basis function kernel: r² log(r)
   */
  private tpsKernel(r: number): number {
    if (r < 1e-6) return 0;
    return r * r * Math.log(r);
  }

  /**
   * Solve linear system Ax = b using Gaussian elimination
   */
  private solveLinearSystem(A: number[][], b: number[]): number[] {
    const n = A.length;
    const augmented: number[][] = [];

    // Create augmented matrix [A|b]
    for (let i = 0; i < n; i++) {
      augmented[i] = [...A[i], b[i]];
    }

    // Forward elimination with partial pivoting
    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
          maxRow = k;
        }
      }

      // Swap rows
      [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

      // Check for singular matrix
      if (Math.abs(augmented[i][i]) < 1e-10) {
        console.warn(`[TPSBaker] Near-singular matrix at row ${i}`);
        continue;
      }

      // Eliminate below
      for (let k = i + 1; k < n; k++) {
        const factor = augmented[k][i] / augmented[i][i];
        for (let j = i; j <= n; j++) {
          augmented[k][j] -= factor * augmented[i][j];
        }
      }
    }

    // Back substitution
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = augmented[i][n];
      for (let j = i + 1; j < n; j++) {
        x[i] -= augmented[i][j] * x[j];
      }
      if (Math.abs(augmented[i][i]) > 1e-10) {
        x[i] /= augmented[i][i];
      }
    }

    return x;
  }

  /**
   * Evaluate TPS at a given point
   */
  evaluateTPS(
    point: Point2D,
    srcPoints: Point2D[],
    weights: number[], // interleaved [wx0, wy0, wx1, wy1, ...]
    affine: number[]   // [a1, a2, a3, b1, b2, b3]
  ): Point2D {
    let x = 0;
    let y = 0;

    // Affine component
    x += affine[0] + affine[1] * point.x + affine[2] * point.y;
    y += affine[3] + affine[4] * point.x + affine[5] * point.y;

    // RBF component
    for (let i = 0; i < srcPoints.length; i++) {
      const dx = point.x - srcPoints[i].x;
      const dy = point.y - srcPoints[i].y;
      const r = Math.sqrt(dx * dx + dy * dy);
      const kernel = this.tpsKernel(r);

      x += weights[i * 2] * kernel;
      y += weights[i * 2 + 1] * kernel;
    }

    return { x, y };
  }

  /**
   * Generate displacement map texture
   * Stores displacement as (dx, dy) in RG channels
   */
  generateDisplacementMap(
    gl: WebGL2RenderingContext,
    tpsData: TPSData,
    width: number,
    height: number,
    resolution: number
  ): WebGLTexture | null {
    console.log('[TPSBaker] Generating displacement map...');

    const data = new Float32Array(resolution * resolution * 2); // RG format

    // Evaluate TPS at each texel
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        // Map texel to image space
        const px = (x / (resolution - 1)) * width;
        const py = (y / (resolution - 1)) * height;

        // Evaluate TPS
        const displaced = this.evaluateTPS(
          { x: px, y: py },
          tpsData.controlPointsA,
          tpsData.weights,
          tpsData.affine
        );

        // Store displacement (not absolute position)
        const idx = (y * resolution + x) * 2;
        data[idx] = displaced.x - px; // dx
        data[idx + 1] = displaced.y - py; // dy
      }
    }

    // Create RG32F texture
    const texture = createTexture(
      gl,
      resolution,
      resolution,
      gl.RG32F,
      gl.RG,
      gl.FLOAT,
      data
    );

    console.log(`[TPSBaker] Displacement map created: ${resolution}x${resolution}`);

    return texture;
  }

  /**
   * Visualize displacement map as RGB (for debugging)
   */
  visualizeDisplacementMap(
    data: Float32Array,
    resolution: number
  ): ImageData {
    const imageData = new ImageData(resolution, resolution);

    for (let i = 0; i < resolution * resolution; i++) {
      const dx = data[i * 2];
      const dy = data[i * 2 + 1];

      // Map displacement to color
      // Red = horizontal displacement, Green = vertical displacement
      const r = Math.floor(((dx / 20) + 0.5) * 255); // Assuming max displacement ~20px
      const g = Math.floor(((dy / 20) + 0.5) * 255);
      const b = 128;

      imageData.data[i * 4] = Math.max(0, Math.min(255, r));
      imageData.data[i * 4 + 1] = Math.max(0, Math.min(255, g));
      imageData.data[i * 4 + 2] = b;
      imageData.data[i * 4 + 3] = 255;
    }

    return imageData;
  }
}
