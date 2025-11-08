/**
 * Morpheus 0.4 Utility Functions
 */

// ============================================================================
// Math Utilities
// ============================================================================

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function easeInOut(t: number): number {
  return t < 0.5 
    ? 2 * t * t 
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ============================================================================
// Image Processing Utilities
// ============================================================================

export function resizeImageData(
  source: ImageData,
  targetWidth: number,
  targetHeight: number
): ImageData {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  // Create source canvas
  const srcCanvas = document.createElement('canvas');
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCanvas.width = source.width;
  srcCanvas.height = source.height;
  srcCtx.putImageData(source, 0, 0);
  
  // Resize
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  ctx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
  
  return ctx.getImageData(0, 0, targetWidth, targetHeight);
}

export function imageDataToDataURL(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
}

export function dataURLToImageData(dataURL: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

// ============================================================================
// Matrix Utilities
// ============================================================================

export function mat3Multiply(a: number[], b: number[]): number[] {
  const result = new Array(9).fill(0);
  
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        result[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
      }
    }
  }
  
  return result;
}

export function mat3Invert(m: number[]): number[] | null {
  const det = 
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  
  if (Math.abs(det) < 1e-10) {
    return null;
  }
  
  const invDet = 1 / det;
  
  return [
    (m[4] * m[8] - m[5] * m[7]) * invDet,
    (m[2] * m[7] - m[1] * m[8]) * invDet,
    (m[1] * m[5] - m[2] * m[4]) * invDet,
    (m[5] * m[6] - m[3] * m[8]) * invDet,
    (m[0] * m[8] - m[2] * m[6]) * invDet,
    (m[2] * m[3] - m[0] * m[5]) * invDet,
    (m[3] * m[7] - m[4] * m[6]) * invDet,
    (m[1] * m[6] - m[0] * m[7]) * invDet,
    (m[0] * m[4] - m[1] * m[3]) * invDet
  ];
}

export function affineTransformPoint(
  affine: number[], // [a, b, c, d, e, f] for [a b tx; c d ty; 0 0 1]
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: affine[0] * x + affine[1] * y + affine[2],
    y: affine[3] * x + affine[4] * y + affine[5]
  };
}

// Compute affine transform from 3 point correspondences
export function solveAffine(
  src: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  dst: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
): number[] {
  // Solve for affine matrix [a b tx; c d ty; 0 0 1]
  // System: dst = M * src
  
  const [p0, p1, p2] = src;
  const [q0, q1, q2] = dst;
  
  // Build linear system
  const A = [
    [p0.x, p0.y, 1, 0, 0, 0],
    [0, 0, 0, p0.x, p0.y, 1],
    [p1.x, p1.y, 1, 0, 0, 0],
    [0, 0, 0, p1.x, p1.y, 1],
    [p2.x, p2.y, 1, 0, 0, 0],
    [0, 0, 0, p2.x, p2.y, 1]
  ];
  
  const b = [q0.x, q0.y, q1.x, q1.y, q2.x, q2.y];
  
  // Solve using simple Gaussian elimination (good enough for 6x6)
  const x = gaussianElimination(A, b);
  
  return x; // [a, b, tx, c, d, ty]
}

function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);
  
  // Forward elimination
  for (let i = 0; i < n; i++) {
    // Partial pivoting
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    
    // Make all rows below this one 0 in current column
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
    x[i] /= augmented[i][i];
  }
  
  return x;
}

// ============================================================================
// WebGL Utilities
// ============================================================================

export function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  data: ArrayBufferView | null = null
): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) return null;
  
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internalFormat,
    width,
    height,
    0,
    format,
    type,
    data
  );
  
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  
  return texture;
}

export function updateTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
  format: number,
  type: number,
  data: ArrayBufferView
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    width,
    height,
    format,
    type,
    data
  );
}

// ============================================================================
// Color Utilities
// ============================================================================

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  
  let h = 0;
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / delta + 2) / 6;
    } else {
      h = ((r - g) / delta + 4) / 6;
    }
  }
  
  return { h, s, v };
}

export function computeHistogram(imageData: ImageData, bins: number = 16): number[] {
  const histogram = new Array(bins * 3).fill(0);
  const data = imageData.data;
  const binSize = 256 / bins;
  
  for (let i = 0; i < data.length; i += 4) {
    const rBin = Math.min(bins - 1, Math.floor(data[i] / binSize));
    const gBin = Math.min(bins - 1, Math.floor(data[i + 1] / binSize));
    const bBin = Math.min(bins - 1, Math.floor(data[i + 2] / binSize));
    
    histogram[rBin]++;
    histogram[bins + gBin]++;
    histogram[bins * 2 + bBin]++;
  }
  
  // Normalize
  const total = imageData.width * imageData.height;
  return histogram.map(v => v / total);
}

export function histogramDistance(hist1: number[], hist2: number[]): number {
  let sum = 0;
  for (let i = 0; i < hist1.length; i++) {
    sum += Math.abs(hist1[i] - hist2[i]);
  }
  return sum / hist1.length;
}
