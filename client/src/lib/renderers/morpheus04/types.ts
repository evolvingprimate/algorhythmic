/**
 * Morpheus 0.4 Type Definitions
 * Feature-based morphing with audio-reactive controls
 */

// ============================================================================
// Audio-Reactive Control Types
// ============================================================================

export interface MorphControls {
  // Progress control
  t: number;                    // 0..1 morph position
  tRateBase: number;            // base auto-progress per second (default 0)
  tRate: number;                // effective per-frame increment computed each tick
  tBeatNudge: number;           // added on each beat (default 0.03)

  // Warping intensity
  dispAmp: number;              // 0..0.015 (default 0.006)
  seamFeather: number;          // pixels (default 1.0)
  tpsLambda: number;            // regularization (default 0.02)
  meshSharpen: number;          // 0..0.15 (default 0)

  // Background variant (optional)
  bgDispAmp: number;            // 0..dispAmp (default dispAmp*0.5)

  // Safety caps
  caps: {
    maxDispAmp: number;         // 0.015
    maxTRate: number;           // 0.15  // per second
    maxSharpen: number;         // 0.15
  };
}

export interface AudioSignals {
  rms: number;                  // instant loudness, 0..1
  rmsSlow: number;              // smoothed loudness envelope
  peak: number;                 // tracked peak for normalization
  centroid: number;             // spectral brightness, 0..1
  beatPulse: number;            // 0..1 short pulse right after each beat
  barBoundary: boolean;         // true once every 4 beats
  tempoBpm: number;             // current tempo (default 120)
}

export interface AudioReactiveOpts {
  tempoBpm?: number;            // default 120
  barBeats?: number;            // default 4
  audioVisualOffsetMs?: number; // default -50
  enableStageGating?: boolean;  // default true
}

// ============================================================================
// Image Analysis Types
// ============================================================================

export interface ImageAnalysisResult {
  // Feature matching metrics
  inlierCount: number;          // number of RANSAC inliers
  totalMatches: number;         // total ORB matches found
  inlierRatio: number;          // inlierCount / totalMatches
  
  // Homography quality
  homography: number[] | null;  // 3x3 matrix (flat array) or null if failed
  avgReprojectionError: number; // average pixel error
  
  // Spatial coverage
  coverageHeatmap: number[];    // NxN grid of match density (0..1)
  coverageScore: number;        // overall coverage metric (0..1)
  
  // Edge alignment
  edgeOverlap: number;          // Sobel edge similarity (0..1)
  
  // Color similarity
  histogramDistance: number;    // 3x16 RGB histogram distance (0..1, lower=more similar)
  
  // Foreground segmentation (optional)
  hasForeground: boolean;
  foregroundMaskA?: ImageData;  // mask for image A
  foregroundMaskB?: ImageData;  // mask for image B
}

// ============================================================================
// Morph Planning Types
// ============================================================================

export type MorphMode = 'mesh' | 'tps' | 'flow' | 'crossfade';

export interface MorphStage {
  mode: MorphMode;
  tStart: number;               // 0..1 when this stage begins
  tEnd: number;                 // 0..1 when this stage ends
  
  // Per-stage parameters
  triCount?: number;            // for mesh mode
  lambda?: number;              // for TPS mode
  rigidity?: number;            // for mesh/TPS blend
  seamFeather?: number;         // edge feathering in pixels
  flowWeight?: number;          // for flow mode
  dispAmp?: number;             // displacement amplitude
  dispFreq?: number;            // displacement frequency
}

export interface MorphPlan {
  stages: MorphStage[];
  reasoning: string;            // why this plan was chosen
  confidence: number;           // 0..1 how confident the planner is
}

// ============================================================================
// Baked Data Types
// ============================================================================

export interface Point2D {
  x: number;
  y: number;
}

export interface Triangle {
  indices: [number, number, number];  // vertex indices
  affineA: number[];                  // 6-element affine transform for A→B
  affineB: number[];                  // 6-element affine transform for B→A
}

export interface MeshData {
  vertices: Point2D[];          // control points
  triangles: Triangle[];        // Delaunay triangulation
  textureA: WebGLTexture | null; // RGBA32F packed affine matrices for A
  textureB: WebGLTexture | null; // RGBA32F packed affine matrices for B
}

export interface TPSData {
  controlPointsA: Point2D[];    // source control points
  controlPointsB: Point2D[];    // target control points
  weights: number[];            // TPS RBF weights
  affine: number[];             // 3x3 affine component (flat array)
  displacementMap: WebGLTexture | null; // RG32F displacement texture
}

export interface FlowData {
  flowField: Float32Array;      // dense displacement field (2 channels)
  confidence: Float32Array;     // confidence map (1 channel)
  width: number;
  height: number;
  flowTexture: WebGLTexture | null; // RG32F flow texture
  confidenceTexture: WebGLTexture | null; // R32F confidence texture
}

// ============================================================================
// OpenCV.js Types (minimal, will use @opencvjs/types)
// ============================================================================

export interface CVKeyPoint {
  pt: { x: number; y: number };
  size: number;
  angle: number;
  response: number;
  octave: number;
  class_id: number;
}

export interface CVMatch {
  queryIdx: number;
  trainIdx: number;
  distance: number;
}

// ============================================================================
// Utility Types
// ============================================================================

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}
