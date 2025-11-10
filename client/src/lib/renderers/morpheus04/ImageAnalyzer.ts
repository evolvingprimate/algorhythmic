/**
 * Image Analyzer Module
 * Uses OpenCV.js for feature detection, matching, and similarity analysis
 */

import type { ImageAnalysisResult, Point2D } from './types';
import { computeHistogram, histogramDistance } from './utils';
import { loadOpenCV } from './opencvLoader';

// OpenCV.js will be loaded globally
declare const cv: any;

export class ImageAnalyzer {
  private cvReady: boolean = false;
  private initPromise: Promise<void> | null = null;
  private retryCount: number = 0;
  private readonly MAX_RETRIES = 3;

  constructor() {
    // BUG FIX: Catch unhandled promise rejection to prevent crash
    this.initPromise = this.initOpenCV().catch((error) => {
      console.error('[ImageAnalyzer] OpenCV init failed:', error);
      // Graceful degradation - set cv = null so analysis can be skipped
      this.cvReady = false;
    });
  }

  private async initOpenCV(): Promise<void> {
    // BUG FIX: Actually call loadOpenCV() which sets up Module.onRuntimeInitialized callback
    console.log('[ImageAnalyzer] Starting OpenCV initialization...');
    
    const maxRetries = 2;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.warn(`[ImageAnalyzer] ⚠️ OpenCV init attempt ${attempt + 1}/${maxRetries}, waiting ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
        
        console.log(`[ImageAnalyzer] Calling loadOpenCV() (attempt ${attempt + 1}/${maxRetries})...`);
        await loadOpenCV();
        this.cvReady = true;
        console.log('[ImageAnalyzer] ✅ OpenCV.js loaded successfully');
        return;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          console.error('[ImageAnalyzer] ❌ OpenCV.js failed to load after 2 attempts');
          console.error('[ImageAnalyzer] OpenCV init failed:', error);
          throw error;
        }
      }
    }
  }

  async ensureReady(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Main analysis function - computes all similarity metrics
   */
  async analyze(
    imageA: HTMLImageElement | ImageData,
    imageB: HTMLImageElement | ImageData,
    options: {
      targetRes?: number;
      maxFeatures?: number;
      enableSegmentation?: boolean;
    } = {}
  ): Promise<ImageAnalysisResult> {
    await this.ensureReady();

    // BUG FIX: Early return if OpenCV failed to load (graceful degradation)
    if (!this.cvReady || typeof cv === 'undefined') {
      console.warn('[ImageAnalyzer] OpenCV not ready, returning default analysis');
      return {
        inlierCount: 0,
        totalMatches: 0,
        inlierRatio: 0,
        homography: null,
        avgReprojectionError: 0,
        coverageHeatmap: Array(64).fill(0),
        coverageScore: 0,
        edgeOverlap: 0,
        histogramDistance: 0.5, // Neutral distance
        hasForeground: false,
      };
    }

    const {
      targetRes = 512,
      maxFeatures = 500,
      enableSegmentation = false
    } = options;

    console.log('[ImageAnalyzer] Starting analysis...');

    // Convert to OpenCV Mats
    const matA = this.imageToMat(imageA, targetRes);
    const matB = this.imageToMat(imageB, targetRes);

    // Convert to grayscale for feature detection
    const grayA = new cv.Mat();
    const grayB = new cv.Mat();
    cv.cvtColor(matA, grayA, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(matB, grayB, cv.COLOR_RGBA2GRAY);

    // 1. ORB Feature Detection and Matching
    const matchResult = this.detectAndMatch(grayA, grayB, maxFeatures);

    // 2. RANSAC Homography
    const homographyResult = this.computeHomography(matchResult);

    // 3. Coverage Heatmap
    const coverageResult = this.computeCoverageHeatmap(
      matchResult.goodMatches,
      matchResult.keypointsA,
      matA.cols,
      matA.rows
    );

    // 4. Edge Overlap
    const edgeOverlap = this.computeEdgeOverlap(grayA, grayB);

    // 5. Histogram Distance
    const histDist = this.computeHistogramDistance(matA, matB);

    // 6. Optional foreground segmentation
    let foregroundResult: {
      hasForeground: boolean;
      foregroundMaskA?: ImageData;
      foregroundMaskB?: ImageData;
    } = { hasForeground: false };

    if (enableSegmentation) {
      foregroundResult = this.segmentForeground(matA, matB);
    }

    // Clean up
    matA.delete();
    matB.delete();
    grayA.delete();
    grayB.delete();

    const result: ImageAnalysisResult = {
      inlierCount: homographyResult.inlierCount,
      totalMatches: matchResult.totalMatches,
      inlierRatio: matchResult.totalMatches > 0 
        ? homographyResult.inlierCount / matchResult.totalMatches 
        : 0,
      homography: homographyResult.homography,
      avgReprojectionError: homographyResult.avgReprojectionError,
      coverageHeatmap: coverageResult.heatmap,
      coverageScore: coverageResult.score,
      edgeOverlap,
      histogramDistance: histDist,
      ...foregroundResult
    };

    console.log('[ImageAnalyzer] Analysis complete:', {
      inliers: result.inlierCount,
      matches: result.totalMatches,
      ratio: result.inlierRatio.toFixed(3),
      coverage: result.coverageScore.toFixed(3),
      edgeOverlap: result.edgeOverlap.toFixed(3),
      histDist: result.histogramDistance.toFixed(3)
    });

    return result;
  }

  private imageToMat(image: HTMLImageElement | ImageData, targetRes: number): any {
    let mat: any;

    if (image instanceof HTMLImageElement) {
      // Create canvas and resize
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      // Resize to target resolution while preserving aspect ratio
      const scale = Math.min(targetRes / image.width, targetRes / image.height);
      canvas.width = Math.floor(image.width * scale);
      canvas.height = Math.floor(image.height * scale);
      
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      mat = cv.imread(canvas);
    } else {
      // ImageData - resize if needed
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

  private detectAndMatch(
    grayA: any,
    grayB: any,
    maxFeatures: number
  ): {
    keypointsA: any;
    keypointsB: any;
    descriptorsA: any;
    descriptorsB: any;
    goodMatches: any[];
    totalMatches: number;
  } {
    // Create ORB detector
    const orb = new cv.ORB(maxFeatures);

    // Detect and compute
    const keypointsA = new cv.KeyPointVector();
    const keypointsB = new cv.KeyPointVector();
    const descriptorsA = new cv.Mat();
    const descriptorsB = new cv.Mat();

    orb.detectAndCompute(grayA, new cv.Mat(), keypointsA, descriptorsA);
    orb.detectAndCompute(grayB, new cv.Mat(), keypointsB, descriptorsB);

    console.log(`[ImageAnalyzer] Features: A=${keypointsA.size()}, B=${keypointsB.size()}`);

    // Match using BFMatcher with Hamming distance
    const bf = new cv.BFMatcher(cv.NORM_HAMMING, true);
    const matches = new cv.DMatchVector();
    
    if (descriptorsA.rows > 0 && descriptorsB.rows > 0) {
      bf.match(descriptorsA, descriptorsB, matches);
    }

    // Sort matches by distance and keep top matches
    const matchesArray = [];
    for (let i = 0; i < matches.size(); i++) {
      matchesArray.push(matches.get(i));
    }
    matchesArray.sort((a, b) => a.distance - b.distance);

    const numGoodMatches = Math.min(50, Math.floor(matchesArray.length * 0.15));
    const goodMatches = matchesArray.slice(0, numGoodMatches);

    console.log(`[ImageAnalyzer] Matches: total=${matchesArray.length}, good=${goodMatches.length}`);

    // Clean up (but keep keypoints and descriptors for homography)
    matches.delete();
    orb.delete();
    bf.delete();

    return {
      keypointsA,
      keypointsB,
      descriptorsA,
      descriptorsB,
      goodMatches,
      totalMatches: matchesArray.length
    };
  }

  private computeHomography(matchResult: {
    keypointsA: any;
    keypointsB: any;
    goodMatches: any[];
  }): {
    homography: number[] | null;
    inlierCount: number;
    avgReprojectionError: number;
  } {
    const { keypointsA, keypointsB, goodMatches } = matchResult;

    if (goodMatches.length < 4) {
      console.warn('[ImageAnalyzer] Not enough matches for homography');
      return { homography: null, inlierCount: 0, avgReprojectionError: 0 };
    }

    // Extract matched point locations
    const srcPoints = [];
    const dstPoints = [];

    for (const match of goodMatches) {
      const kpA = keypointsA.get(match.queryIdx);
      const kpB = keypointsB.get(match.trainIdx);
      srcPoints.push(kpA.pt.x, kpA.pt.y);
      dstPoints.push(kpB.pt.x, kpB.pt.y);
    }

    // Convert to cv.Mat
    const srcMat = cv.matFromArray(
      srcPoints.length / 2,
      1,
      cv.CV_32FC2,
      srcPoints
    );
    const dstMat = cv.matFromArray(
      dstPoints.length / 2,
      1,
      cv.CV_32FC2,
      dstPoints
    );

    // Find homography with RANSAC
    const mask = new cv.Mat();
    const H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 5.0, mask);

    // Count inliers
    let inlierCount = 0;
    for (let i = 0; i < mask.rows; i++) {
      if (mask.ucharAt(i, 0) === 1) {
        inlierCount++;
      }
    }

    // Extract homography matrix as flat array
    let homography: number[] | null = null;
    if (H && !H.empty()) {
      homography = [];
      for (let i = 0; i < 9; i++) {
        const row = Math.floor(i / 3);
        const col = i % 3;
        homography.push(H.doubleAt(row, col));
      }
    }

    // Compute average reprojection error
    let avgError = 0;
    if (homography && inlierCount > 0) {
      let errorSum = 0;
      for (let i = 0; i < goodMatches.length; i++) {
        if (mask.ucharAt(i, 0) === 1) {
          const srcX = srcPoints[i * 2];
          const srcY = srcPoints[i * 2 + 1];
          const dstX = dstPoints[i * 2];
          const dstY = dstPoints[i * 2 + 1];

          // Transform source point using homography
          const w = homography[6] * srcX + homography[7] * srcY + homography[8];
          const projX = (homography[0] * srcX + homography[1] * srcY + homography[2]) / w;
          const projY = (homography[3] * srcX + homography[4] * srcY + homography[5]) / w;

          // Euclidean distance
          const dx = projX - dstX;
          const dy = projY - dstY;
          errorSum += Math.sqrt(dx * dx + dy * dy);
        }
      }
      avgError = errorSum / inlierCount;
    }

    // Clean up
    srcMat.delete();
    dstMat.delete();
    mask.delete();
    if (H) H.delete();

    return { homography, inlierCount, avgReprojectionError: avgError };
  }

  private computeCoverageHeatmap(
    matches: any[],
    keypoints: any,
    width: number,
    height: number,
    gridSize: number = 8
  ): { heatmap: number[]; score: number } {
    const heatmap = new Array(gridSize * gridSize).fill(0);
    const cellWidth = width / gridSize;
    const cellHeight = height / gridSize;

    // Count matches per grid cell
    for (const match of matches) {
      const kp = keypoints.get(match.queryIdx);
      const cellX = Math.min(gridSize - 1, Math.floor(kp.pt.x / cellWidth));
      const cellY = Math.min(gridSize - 1, Math.floor(kp.pt.y / cellHeight));
      heatmap[cellY * gridSize + cellX]++;
    }

    // Normalize to 0..1
    const maxCount = Math.max(...heatmap, 1);
    const normalizedHeatmap = heatmap.map(v => v / maxCount);

    // Compute coverage score (percentage of non-empty cells)
    const nonEmptyCells = heatmap.filter(v => v > 0).length;
    const score = nonEmptyCells / (gridSize * gridSize);

    return { heatmap: normalizedHeatmap, score };
  }

  private computeEdgeOverlap(grayA: any, grayB: any): number {
    // Sobel edge detection
    const sobelA = new cv.Mat();
    const sobelB = new cv.Mat();
    const gradXA = new cv.Mat();
    const gradYA = new cv.Mat();
    const gradXB = new cv.Mat();
    const gradYB = new cv.Mat();

    cv.Sobel(grayA, gradXA, cv.CV_32F, 1, 0);
    cv.Sobel(grayA, gradYA, cv.CV_32F, 0, 1);
    cv.Sobel(grayB, gradXB, cv.CV_32F, 1, 0);
    cv.Sobel(grayB, gradYB, cv.CV_32F, 0, 1);

    // Magnitude
    cv.magnitude(gradXA, gradYA, sobelA);
    cv.magnitude(gradXB, gradYB, sobelB);

    // Normalize
    cv.normalize(sobelA, sobelA, 0, 1, cv.NORM_MINMAX);
    cv.normalize(sobelB, sobelB, 0, 1, cv.NORM_MINMAX);

    // Compute correlation
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < sobelA.rows; i++) {
      for (let j = 0; j < sobelA.cols; j++) {
        const a = sobelA.floatAt(i, j);
        const b = sobelB.floatAt(i, j);
        dotProduct += a * b;
        normA += a * a;
        normB += b * b;
      }
    }

    const overlap = normA > 0 && normB > 0 
      ? dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
      : 0;

    // Clean up
    sobelA.delete();
    sobelB.delete();
    gradXA.delete();
    gradYA.delete();
    gradXB.delete();
    gradYB.delete();

    return Math.max(0, Math.min(1, overlap));
  }

  private computeHistogramDistance(matA: any, matB: any): number {
    // Convert Mats to ImageData
    const canvasA = document.createElement('canvas');
    const canvasB = document.createElement('canvas');
    canvasA.width = matA.cols;
    canvasA.height = matA.rows;
    canvasB.width = matB.cols;
    canvasB.height = matB.rows;

    cv.imshow(canvasA, matA);
    cv.imshow(canvasB, matB);

    const ctxA = canvasA.getContext('2d')!;
    const ctxB = canvasB.getContext('2d')!;
    const imageDataA = ctxA.getImageData(0, 0, matA.cols, matA.rows);
    const imageDataB = ctxB.getImageData(0, 0, matB.cols, matB.rows);

    // Compute histograms
    const histA = computeHistogram(imageDataA, 16);
    const histB = computeHistogram(imageDataB, 16);

    // Compute distance
    return histogramDistance(histA, histB);
  }

  private segmentForeground(matA: any, matB: any): {
    hasForeground: boolean;
    foregroundMaskA?: ImageData;
    foregroundMaskB?: ImageData;
  } {
    // Simple foreground segmentation using GrabCut (placeholder)
    // In a full implementation, this would use cv.grabCut or a similar method
    console.log('[ImageAnalyzer] Foreground segmentation not yet implemented');
    return { hasForeground: false };
  }
}
