/**
 * Mesh Baker Module
 * Uses Delaunator for Delaunay triangulation and computes per-triangle affine transforms
 */

import Delaunator from 'delaunator';
import type { MeshData, Point2D, Triangle } from './types';
import { solveAffine, createTexture } from './utils';

export class MeshBaker {
  /**
   * Bake mesh data from matched control points
   */
  bake(
    controlPointsA: Point2D[],
    controlPointsB: Point2D[],
    imageWidth: number,
    imageHeight: number,
    options: {
      triCount?: number;
      addBorderPoints?: boolean;
    } = {}
  ): MeshData {
    const { triCount = 150, addBorderPoints = true } = options;

    console.log('[MeshBaker] Baking mesh data...');

    // Ensure we have matching point counts
    if (controlPointsA.length !== controlPointsB.length) {
      throw new Error('Control point arrays must have equal length');
    }

    if (controlPointsA.length < 3) {
      throw new Error('Need at least 3 control points for triangulation');
    }

    // Generate mesh control points (average of A and B for topology)
    let meshPoints = this.generateMeshPoints(
      controlPointsA,
      controlPointsB,
      imageWidth,
      imageHeight,
      triCount,
      addBorderPoints
    );

    // Delaunay triangulation
    const triangulation = this.triangulate(meshPoints);

    // Compute per-triangle affine transformations
    const triangles = this.computeTriangleAffines(
      triangulation,
      meshPoints,
      controlPointsA,
      controlPointsB
    );

    console.log(`[MeshBaker] Mesh created: ${meshPoints.length} vertices, ${triangles.length} triangles`);

    return {
      vertices: meshPoints,
      triangles,
      textureA: null, // Will be created by renderer
      textureB: null  // Will be created by renderer
    };
  }

  /**
   * Generate mesh control points by blending matched points and adding grid
   */
  private generateMeshPoints(
    pointsA: Point2D[],
    pointsB: Point2D[],
    width: number,
    height: number,
    targetTriCount: number,
    addBorder: boolean
  ): Point2D[] {
    const points: Point2D[] = [];

    // Add averaged control points
    for (let i = 0; i < pointsA.length; i++) {
      points.push({
        x: (pointsA[i].x + pointsB[i].x) / 2,
        y: (pointsA[i].y + pointsB[i].y) / 2
      });
    }

    // Calculate how many additional grid points we need
    // Each triangle needs 3 vertices, but vertices are shared
    // Rough estimate: vertices ≈ triangles / 2
    const existingPoints = points.length;
    const targetVertices = Math.max(10, Math.floor(targetTriCount / 2));
    const neededPoints = Math.max(0, targetVertices - existingPoints);

    // Add regular grid points
    if (neededPoints > 0) {
      const gridPoints = this.generateGridPoints(width, height, neededPoints);
      points.push(...gridPoints);
    }

    // Add border points for better edge handling
    if (addBorder) {
      const borderPoints = this.generateBorderPoints(width, height, 16);
      points.push(...borderPoints);
    }

    return points;
  }

  /**
   * Generate a regular grid of points
   */
  private generateGridPoints(
    width: number,
    height: number,
    count: number
  ): Point2D[] {
    const points: Point2D[] = [];
    const cols = Math.ceil(Math.sqrt(count * (width / height)));
    const rows = Math.ceil(count / cols);
    const dx = width / (cols + 1);
    const dy = height / (rows + 1);

    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        points.push({
          x: c * dx,
          y: r * dy
        });
        if (points.length >= count) break;
      }
      if (points.length >= count) break;
    }

    return points;
  }

  /**
   * Generate border points around image perimeter
   */
  private generateBorderPoints(
    width: number,
    height: number,
    pointsPerSide: number
  ): Point2D[] {
    const points: Point2D[] = [];
    const step = 1 / (pointsPerSide + 1);

    for (let i = 1; i <= pointsPerSide; i++) {
      // Top edge
      points.push({ x: i * step * width, y: 0 });
      // Bottom edge
      points.push({ x: i * step * width, y: height });
      // Left edge
      points.push({ x: 0, y: i * step * height });
      // Right edge
      points.push({ x: width, y: i * step * height });
    }

    // Corners
    points.push({ x: 0, y: 0 });
    points.push({ x: width, y: 0 });
    points.push({ x: width, y: height });
    points.push({ x: 0, y: height });

    return points;
  }

  /**
   * Perform Delaunay triangulation using Delaunator
   */
  private triangulate(points: Point2D[]): {
    vertices: Point2D[];
    indices: number[];
  } {
    // Convert to flat array for Delaunator
    const coords: number[] = [];
    for (const p of points) {
      coords.push(p.x, p.y);
    }

    // Triangulate
    const delaunay = Delaunator.from(points.map(p => [p.x, p.y]));

    return {
      vertices: points,
      indices: Array.from(delaunay.triangles)
    };
  }

  /**
   * Compute affine transforms for each triangle
   */
  private computeTriangleAffines(
    triangulation: { vertices: Point2D[]; indices: number[] },
    meshPoints: Point2D[],
    pointsA: Point2D[],
    pointsB: Point2D[]
  ): Triangle[] {
    const { vertices, indices } = triangulation;
    const triangles: Triangle[] = [];

    // Process each triangle
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];

      const triIndices: [number, number, number] = [i0, i1, i2];

      // Get triangle vertices in mesh space
      const v0 = vertices[i0];
      const v1 = vertices[i1];
      const v2 = vertices[i2];

      // Find corresponding points in A and B
      // For simplicity, use barycentric coordinates to interpolate
      const affineA = this.computeTriangleAffine([v0, v1, v2], pointsA);
      const affineB = this.computeTriangleAffine([v0, v1, v2], pointsB);

      triangles.push({
        indices: triIndices,
        affineA,
        affineB
      });
    }

    return triangles;
  }

  /**
   * Compute affine transform for a triangle
   * This is a simplified version - in practice, we'd use the nearest control points
   */
  private computeTriangleAffine(
    triVertices: Point2D[],
    targetPoints: Point2D[]
  ): number[] {
    // Find nearest target point to triangle centroid
    const centroid = {
      x: (triVertices[0].x + triVertices[1].x + triVertices[2].x) / 3,
      y: (triVertices[0].y + triVertices[1].y + triVertices[2].y) / 3
    };

    // For now, use identity transform with small offset
    // In a full implementation, we'd interpolate from nearest control points
    const nearestIdx = this.findNearestPoint(centroid, targetPoints);
    const nearest = targetPoints[nearestIdx] || centroid;

    const dx = nearest.x - centroid.x;
    const dy = nearest.y - centroid.y;

    // Affine: [a, b, tx, c, d, ty]
    // Identity with translation
    return [1, 0, dx, 0, 1, dy];
  }

  /**
   * Find index of nearest point to target
   */
  private findNearestPoint(target: Point2D, points: Point2D[]): number {
    let minDist = Infinity;
    let minIdx = 0;

    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - target.x;
      const dy = points[i].y - target.y;
      const dist = dx * dx + dy * dy;

      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }

    return minIdx;
  }

  /**
   * Pack triangle affine transforms into RGBA32F texture
   * Each triangle uses 2 pixels: [a,b,tx,c] [d,ty,0,0]
   */
  packAffineTexture(
    gl: WebGL2RenderingContext,
    triangles: Triangle[],
    isA: boolean
  ): WebGLTexture | null {
    const data = new Float32Array(triangles.length * 8); // 2 pixels per triangle

    for (let i = 0; i < triangles.length; i++) {
      const affine = isA ? triangles[i].affineA : triangles[i].affineB;
      const baseIdx = i * 8;

      // First pixel: [a, b, tx, c]
      data[baseIdx + 0] = affine[0]; // a
      data[baseIdx + 1] = affine[1]; // b
      data[baseIdx + 2] = affine[2]; // tx
      data[baseIdx + 3] = affine[3]; // c

      // Second pixel: [d, ty, 0, 0]
      data[baseIdx + 4] = affine[4]; // d
      data[baseIdx + 5] = affine[5]; // ty
      data[baseIdx + 6] = 0;
      data[baseIdx + 7] = 0;
    }

    // Create texture (width = 2, height = triangleCount)
    const texture = createTexture(
      gl,
      2,
      triangles.length,
      gl.RGBA32F,
      gl.RGBA,
      gl.FLOAT,
      data
    );

    console.log(`[MeshBaker] Packed ${triangles.length} affine transforms into texture`);

    return texture;
  }
}
