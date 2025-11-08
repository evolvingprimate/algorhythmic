import { z } from "zod";

// ============================================================================
// Clock & Timing
// ============================================================================

export interface ClockState {
  tempo: number;           // BPM
  beatPhase: number;       // 0-1 within current beat
  barPhase: number;        // 0-1 within current bar (4 beats)
  currentBar: number;      // Bar number since start
  confidence: number;      // 0-1, tempo estimation confidence
  timestamp: number;       // Performance.now()
}

// ============================================================================
// Audio Features
// ============================================================================

export interface AudioFeatures {
  ts: number;
  bpm: number;
  beatPhase: number;
  rms: number;              // Root mean square (overall loudness)
  bands128: Float32Array;   // 128 frequency bands
  centroid: number;         // Spectral centroid (brightness)
  energy: number;           // Total energy
  bass: number;             // Low frequency energy (0-250 Hz)
  mids: number;             // Mid frequency energy (250-2000 Hz)
  highs: number;            // High frequency energy (2000+ Hz)
}

// ============================================================================
// Vision Features (for Phase 3)
// ============================================================================

export interface VisionFeatures {
  ts: number;
  color: { 
    palette: number[];        // RGB colors
    luminanceMean: number;    // Average brightness
    contrast: number;         // Contrast ratio
  };
  edges: { 
    density: number;          // Edge pixel density 0-1
    mapTex?: WebGLTexture;    // Edge map texture
    polylines: Float32Array[];// Edge polylines
  };
  keypoints: { 
    points: Float32Array;     // [x,y,score]* keypoint positions
    count: number;            // Number of keypoints
  };
  saliency: { 
    heatTex?: WebGLTexture;   // Saliency heatmap
    centers: Float32Array;    // [x,y,score]* salient regions
  };
  segments?: { 
    masks: WebGLTexture[];    // Segmentation masks
    classes?: string[];       // Segment class labels
  };
  clip?: { 
    embedding: Float32Array;  // CLIP embedding vector
    tags: string[];           // Recognized tags
  };
}

// ============================================================================
// DNA & Image Performance (for Phase 3)
// ============================================================================

export interface FrameContext {
  dna: Uint8Array;          // 50-point DNA vector (0-255)
  model: string;            // Generator model name
  seed: number;             // Generation seed
  ageSec: number;           // Time since creation
  isHero: boolean;          // Is this the hero/main frame
}

export interface ImagePerformance {
  generator: "DALL-E" | "Flux" | "SDXL" | string;
  dna: Uint8Array;          // 50-D visual genome
  artistStatement: string;  // Brief textual intent
  timestamp: number;
  imageUrl?: string;        // Optional if remote
}

// ============================================================================
// Intent Types
// ============================================================================

export type Intent =
  | { kind: "trace-outline"; target: "dominant-silhouette" | "all-edges"; style: "neon" | "ink" | "glow"; strength: number }
  | { kind: "pixie-dust"; source: "dot-keypoints" | "bright-pixels"; decayBeats: number; density: number; inheritColor: boolean }
  | { kind: "kaleido"; symmetry: number; rotationBeats: number }
  | { kind: "warp-bass"; elasticity: number; radius: number };

// ============================================================================
// Directive (scheduled intent with safety constraints)
// ============================================================================

export interface Directive {
  id: string;
  ts: number;
  startAtBar: number;
  durationBars: number;
  params: Record<string, number | boolean | string>;
  intent: Intent;
  safety: { 
    fpsMin: number;         // Don't execute if FPS below this
    coolDownBars: number;   // Wait this many bars before similar effect
  };
}

// ============================================================================
// Command Types (MorphEngine v2 Control Plane)
// ============================================================================

export type EnginePath = string;  // e.g., "particles.main.spawnRate"
export type Bars = number;

// Set a parameter immediately
export interface CmdSet {
  kind: "SET";
  path: EnginePath;
  value: number | number[] | string | boolean;
}

// Ramp a parameter over time
export interface CmdRamp {
  kind: "RAMP";
  path: EnginePath;
  to: number | number[];
  durationBars: Bars;
  curve?: "linear" | "easeInOut" | "expo";
}

// Pulse a parameter (spike and decay)
export interface CmdPulse {
  kind: "PULSE";
  path: EnginePath;
  amount: number | number[];
  decayBeats: number;
}

// Schedule commands for future execution
export interface CmdSchedule {
  kind: "SCHEDULE";
  atBar: number;
  commands: Command[];
}

// Attach a particle emitter to a source
export interface CmdAttachEmitter {
  kind: "ATTACH_EMITTER";
  path: "particles.main.emitters";
  source: "dot-keypoints" | "bright-pixels" | "saliency";
  maxRate?: number;
}

// Set a color palette
export interface CmdSetPalette {
  kind: "SET_PALETTE";
  path: "mixer.palette";
  paletteId: string;
}

// Load spawn field anchors for intelligent particle emission
export interface CmdParticleSpawnField {
  kind: "PARTICLE_SPAWN_FIELD";
  path: "particles.main.spawnField";
  anchors: Array<{ x: number; y: number; weight: number }>;
}

// Trigger particle burst at climax moments
export interface CmdParticleBurst {
  kind: "PARTICLE_BURST";
  path: "particles.main.burst";
  durationBeats: number;      // How long to burst (typically 2s / ~4 beats)
  intensityMultiplier: number; // Spawn rate multiplier during burst
}

export type Command = 
  | CmdSet 
  | CmdRamp 
  | CmdPulse 
  | CmdSchedule 
  | CmdAttachEmitter 
  | CmdSetPalette
  | CmdParticleSpawnField
  | CmdParticleBurst;

// ============================================================================
// Zod Validators
// ============================================================================

export const cmdSetSchema = z.object({
  kind: z.literal("SET"),
  path: z.string(),
  value: z.union([z.number(), z.array(z.number()), z.string(), z.boolean()]),
});

export const cmdRampSchema = z.object({
  kind: z.literal("RAMP"),
  path: z.string(),
  to: z.union([z.number(), z.array(z.number())]),
  durationBars: z.number(),
  curve: z.enum(["linear", "easeInOut", "expo"]).optional(),
});

export const cmdPulseSchema = z.object({
  kind: z.literal("PULSE"),
  path: z.string(),
  amount: z.union([z.number(), z.array(z.number())]),
  decayBeats: z.number(),
});

export const cmdScheduleSchema = z.object({
  kind: z.literal("SCHEDULE"),
  atBar: z.number(),
  commands: z.array(z.any()), // Recursive type, validated at runtime
});

export const cmdAttachEmitterSchema = z.object({
  kind: z.literal("ATTACH_EMITTER"),
  path: z.literal("particles.main.emitters"),
  source: z.enum(["dot-keypoints", "bright-pixels", "saliency"]),
  maxRate: z.number().optional(),
});

export const cmdSetPaletteSchema = z.object({
  kind: z.literal("SET_PALETTE"),
  path: z.literal("mixer.palette"),
  paletteId: z.string(),
});

export const cmdParticleSpawnFieldSchema = z.object({
  kind: z.literal("PARTICLE_SPAWN_FIELD"),
  path: z.literal("particles.main.spawnField"),
  anchors: z.array(z.object({
    x: z.number(),
    y: z.number(),
    weight: z.number(),
  })),
});

export const cmdParticleBurstSchema = z.object({
  kind: z.literal("PARTICLE_BURST"),
  path: z.literal("particles.main.burst"),
  durationBeats: z.number(),
  intensityMultiplier: z.number(),
});

export const commandSchema = z.discriminatedUnion("kind", [
  cmdSetSchema,
  cmdRampSchema,
  cmdPulseSchema,
  cmdScheduleSchema,
  cmdAttachEmitterSchema,
  cmdSetPaletteSchema,
  cmdParticleSpawnFieldSchema,
  cmdParticleBurstSchema,
]);

// ============================================================================
// Parameter Metadata (for ParameterRegistry)
// ============================================================================

export interface ParameterMetadata {
  path: EnginePath;
  type: "float" | "vec2" | "vec3" | "color" | "bool" | "enum" | "curve";
  defaultValue: number | number[] | string | boolean;
  range?: [number, number];      // Min/max for numeric types
  unit?: string;                 // "Hz", "dB", "px", etc.
  tags?: string[];               // For batch operations: "particles", "postfx", etc.
  description?: string;
}

// ============================================================================
// Events
// ============================================================================

export interface CommandEvent {
  type: "applied" | "rejected" | "clamped" | "finished";
  command: Command;
  reason?: string;
  timestamp: number;
}

// ============================================================================
// Evaluator Opportunities (decision inputs)
// ============================================================================

export interface Opportunities {
  manyDots: number;          // 0-1, lots of keypoints detected
  strongSilhouette: number;  // 0-1, clear dominant shape
  edgeParty: number;         // 0-1, high edge density
  dramaBeat: number;         // 0-1, strong beat with high energy
  novelty: number;           // 0-1, scene change detected
}
