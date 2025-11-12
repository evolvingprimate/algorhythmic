/**
 * Validation Middleware for API Endpoints
 * Uses Zod schemas for comprehensive input validation
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { 
  insertArtPreferenceSchema,
  insertArtVoteSchema,
  insertArtSessionSchema,
  insertArtFavoriteSchema,
  insertTelemetryEventSchema 
} from '@shared/schema';

// ============================================================================
// Generic Validation Middleware Factory
// ============================================================================

/**
 * Creates a validation middleware for request body using Zod schema
 */
export function validateBody<T>(schema: z.ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.body);
      req.body = validated; // Replace with validated/sanitized data
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.warn('[Validation] Request body failed validation:', error.errors);
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }
      // Other errors
      console.error('[Validation] Unexpected error:', error);
      return res.status(500).json({ error: 'Internal validation error' });
    }
  };
}

/**
 * Validates query parameters using Zod schema
 */
export function validateQuery<T>(schema: z.ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.query);
      req.query = validated as any;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Query parameter validation failed',
          details: error.errors
        });
      }
      return res.status(500).json({ error: 'Internal validation error' });
    }
  };
}

/**
 * Validates route parameters using Zod schema
 */
export function validateParams<T>(schema: z.ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.params);
      req.params = validated as any;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Route parameter validation failed',
          details: error.errors
        });
      }
      return res.status(500).json({ error: 'Internal validation error' });
    }
  };
}

// ============================================================================
// Specific Validation Schemas for Endpoints
// ============================================================================

// Art generation request validation
export const generateArtSchema = z.object({
  sessionId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\-_]+$/),
  audioAnalysis: z.object({
    lowEnergy: z.number().min(0).max(1),
    midEnergy: z.number().min(0).max(1),
    highEnergy: z.number().min(0).max(1),
    rms: z.number().min(0).max(1),
    zcr: z.number().min(0).max(1),
    spectralCentroid: z.number().min(0).max(1),
    spectralRolloff: z.number().min(0).max(1),
    mfcc: z.array(z.number()).length(13),
    bpm: z.number().min(0).max(300),
    beatIntensity: z.number().min(0).max(1),
    beatConfidence: z.number().min(0).max(1),
    isVocal: z.boolean(),
    timestamp: z.number().min(0)
  }).optional(),
  musicInfo: z.object({
    track: z.string().optional(),
    artist: z.string().optional(),
    genre: z.string().optional(),
    album: z.string().optional()
  }).optional(),
  dynamicMode: z.boolean().optional(),
  styles: z.array(z.string().max(50)).max(20).optional(),
  artists: z.array(z.string().max(50)).max(20).optional(),
  skipLimits: z.boolean().optional()
});

// Preferences update validation
export const preferencesSchema = z.object({
  sessionId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\-_]+$/),
  styles: z.array(z.string().max(50)).max(20),
  artists: z.array(z.string().max(50)).max(20),
  dynamicMode: z.boolean()
});

// Vote submission validation
export const voteSchema = z.object({
  sessionId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\-_]+$/),
  artPrompt: z.string().min(1).max(2000),
  vote: z.number().int().min(-1).max(1).refine(v => v !== 0, {
    message: "Vote must be 1 or -1"
  }),
  audioCharacteristics: z.string().optional()
});

// Music identification validation
export const identifyMusicSchema = z.object({
  // Raw audio body is handled separately
  format: z.enum(['wav', 'mp3', 'ogg', 'flac']).optional()
});

// Payment intent validation
export const paymentIntentSchema = z.object({
  amount: z.number().int().positive().max(999999), // Max $9,999.99
  tier: z.enum(['premium', 'ultimate', 'enthusiast', 'business_basic', 'business_premium'])
});

// Telemetry event validation
export const telemetryEventSchema = z.object({
  sessionId: z.string().min(1).max(100),
  events: z.array(z.object({
    event: z.string().max(100),
    category: z.string().max(50),
    timestamp: z.number(),
    severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
    metrics: z.record(z.any()).optional()
  })).max(100) // Limit batch size
});

// Catalogue bridge validation
export const catalogueBridgeSchema = z.object({
  sessionId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\-_]+$/),
  currentStyles: z.array(z.string()).optional(),
  targetStyles: z.array(z.string()).optional(),
  orientation: z.enum(['portrait', 'landscape', 'square']).optional()
});

// Impression tracking validation
export const impressionSchema = z.object({
  sessionId: z.string().min(1).max(100),
  artworkId: z.string().uuid(),
  timestamp: z.number().optional()
});

// Batch impressions validation
export const batchImpressionsSchema = z.object({
  sessionId: z.string().min(1).max(100),
  artworkIds: z.array(z.string().uuid()).max(50) // Limit batch size
});

// Style transition validation
export const styleTransitionSchema = z.object({
  sessionId: z.string().min(1).max(100),
  fromStyles: z.array(z.string().max(50)).max(20),
  toStyles: z.array(z.string().max(50)).max(20),
  audioAnalysis: z.object({
    lowEnergy: z.number().min(0).max(1),
    midEnergy: z.number().min(0).max(1),
    highEnergy: z.number().min(0).max(1)
  }).optional()
});

// Vision analysis validation
export const visionAnalysisSchema = z.object({
  imageUrl: z.string().url().max(2000),
  analysisType: z.enum(['motifs', 'saliency', 'quality', 'all']).optional()
});

// Gallery toggle validation
export const galleryToggleSchema = z.object({
  artId: z.string().uuid()
});

// Admin tier update validation
export const adminTierUpdateSchema = z.object({
  userId: z.string().min(1).max(100),
  tier: z.enum(['free', 'premium', 'ultimate', 'enthusiast', 'business_basic', 'business_premium'])
});

// Test force breaker validation
export const forceBreakerSchema = z.object({
  durationMs: z.number().int().min(0).max(3600000).optional() // Max 1 hour
});

// Next artwork request validation
export const nextArtworkSchema = z.object({
  sessionId: z.string().min(1).max(100),
  currentArtworkId: z.string().uuid().optional(),
  styles: z.array(z.string()).optional(),
  artists: z.array(z.string()).optional()
});

// Client telemetry validation
export const clientTelemetrySchema = z.object({
  events: z.array(z.object({
    type: z.string().max(100),
    data: z.record(z.any()).optional(),
    timestamp: z.number(),
    sessionId: z.string().optional()
  })).max(50)
});

// ============================================================================
// Sanitization Helpers
// ============================================================================

/**
 * Sanitize string to prevent XSS attacks
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize HTML content (more aggressive)
 */
export function sanitizeHtml(input: string): string {
  // Remove all HTML tags
  return input.replace(/<[^>]*>/g, '');
}

/**
 * Validate and sanitize URL
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Only allow http(s) protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    // Prevent javascript: and data: URLs
    if (url.includes('javascript:') || url.includes('data:')) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

// ============================================================================
// Export validation middleware for routes
// ============================================================================

export const validations = {
  generateArt: validateBody(generateArtSchema),
  preferences: validateBody(preferencesSchema),
  vote: validateBody(voteSchema),
  paymentIntent: validateBody(paymentIntentSchema),
  telemetryEvent: validateBody(telemetryEventSchema),
  catalogueBridge: validateBody(catalogueBridgeSchema),
  impression: validateBody(impressionSchema),
  batchImpressions: validateBody(batchImpressionsSchema),
  styleTransition: validateBody(styleTransitionSchema),
  visionAnalysis: validateBody(visionAnalysisSchema),
  adminTierUpdate: validateBody(adminTierUpdateSchema),
  forceBreaker: validateBody(forceBreakerSchema),
  nextArtwork: validateBody(nextArtworkSchema),
  clientTelemetry: validateBody(clientTelemetrySchema)
};