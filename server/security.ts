/**
 * Security Configuration and Middleware
 * Implements defense-in-depth security measures for the application
 */

import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { validationResult, body, query, param } from 'express-validator';
import type { Express, Request, Response, NextFunction } from 'express';
import { telemetryService } from './telemetry-service';

// ============================================================================
// CORS Configuration
// ============================================================================

/**
 * Configure CORS with specific allowed origins (no wildcards)
 * Security Fix: Prevents unauthorized cross-origin requests
 */
export function configureCORS() {
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [
        'https://algorhythmic.replit.app', // Your production domain
        'https://algorhythmic.repl.co',    // Alternative Replit domain
        'https://algorhythmic.com'         // Custom domain if you have one
      ]
    : [
        'http://localhost:5000',
        'http://localhost:5001',
        'http://127.0.0.1:5000',
        'http://127.0.0.1:5001',
        'http://0.0.0.0:5000',
        // Add dynamic Replit dev domains (these are used in development)
        'https://d6f2bcfd-82fb-47d2-a3d2-b741edbaedf2-00-13de5xcz1t08i.janeway.replit.dev',
        'https://d6f2bcfd-82fb-47d2-a3d2-b741edbaedf2-00-13de5xcz1t08i.pike.replit.dev',
        'https://d6f2bcfd-82fb-47d2-a3d2-b741edbaedf2.replit.dev'
      ];

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) {
        return callback(null, true);
      }
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[SECURITY] CORS rejection for origin: ${origin}`);
        telemetryService.recordEvent({
          event: 'cors.blocked',
          category: 'security',
          severity: 'warning',
          metrics: { origin }
        });
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Test-Service-Token'],
    preflightContinue: false,
    optionsSuccessStatus: 204
  });
}

// ============================================================================
// Helmet Security Headers
// ============================================================================

/**
 * Configure Helmet for comprehensive security headers
 * Implements CSP, HSTS, and other protective headers
 */
export function configureHelmet() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Needed for React styles
        scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for React scripts
        imgSrc: [
          "'self'", 
          "data:", 
          "https:", 
          "blob:",
          "https://oaidalleapiprodscus.blob.core.windows.net", // DALL-E images
          "https://fal.media"  // fal.ai images
        ],
        connectSrc: [
          "'self'", 
          "wss:", 
          "https://api.openai.com",
          "https://fal.run",
          "https://api.stripe.com"
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'self'", "https://checkout.stripe.com"]
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    xssFilter: true,
    noSniff: true,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Configure rate limiting for API endpoints
 * Different limits for different types of endpoints
 */
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[SECURITY] Rate limit exceeded for IP: ${req.ip}`);
    telemetryService.recordEvent({
      event: 'rate_limit.exceeded',
      category: 'security',
      severity: 'warning',
      metrics: { ip: req.ip, path: req.path }
    });
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: 900 // seconds
    });
  }
});

export const generationRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit each IP to 10 generation requests per 5 minutes
  message: 'Too many generation requests, please slow down.',
  skipSuccessfulRequests: false
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 auth attempts per 15 minutes
  skipSuccessfulRequests: false
});

// ============================================================================
// SSRF Protection
// ============================================================================

/**
 * URL Validation and SSRF Protection
 * Ensures only whitelisted external API endpoints are accessible
 */
const ALLOWED_EXTERNAL_HOSTS = [
  'api.openai.com',
  'oaidalleapiprodscus.blob.core.windows.net', // DALL-E CDN
  'fal.run',
  'fal.media',
  'api.stripe.com',
  'checkout.stripe.com'
];

/**
 * Validate URL for SSRF protection
 * @param url URL to validate
 * @returns true if URL is safe, false otherwise
 */
export function isUrlSafe(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    
    // Block local/internal addresses
    const hostname = parsedUrl.hostname.toLowerCase();
    
    // Block localhost and private IPs
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.') ||
      hostname.includes('internal') ||
      hostname.endsWith('.local')
    ) {
      console.error(`[SECURITY] SSRF attempt blocked - internal address: ${hostname}`);
      return false;
    }
    
    // Only allow HTTPS for external requests
    if (parsedUrl.protocol !== 'https:') {
      console.error(`[SECURITY] SSRF attempt blocked - non-HTTPS protocol: ${parsedUrl.protocol}`);
      return false;
    }
    
    // Check against allowlist
    const isAllowed = ALLOWED_EXTERNAL_HOSTS.some(allowed => 
      hostname === allowed || hostname.endsWith(`.${allowed}`)
    );
    
    if (!isAllowed) {
      console.error(`[SECURITY] SSRF attempt blocked - unauthorized host: ${hostname}`);
      telemetryService.recordEvent({
        event: 'ssrf.blocked',
        category: 'security',
        severity: 'error',
        metrics: { hostname, url: url.substring(0, 100) }
      });
    }
    
    return isAllowed;
  } catch (error) {
    console.error(`[SECURITY] Invalid URL provided: ${url}`);
    return false;
  }
}

/**
 * Middleware to validate external URLs in request body
 */
export function validateExternalUrl(field: string) {
  return body(field)
    .optional()
    .isURL({ protocols: ['https'], require_protocol: true })
    .custom((value) => {
      if (value && !isUrlSafe(value)) {
        throw new Error('URL is not allowed for security reasons');
      }
      return true;
    });
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Generic validation error handler
 */
export function handleValidationErrors(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.warn(`[SECURITY] Validation failed:`, errors.array());
    telemetryService.recordEvent({
      event: 'validation.failed',
      category: 'security',
      severity: 'warning',
      metrics: { 
        path: req.path,
        errors: errors.array().map(e => e.msg).join(', ')
      }
    });
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }
  next();
}

/**
 * Sanitize and validate common input patterns
 */
export const validators = {
  sessionId: body('sessionId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .matches(/^[a-zA-Z0-9\-_]+$/)
    .withMessage('Invalid session ID format'),
    
  userId: body('userId')
    .isString()
    .isLength({ min: 1, max: 100 })
    .matches(/^[a-zA-Z0-9\-_]+$/)
    .withMessage('Invalid user ID format'),
    
  artId: param('id')
    .isUUID()
    .withMessage('Invalid art ID format'),
    
  styles: body('styles')
    .isArray({ max: 20 })
    .withMessage('Styles must be an array with max 20 items')
    .custom((styles) => {
      return styles.every((s: any) => 
        typeof s === 'string' && 
        s.length <= 50 &&
        /^[a-zA-Z0-9\s\-_]+$/.test(s)
      );
    })
    .withMessage('Invalid style format'),
    
  artists: body('artists')
    .isArray({ max: 20 })
    .withMessage('Artists must be an array with max 20 items')
    .custom((artists) => {
      return artists.every((a: any) => 
        typeof a === 'string' && 
        a.length <= 50 &&
        /^[a-zA-Z0-9\s\-_]+$/.test(a)
      );
    })
    .withMessage('Invalid artist format'),
    
  prompt: body('prompt')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .matches(/^[^<>]+$/) // No HTML tags
    .withMessage('Invalid prompt format')
};

// ============================================================================
// Security Event Logging
// ============================================================================

/**
 * Log security events for monitoring
 */
export function logSecurityEvent(
  event: string, 
  severity: 'info' | 'warning' | 'error',
  details: Record<string, any>
) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    severity,
    ...details
  };
  
  console.log(`[SECURITY-${severity.toUpperCase()}]`, JSON.stringify(logEntry));
  
  // Also send to telemetry service for tracking
  telemetryService.recordEvent({
    event,
    category: 'security',
    severity,
    metrics: details
  });
}

// ============================================================================
// Apply All Security Middleware
// ============================================================================

/**
 * Apply all security middleware to Express app
 */
export function applySecurity(app: Express) {
  // Apply security headers first
  app.use(configureHelmet());
  
  // Apply CORS
  app.use(configureCORS());
  
  // Apply general rate limiting
  app.use('/api/', generalRateLimit);
  
  // Apply specific rate limiting to sensitive endpoints
  app.use('/api/generate', generationRateLimit);
  app.use('/api/auth', authRateLimit);
  
  // Log all security middleware applied
  console.log('[SECURITY] All security middleware applied successfully');
  logSecurityEvent('security.initialized', 'info', {
    cors: 'configured',
    helmet: 'configured',
    rateLimiting: 'configured',
    ssrfProtection: 'enabled'
  });
}