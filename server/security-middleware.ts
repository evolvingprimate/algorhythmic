import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { Request, Response } from 'express';

// Custom key generator that includes user ID when available
// Uses the standard IP key generator as fallback for IPv6 support
const keyGenerator = (req: Request): string => {
  // Use user ID if authenticated, otherwise fall back to IP
  const userId = (req as any).user?.claims?.sub;
  if (userId) {
    return userId;
  }
  // Use the standard key generator for IP addresses (handles IPv6 properly)
  return req.ip || 'unknown';
};

// For auth endpoints, always use IP (no user context yet)
const authKeyGenerator = (req: Request): string => {
  return req.ip || 'unknown';
};

// Standard error message for rate limiting
const standardMessage = 'Too many requests from this IP/user, please try again later.';

// ============================================================================
// Rate Limiting Configurations
// ============================================================================

/**
 * Tiered rate limiting for public endpoints (artworks, galleries)
 * More permissive as these are browsing/viewing actions
 */
export const publicRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: standardMessage,
  standardHeaders: true,
  legacyHeaders: false,
  // Remove custom keyGenerator - use default IP-based
  skip: (req: Request) => {
    // Skip rate limiting for health checks and static assets
    return req.path === '/api/health' || req.path.startsWith('/public-objects/');
  }
});

/**
 * Strict rate limiting for generation endpoints (expensive operations)
 * Much lower limit to prevent abuse and control costs
 */
export const generationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Only 10 generation requests per window
  message: 'Generation limit exceeded. Please wait before creating more artwork.',
  standardHeaders: true,
  legacyHeaders: false,
  // Use default IP-based key generator
  skipSuccessfulRequests: false, // Count all requests, not just failures
});

/**
 * Authentication endpoint rate limiting
 * Balanced to prevent brute force while allowing legitimate use
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 auth attempts per window
  message: 'Too many authentication attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Use default IP-based key generator for auth
  skipSuccessfulRequests: true, // Only count failed attempts
});

/**
 * General API rate limit for all other endpoints
 * Fallback protection for endpoints without specific limits
 */
export const generalApiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per window
  message: standardMessage,
  standardHeaders: true,
  legacyHeaders: false,
  // Use default IP-based key generator
});

/**
 * Websocket connection rate limiting
 * Prevents connection flooding
 */
export const websocketRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // 5 websocket connections per minute
  message: 'Too many websocket connection attempts.',
  standardHeaders: true,
  legacyHeaders: false,
  // Use default IP-based key generator
});

/**
 * File upload rate limiting for object storage
 * Very strict to prevent storage abuse
 */
export const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: 'Upload limit exceeded. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Use default IP-based key generator
});

// ============================================================================
// Helmet Security Configuration
// ============================================================================

/**
 * Comprehensive helmet configuration with Content Security Policy
 */
export const helmetConfig = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // unsafe-eval needed for Vite in dev
      styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for Tailwind
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "*.googleapis.com",
        "*.openai.com", // For DALL-E images
        "*.fal.ai", // For Fal.ai images
        "https:", // Allow all HTTPS images (for generated content)
      ],
      connectSrc: [
        "'self'",
        "ws:",
        "wss:",
        "*.openai.com",
        "*.fal.ai",
        "*.stripe.com",
        "*.googleapis.com",
      ],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'", "*.stripe.com"], // For Stripe payment iframe
      workerSrc: ["'self'", "blob:"], // For web workers
      childSrc: ["'self'", "blob:"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    reportOnly: false,
  },
  // Disable cross-origin embedder policy for compatibility
  crossOriginEmbedderPolicy: false,
  // Enable HSTS in production
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
  // Other helmet defaults are good
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
  ieNoOpen: true,
  dnsPrefetchControl: { allow: true },
  frameguard: { action: 'deny' },
  permittedCrossDomainPolicies: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

// ============================================================================
// CORS Configuration
// ============================================================================

/**
 * CORS configuration for API
 */
export const corsConfig = cors({
  origin: (origin, callback) => {
    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // In production, whitelist specific origins
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'https://algorhythmic.repl.co',
      'https://replit.com',
      'https://*.replit.dev',
      'https://*.repl.co',
    ];

    // Allow requests with no origin (e.g., mobile apps, Postman)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin matches any allowed pattern
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        // Handle wildcard domains
        const pattern = allowed.replace('*', '.*');
        return new RegExp(pattern).test(origin);
      }
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Test-Service-Token', // For E2E tests
  ],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400, // 24 hours
});

// ============================================================================
// Request Size Limits
// ============================================================================

/**
 * JSON body size limit configuration
 */
export const jsonBodyLimit = '10mb'; // Reasonable limit for JSON payloads

/**
 * URL-encoded body size limit configuration
 */
export const urlEncodedLimit = '10mb';

/**
 * File upload size limit (for future use with object storage)
 */
export const fileUploadLimit = '50mb';

// ============================================================================
// Security Middleware Bundle
// ============================================================================

/**
 * Apply all security middleware in the correct order
 */
export function applySecurityMiddleware(app: any) {
  // 1. Helmet should be first (sets security headers)
  app.use(helmetConfig);

  // 2. CORS configuration
  app.use(corsConfig);

  // 3. Trust proxy for accurate IP addresses (needed for rate limiting)
  app.set('trust proxy', true);

  // 4. Apply general rate limit to all routes
  app.use('/api/', generalApiRateLimit);

  // Note: Specific rate limits will be applied to individual routes
  console.log('✅ Security middleware applied: Helmet, CORS, Rate Limiting');
}

// ============================================================================
// Route-Specific Rate Limit Application Helper
// ============================================================================

/**
 * Helper to apply rate limits to specific route patterns
 */
export function applyRouteRateLimits(app: any) {
  // Public endpoints (viewing artworks, galleries)
  app.use('/api/artworks/*', publicRateLimit);
  app.use('/api/galleries/*', publicRateLimit);
  app.use('/api/styles/*', publicRateLimit);
  
  // Generation endpoints (expensive operations)
  app.use('/api/generate/*', generationRateLimit);
  app.use('/api/artwork/generate', generationRateLimit);
  app.use('/api/test/generate', generationRateLimit);
  
  // Authentication endpoints
  app.use('/api/auth/*', authRateLimit);
  app.use('/api/login', authRateLimit);
  app.use('/api/signup', authRateLimit);
  app.use('/api/forgot-password', authRateLimit);
  
  // Upload endpoints (when implemented)
  app.use('/api/upload/*', uploadRateLimit);
  app.use('/api/storage/*', uploadRateLimit);

  console.log('✅ Route-specific rate limits applied');
}

// ============================================================================
// Export Security Utils
// ============================================================================

export const securityUtils = {
  /**
   * Sanitize user input to prevent XSS
   */
  sanitizeInput: (input: string): string => {
    if (!input) return '';
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },

  /**
   * Validate UUID format
   */
  isValidUUID: (uuid: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  },

  /**
   * Validate URL format
   */
  isValidUrl: (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Redact sensitive data from logs
   */
  redactSensitive: (obj: any): any => {
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'api_key', 'authorization'];
    const redacted = { ...obj };
    
    for (const key of Object.keys(redacted)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        redacted[key] = '[REDACTED]';
      } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key] = securityUtils.redactSensitive(redacted[key]);
      }
    }
    
    return redacted;
  },
};