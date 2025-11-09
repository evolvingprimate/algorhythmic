/**
 * AnchorDetector - Finds visually interesting regions in images
 * Uses saliency detection and edge analysis to locate focal points
 */

export interface AnchorPoint {
  centerX: number;  // Normalized 0-1
  centerY: number;  // Normalized 0-1
  size: number;     // Normalized 0-1
  confidence: number; // 0-1 score
}

const ANALYSIS_SIZE = 256;
const GRID_COLS = 32;
const GRID_ROWS = 18;
const CONFIDENCE_THRESHOLD = 0.18; // Minimum confidence to use detected anchor
const MIN_ANCHOR_SIZE = 0.12; // 12% of frame minimum size
const MAX_ANCHOR_SIZE = 0.6; // 60% of frame maximum size

export class AnchorDetector {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ANALYSIS_SIZE;
    this.canvas.height = ANALYSIS_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }
  
  /**
   * Analyze image and find the most interesting anchor point
   */
  async detectAnchor(image: HTMLImageElement): Promise<AnchorPoint> {
    // Downscale image to analysis size
    this.ctx.clearRect(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    this.ctx.drawImage(image, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    
    const imageData = this.ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    
    // Compute grayscale once (shared by saliency and edges)
    const grayscale = this.toGrayscale(imageData);
    
    // Compute saliency map
    const saliencyMap = this.computeSaliency(grayscale, ANALYSIS_SIZE, ANALYSIS_SIZE);
    
    // Compute edge density
    const edgeMap = this.computeEdges(grayscale, ANALYSIS_SIZE, ANALYSIS_SIZE);
    
    // Score superpixels
    const anchor = this.findBestAnchor(saliencyMap, edgeMap);
    
    return anchor;
  }
  
  /**
   * Convert image data to grayscale (shared computation)
   */
  private toGrayscale(imageData: ImageData): Float32Array {
    const { width, height, data } = imageData;
    const grayscale = new Float32Array(width * height);
    
    for (let i = 0; i < data.length; i += 4) {
      const idx = i / 4;
      grayscale[idx] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    
    return grayscale;
  }
  
  /**
   * Compute saliency map using simplified local variance
   * Uses mirror-border sampling to avoid edge bias
   */
  private computeSaliency(grayscale: Float32Array, width: number, height: number): Float32Array {
    const saliency = new Float32Array(width * height);
    const radius = 8;
    
    // Helper to sample with mirror border
    const sampleMirror = (x: number, y: number): number => {
      // Mirror at boundaries
      if (x < 0) x = -x;
      if (x >= width) x = 2 * width - x - 1;
      if (y < 0) y = -y;
      if (y >= height) y = 2 * height - y - 1;
      
      // Clamp to valid range
      x = Math.max(0, Math.min(width - 1, x));
      y = Math.max(0, Math.min(height - 1, y));
      
      return grayscale[y * width + x];
    };
    
    // Compute local variance for all pixels (including borders)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const center = grayscale[idx];
        
        // Compute local variance (high variance = salient)
        let variance = 0;
        let count = 0;
        
        for (let dy = -radius; dy <= radius; dy += 2) {
          for (let dx = -radius; dx <= radius; dx += 2) {
            const neighbor = sampleMirror(x + dx, y + dy);
            const diff = neighbor - center;
            variance += diff * diff;
            count++;
          }
        }
        
        saliency[idx] = Math.sqrt(variance / count);
      }
    }
    
    // Normalize
    let maxSal = 0;
    for (let i = 0; i < saliency.length; i++) {
      maxSal = Math.max(maxSal, saliency[i]);
    }
    if (maxSal > 0) {
      for (let i = 0; i < saliency.length; i++) {
        saliency[i] /= maxSal;
      }
    }
    
    return saliency;
  }
  
  /**
   * Compute edge density using Sobel operator
   */
  private computeEdges(grayscale: Float32Array, width: number, height: number): Float32Array {
    const edges = new Float32Array(width * height);
    
    // Sobel kernels
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;
        
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = (y + ky) * width + (x + kx);
            const kernelIdx = (ky + 1) * 3 + (kx + 1);
            gx += grayscale[idx] * sobelX[kernelIdx];
            gy += grayscale[idx] * sobelY[kernelIdx];
          }
        }
        
        edges[y * width + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    
    // Normalize
    let maxEdge = 0;
    for (let i = 0; i < edges.length; i++) {
      maxEdge = Math.max(maxEdge, edges[i]);
    }
    if (maxEdge > 0) {
      for (let i = 0; i < edges.length; i++) {
        edges[i] /= maxEdge;
      }
    }
    
    return edges;
  }
  
  /**
   * Find best anchor by scoring superpixels with localized clustering
   */
  private findBestAnchor(saliency: Float32Array, edges: Float32Array): AnchorPoint {
    const cellWidth = ANALYSIS_SIZE / GRID_COLS;
    const cellHeight = ANALYSIS_SIZE / GRID_ROWS;
    
    interface Cell {
      col: number;
      row: number;
      x: number;
      y: number;
      score: number;
    }
    
    const cells: Cell[][] = [];
    
    // Score each grid cell and store in 2D array for adjacency lookup
    for (let row = 0; row < GRID_ROWS; row++) {
      cells[row] = [];
      for (let col = 0; col < GRID_COLS; col++) {
        let salSum = 0;
        let edgeSum = 0;
        let count = 0;
        
        const startX = Math.floor(col * cellWidth);
        const startY = Math.floor(row * cellHeight);
        const endX = Math.floor((col + 1) * cellWidth);
        const endY = Math.floor((row + 1) * cellHeight);
        
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = y * ANALYSIS_SIZE + x;
            salSum += saliency[idx];
            edgeSum += edges[idx];
            count++;
          }
        }
        
        // Combined score (saliency × edge density)
        const avgSal = salSum / count;
        const avgEdge = edgeSum / count;
        const score = avgSal * 0.7 + avgEdge * 0.3;
        
        cells[row][col] = {
          col,
          row,
          x: col * cellWidth + cellWidth / 2,
          y: row * cellHeight + cellHeight / 2,
          score
        };
      }
    }
    
    // Find highest scoring cell
    let bestCell = cells[0][0];
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (cells[row][col].score > bestCell.score) {
          bestCell = cells[row][col];
        }
      }
    }
    
    // Check if confidence is above threshold
    if (bestCell.score < CONFIDENCE_THRESHOLD) {
      // Fallback to center with low confidence
      return {
        centerX: 0.5,
        centerY: 0.5,
        size: 0.3,
        confidence: 0.0
      };
    }
    
    // BFS flood-fill from best cell to find connected cluster
    const threshold = bestCell.score * 0.7;
    const visited = new Set<string>();
    const cluster: Cell[] = [];
    const queue: Cell[] = [bestCell];
    
    while (queue.length > 0) {
      const cell = queue.shift()!;
      const key = `${cell.row},${cell.col}`;
      
      if (visited.has(key)) continue;
      visited.add(key);
      cluster.push(cell);
      
      // Check 4-connected neighbors
      const neighbors = [
        [cell.row - 1, cell.col],
        [cell.row + 1, cell.col],
        [cell.row, cell.col - 1],
        [cell.row, cell.col + 1],
      ];
      
      for (const [nRow, nCol] of neighbors) {
        if (nRow >= 0 && nRow < GRID_ROWS && nCol >= 0 && nCol < GRID_COLS) {
          const neighbor = cells[nRow][nCol];
          const neighborKey = `${nRow},${nCol}`;
          
          if (!visited.has(neighborKey) && neighbor.score >= threshold) {
            queue.push(neighbor);
          }
        }
      }
    }
    
    // Compute bounding box of cluster
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const cell of cluster) {
      minX = Math.min(minX, cell.x - cellWidth / 2);
      maxX = Math.max(maxX, cell.x + cellWidth / 2);
      minY = Math.min(minY, cell.y - cellHeight / 2);
      maxY = Math.max(maxY, cell.y + cellHeight / 2);
    }
    
    // Normalize to 0-1 range
    const centerX = ((minX + maxX) / 2) / ANALYSIS_SIZE;
    const centerY = ((minY + maxY) / 2) / ANALYSIS_SIZE;
    const width = (maxX - minX) / ANALYSIS_SIZE;
    const height = (maxY - minY) / ANALYSIS_SIZE;
    let size = Math.max(width, height);
    
    // Enforce size constraints
    size = Math.max(MIN_ANCHOR_SIZE, Math.min(MAX_ANCHOR_SIZE, size));
    
    return {
      centerX,
      centerY,
      size,
      confidence: bestCell.score
    };
  }
}
