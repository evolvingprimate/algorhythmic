import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { raw } from "express";
import Stripe from "stripe";
import { storage } from "./storage";
import { generateArtPrompt, generateArtImage, queueController, generationHealthService, recoveryManager, queueService, poolMonitor } from "./bootstrap";
import { identifyMusic } from "./music-service";
import { insertArtVoteSchema, insertArtPreferenceSchema, type AudioAnalysis, type MusicIdentification, telemetryEvents } from "@shared/schema";
import { and, sql } from "drizzle-orm";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { ObjectStorageService } from "./objectStorage";
import { generateWithFallback, resolveAutoMode, buildContextualPrompt } from "./generation/fallbackOrchestrator";
import { createDefaultAudioAnalysis } from "./generation/audioAnalyzer";
import { findBestCatalogMatch, type CatalogMatchRequest } from "./generation/catalogMatcher";
import { recentlyServedCache, makeRecentKey } from "./recently-served-cache";
import { idempotencyCache, IdempotencyCache } from './idempotency-cache';
import { wsSequence, WS_MESSAGE_TYPES } from "./websocket-sequence";
import { telemetryService } from "./telemetry-service";
import { validators, handleValidationErrors, validateExternalUrl } from "./security";
import { body, validationResult } from "express-validator";
import { validations } from "./validation-middleware";
import { initializeHealthMonitor, getHealthMonitor } from "./health-monitor";

// Initialize Stripe only if keys are available (optional for MVP)
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-10-29.clover",
  });
} else {
  console.warn('Stripe not configured - payment features will be unavailable');
}

// ============================================================================
// Test-only auth bypass middleware (gated behind non-production env)
// ============================================================================
const testAuthBypass = (req: any, res: any, next: any) => {
  // Only allow in development/test environments
  if (process.env.NODE_ENV === 'production') {
    console.log('[TestAuthBypass] Skipping - production mode');
    return next();
  }
  
  // Check for TEST_SERVICE_TOKEN header
  const testToken = req.headers['x-test-service-token'];
  const validToken = process.env.TEST_SERVICE_TOKEN || 'test-e2e-bypass-token-dev-only';
  
  console.log('[TestAuthBypass] Checking auth bypass:', {
    hasTestToken: !!testToken,
    tokenMatches: testToken === validToken,
    validToken: validToken.slice(0, 10) + '...',
    receivedToken: testToken ? testToken.slice(0, 10) + '...' : 'none',
    nodeEnv: process.env.NODE_ENV
  });
  
  if (testToken && testToken === validToken) {
    // Bypass auth - create minimal mock user
    const userId = `test-user-${testToken.slice(0, 8)}`;
    req.user = {
      claims: {
        sub: userId,
        email: 'test@e2e.local'
      }
    };
    console.log('[TestAuthBypass] ✓ Auth bypassed, mockUser:', userId);
    return next();
  }
  
  console.log('[TestAuthBypass] No valid test token, continuing to normal auth');
  // No test token, continue to normal auth
  next();
};

export async function registerRoutes(app: Express): Promise<Server> {
  // ============================================================================
  // TASK FIX: Bootstrap runtime guard - Detect future shadowing
  // ============================================================================
  
  if (typeof (recentlyServedCache as any).getRecentIds !== 'function') {
    throw new Error('[FATAL] recentlyServedCache wiring error: getRecentIds missing (variable shadowing detected)');
  }
  console.log('[Bootstrap] ✓ recentlyServedCache integrity verified');
  
  // Cache-Control headers for HTML to prevent stale bundle issues
  app.use((req, res, next) => {
    // Detect HTML requests via Accept header (works for SPA routes + deep links)
    const acceptsHtml = req.headers.accept?.includes('text/html');
    if (acceptsHtml) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
    next();
  });

  // Setup Replit Auth
  await setupAuth(app);

  // Initialize health monitor
  const healthMonitor = initializeHealthMonitor(storage);

  // ============================================================================
  // Health Check Endpoints (Public - no authentication required)
  // ============================================================================

  // Basic health check endpoint
  app.get('/api/health', (req, res) => {
    const health = healthMonitor.getBasicHealth();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // Readiness check - verifies all dependencies are ready
  app.get('/api/ready', async (req, res) => {
    try {
      const readiness = await healthMonitor.getReadinessStatus();
      const statusCode = readiness.status === 'ready' ? 200 : 503;
      res.status(statusCode).json(readiness);
    } catch (error) {
      console.error('[Health] Readiness check failed:', error);
      res.status(503).json({
        status: 'not_ready',
        checks: {},
        timestamp: new Date().toISOString(),
        error: 'Failed to check readiness',
      });
    }
  });

  // Liveness probe - simple check for container orchestration
  app.get('/api/live', (req, res) => {
    const liveness = healthMonitor.getLivenessStatus();
    if (liveness.alive) {
      res.status(200).send('OK');
    } else {
      res.status(503).send('Service Unavailable');
    }
  });

  // Metrics endpoint - service performance and statistics
  app.get('/api/metrics', async (req, res) => {
    try {
      const metrics = await healthMonitor.getMetrics();
      res.json(metrics);
    } catch (error) {
      console.error('[Health] Metrics collection failed:', error);
      res.status(500).json({
        error: 'Failed to collect metrics',
      });
    }
  });

  // Public object storage serving endpoint
  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    const objectStorageService = new ObjectStorageService();
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Auth endpoints
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Daily usage tracking endpoints
  app.get('/api/usage/check', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const usageCheck = await storage.checkDailyLimit(userId);
      res.json(usageCheck);
    } catch (error) {
      console.error("Error checking usage limit:", error);
      res.status(500).json({ message: "Failed to check usage limit" });
    }
  });

  app.get('/api/usage/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const today = new Date().toISOString().split('T')[0];
      const usage = await storage.getDailyUsage(userId, today);
      const limit = await storage.getUserDailyLimit(userId);
      
      res.json({
        count: usage?.generationCount || 0,
        limit,
        remaining: limit - (usage?.generationCount || 0),
        date: today,
      });
    } catch (error) {
      console.error("Error fetching usage stats:", error);
      res.status(500).json({ message: "Failed to fetch usage stats" });
    }
  });

  // Admin endpoint to update user subscription tier
  // For MVP: Admin authorization via direct database update
  // Production: This endpoint is disabled. Admins should update tiers directly in database
  app.post('/api/admin/update-tier', isAuthenticated, async (req: any, res) => {
    try {
      // For MVP, this endpoint is documentation only
      // In practice, admins should run: UPDATE users SET subscription_tier = 'premium' WHERE id = 'user_id';
      return res.status(501).json({ 
        message: "For MVP, tier updates must be performed directly in the database. Use: UPDATE users SET subscription_tier = 'desired_tier' WHERE id = 'user_id';",
        validTiers: ['free', 'premium', 'ultimate', 'enthusiast', 'business_basic', 'business_premium']
      });
    } catch (error: any) {
      console.error("Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================================
  // Circuit Breaker Test Endpoints (Development/Testing Only)
  // ============================================================================

  // Test endpoint to force circuit breaker open
  app.post('/api/test/force-breaker-open', async (req: any, res) => {
    try {
      // Check if testing is allowed
      if (process.env.NODE_ENV === 'production' && 
          req.headers['x-test-service-token'] !== process.env.TEST_SERVICE_TOKEN) {
        return res.status(403).json({ message: "Test endpoints disabled in production" });
      }

      const { durationMs } = req.body;
      const previousState = generationHealthService.forceOpen(durationMs);
      const newStatus = generationHealthService.getDetailedStatus();

      // Record telemetry
      telemetryService.recordEvent({
        event: 'test.breaker_forced_open',
        category: 'test',
        severity: 'warning',
        metrics: {
          previous_state: previousState,
          new_state: newStatus.state,
          duration_ms: durationMs || 300000
        }
      });

      console.log('[Test API] Forced circuit breaker open', { previousState, newState: newStatus.state });

      res.json({
        success: true,
        previousState,
        currentState: newStatus.state,
        status: newStatus
      });
    } catch (error: any) {
      console.error("Error forcing breaker open:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Test endpoint to reset circuit breaker to closed
  app.post('/api/test/force-breaker-closed', async (req: any, res) => {
    try {
      // Check if testing is allowed
      if (process.env.NODE_ENV === 'production' && 
          req.headers['x-test-service-token'] !== process.env.TEST_SERVICE_TOKEN) {
        return res.status(403).json({ message: "Test endpoints disabled in production" });
      }

      const previousState = generationHealthService.forceClosed();
      const newStatus = generationHealthService.getDetailedStatus();

      // Record telemetry
      telemetryService.recordEvent({
        event: 'test.breaker_reset',
        category: 'test',
        severity: 'info',
        metrics: {
          previous_state: previousState,
          new_state: newStatus.state
        }
      });

      console.log('[Test API] Reset circuit breaker to closed', { previousState, newState: newStatus.state });

      res.json({
        success: true,
        previousState,
        currentState: newStatus.state,
        status: newStatus
      });
    } catch (error: any) {
      console.error("Error resetting breaker:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Test endpoint to get circuit breaker status
  app.get('/api/test/breaker-status', async (req: any, res) => {
    try {
      // Check if testing is allowed
      if (process.env.NODE_ENV === 'production' && 
          req.headers['x-test-service-token'] !== process.env.TEST_SERVICE_TOKEN) {
        return res.status(403).json({ message: "Test endpoints disabled in production" });
      }

      const status = generationHealthService.getDetailedStatus();
      res.json(status);
    } catch (error: any) {
      console.error("Error getting breaker status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Test generation endpoint (bypasses auth for circuit breaker testing)
  app.post('/api/test/generate', async (req: any, res) => {
    try {
      // Check if testing is allowed - ONLY non-production
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ 
          message: "Test endpoint disabled in production",
          status: 'error' 
        });
      }

      console.log('[Test Generate] Starting test generation request');
      
      const { sessionId, audioAnalysis, preferences } = req.body;
      
      // Use test session ID if not provided
      const testSessionId = sessionId || `test-session-${Date.now()}`;
      const testUserId = `test-user-${Date.now()}`;
      
      // Get queue metrics for the Queue Controller
      const queueMetrics = await storage.getQueueMetrics(testSessionId);
      
      // Prepare metrics for the Queue Controller
      const metrics = {
        queueSize: queueMetrics.freshCount,
        targetSize: queueController.TARGET_FRAMES,
        minSize: queueController.MIN_FRAMES,
        maxSize: queueController.MAX_FRAMES,
        generationRate: queueMetrics.generationRate,
        consumptionRate: queueMetrics.consumptionRate
      };
      
      // Process tick and get current state
      const state = queueController.tick(metrics);
      
      // Get detailed generation decision
      const decision = queueController.getGenerationDecision();
      const batchSize = queueController.getRecommendedBatchSize();
      
      console.log('[Test Generate] Queue Controller Decision:', {
        shouldGenerate: decision.shouldGenerate,
        reason: decision.reason,
        batchSize,
        state
      });
      
      // Check if generation is denied by circuit breaker - TRIGGER FALLBACK
      if (!decision.shouldGenerate && (decision.reason === 'breaker_open' || decision.reason === 'breaker_half_open')) {
        console.log('[Test Generate] Circuit breaker triggered fallback:', decision.reason);
        
        try {
          // Import fallback service for emergency frame retrieval
          const { resolveEmergencyFallback } = await import('./fallback-service');
          
          // Trigger 3-tier fallback cascade
          const fallbackResult = await resolveEmergencyFallback(
            storage,
            testSessionId,
            testUserId,
            {
              styleTags: preferences?.styles || ['Abstract'],
              artistTags: preferences?.artists || [],
              minFrames: 1, // Only need 1 frame for test
              useCache: true
            }
          );
          
          console.log(`[Test Generate] Fallback SUCCESS - tier: ${fallbackResult.tier}`);
          
          // Return simplified response for test
          return res.json({
            status: 'success',
            source: 'catalog', 
            fallbackTier: fallbackResult.tier,
            breakerState: decision.reason,
            frames: fallbackResult.artworks.length,
            message: `Circuit breaker ${decision.reason} - using ${fallbackResult.tier} fallback`
          });
        } catch (fallbackError: any) {
          console.error('[Test Generate] Fallback failed, using procedural:', fallbackError);
          
          // Use procedural fallback as last resort
          const { generateProceduralBridge } = await import('./procedural-bridge');
          const proceduralData = generateProceduralBridge(preferences?.styles || ['abstract']);
          
          return res.json({
            status: 'success',
            source: 'procedural',
            fallbackTier: 'procedural',
            breakerState: decision.reason,
            procedural: proceduralData,
            message: `Circuit breaker ${decision.reason} - using procedural fallback`
          });
        }
      }
      
      // Check if we should generate (queue full case)  
      if (!decision.shouldGenerate) {
        return res.json({
          status: 'queue_full',
          source: 'none',
          breakerState: decision.reason,
          message: 'Queue is full, waiting for frames to be consumed'
        });
      }
      
      // Try fresh generation
      console.log('[Test Generate] Attempting fresh generation');
      
      try {
        // Generate art prompt using the proper flow
        const promptResult = await generateArtPrompt({
          audioAnalysis: audioAnalysis || createDefaultAudioAnalysis(),
          musicInfo: null,
          styles: preferences?.styles || ['Abstract'],
          artists: preferences?.artists || [],
          dynamicMode: preferences?.dynamicMode || false,
          previousVotes: []
        });
        
        // Generate image using DALL-E
        const imageUrl = await generateArtImage(promptResult.prompt);
        
        if (imageUrl) {
          console.log('[Test Generate] Fresh generation SUCCESS');
          
          // Store the generated artwork
          const artSession = await storage.createArtSession({
            sessionId: testSessionId,
            userId: testUserId,
            imageUrl,
            prompt: promptResult.prompt,
            dnaVector: promptResult.dnaVector ? JSON.stringify(promptResult.dnaVector) : null,
            audioFeatures: audioAnalysis ? JSON.stringify(audioAnalysis) : null,
            generationExplanation: promptResult.explanation || null,
            styles: preferences?.styles || ['Abstract'],
            artists: preferences?.artists || []
          });
          
          return res.json({
            status: 'success',
            source: 'fresh',
            breakerState: 'closed',
            imageUrl,
            prompt: promptResult.prompt,
            message: 'Fresh generation successful'
          });
        } else {
          throw new Error('No image URL returned from generation');
        }
      } catch (genError: any) {
        console.error('[Test Generate] Fresh generation failed:', genError);
        
        // Try catalog fallback on generation failure
        try {
          const { resolveEmergencyFallback } = await import('./fallback-service');
          const fallbackResult = await resolveEmergencyFallback(
            storage,
            testSessionId,
            testUserId,
            {
              styleTags: preferences?.styles || ['Abstract'],
              artistTags: preferences?.artists || [],
              minFrames: 1,
              useCache: true
            }
          );
          
          return res.json({
            status: 'success',
            source: 'catalog',
            fallbackTier: fallbackResult.tier,
            breakerState: 'generation_failed',
            frames: fallbackResult.artworks.length,
            message: `Generation failed - using ${fallbackResult.tier} fallback`
          });
        } catch (fallbackError) {
          // Last resort - procedural
          const { generateProceduralBridge } = await import('./procedural-bridge');
          const proceduralData = generateProceduralBridge(preferences?.styles || ['abstract']);
          
          return res.json({
            status: 'success',
            source: 'procedural',
            fallbackTier: 'procedural',
            breakerState: 'all_failed',
            procedural: proceduralData,
            message: 'All generation methods failed - using procedural fallback'
          });
        }
      }
    } catch (error: any) {
      console.error('[Test Generate] Unexpected error:', error);
      res.status(500).json({ 
        status: 'error',
        message: error.message || 'Test generation failed',
        error: error.message 
      });
    }
  });

  // ============================================================================
  // Pool Monitoring Endpoints
  // ============================================================================

  // Get current pool metrics
  app.get('/api/monitoring/pool', isAuthenticated, async (req: any, res) => {
    try {
      const metrics = await poolMonitor.getMetrics();
      
      res.json({
        status: 'ok',
        metrics,
        config: {
          preGenerationThreshold: 0.85,
          criticalThreshold: 0.95,
          targetPoolSize: 10,
          minPoolSize: 2
        }
      });
    } catch (error: any) {
      console.error("Error getting pool metrics:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get session-specific pool state
  app.get('/api/monitoring/pool/session/:sessionId', isAuthenticated, async (req: any, res) => {
    try {
      const { sessionId } = req.params;
      const userId = req.user.claims.sub;
      
      // Get session state from pool monitor
      const sessionState = poolMonitor.getSessionState(sessionId);
      
      if (!sessionState) {
        // If no state exists, try to refresh it
        await poolMonitor.refreshSession(sessionId, userId);
        const newState = poolMonitor.getSessionState(sessionId);
        
        if (!newState) {
          return res.status(404).json({ 
            message: 'Session not found in pool monitor',
            sessionId 
          });
        }
        
        return res.json(newState);
      }
      
      res.json(sessionState);
    } catch (error: any) {
      console.error("Error getting session pool state:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Manually trigger pool assessment (for testing)
  app.post('/api/monitoring/pool/assess', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // Check if user is authorized (e.g., admin)
      // For now, allow all authenticated users in dev mode
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ message: 'Not authorized' });
      }
      
      // Get current metrics before assessment
      const beforeMetrics = await poolMonitor.getMetrics();
      
      // Manually trigger assessment (this is private, so we'll emit an event instead)
      poolMonitor.emit('manual-assessment');
      
      // Get metrics after assessment
      const afterMetrics = await poolMonitor.getMetrics();
      
      res.json({
        message: 'Pool assessment triggered',
        beforeMetrics,
        afterMetrics,
        timestamp: new Date().toISOString()
      });
      
      // Log the manual assessment
      telemetryService.recordEvent({
        event: 'pool_manual_assessment',
        category: 'pool',
        severity: 'info',
        metrics: {
          userId,
          coverage: afterMetrics.poolCoveragePercentage
        }
      });
    } catch (error: any) {
      console.error("Error triggering pool assessment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Force pre-generation (for testing)
  app.post('/api/monitoring/pool/pre-generate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { sessionId, count = 5, styles } = req.body;
      
      // Check if user is authorized (e.g., admin)
      // For now, allow all authenticated users in dev mode
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ message: 'Not authorized' });
      }
      
      if (!sessionId) {
        return res.status(400).json({ message: 'sessionId is required' });
      }
      
      // Enqueue pre-generation jobs
      const jobIds = await queueService.enqueuePreGenerationJob(
        userId,
        sessionId,
        styles || ['abstract', 'surrealism', 'impressionism'],
        count,
        'Manual trigger for testing'
      );
      
      res.json({
        message: 'Pre-generation jobs enqueued',
        jobIds,
        count,
        sessionId,
        timestamp: new Date().toISOString()
      });
      
      // Log the manual pre-generation
      telemetryService.recordEvent({
        event: 'pool_manual_pregeneration',
        category: 'pool',
        severity: 'info',
        metrics: {
          userId,
          sessionId,
          count,
          jobCount: jobIds.length
        }
      });
    } catch (error: any) {
      console.error("Error triggering pre-generation:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Resilience Monitoring Endpoint
  // ============================================================================

  // Comprehensive resilience monitoring endpoint
  app.get('/api/monitoring/resilience', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // Get circuit breaker status
      const breakerStatus = generationHealthService.getDetailedStatus();
      
      // Get recent generation attempts from telemetry
      const recentGenerations = await storage.getRecentGenerations(userId, 10);
      
      // Get fallback cascade metrics from storage
      const fallbackMetrics = await storage.getFallbackMetrics(userId);
      
      // Get queue controller status
      const queueState = queueController.getState();
      const queueDecision = queueController.getGenerationDecision();
      
      // Get recovery manager status  
      const recoveryStatus = recoveryManager.getStatus();
      
      // Compile comprehensive resilience status
      const resilienceStatus = {
        circuitBreaker: {
          state: breakerStatus.state,
          tokens: breakerStatus.tokenBucket,
          timeoutMs: breakerStatus.timeoutMs,
          openUntil: breakerStatus.openUntil,
          metrics: breakerStatus.metrics,
          slidingWindow: {
            size: breakerStatus.slidingWindowSize,
            failures: breakerStatus.slidingWindowFailures
          },
          recovery: breakerStatus.recoveryProgress
        },
        queueController: {
          state: queueState,
          decision: queueDecision,
          targetFrames: queueController.TARGET_FRAMES,
          minFrames: queueController.MIN_FRAMES,
          maxFrames: queueController.MAX_FRAMES
        },
        recoveryManager: {
          isRecovering: recoveryStatus.isRecovering,
          recoveryQueue: recoveryStatus.recoveryQueue,
          lastRecoveryAttempt: recoveryStatus.lastRecoveryAttempt
        },
        fallbackCascade: {
          catalogHits: fallbackMetrics?.catalogHits || 0,
          proceduralHits: fallbackMetrics?.proceduralHits || 0,
          totalFallbacks: fallbackMetrics?.totalFallbacks || 0,
          lastFallbackTier: fallbackMetrics?.lastTier || null,
          lastFallbackTime: fallbackMetrics?.lastFallbackTime || null
        },
        recentGenerations: recentGenerations.map(gen => ({
          id: gen.id,
          timestamp: gen.createdAt,
          status: gen.status,
          source: gen.metadata?.source || 'fresh',
          latencyMs: gen.metadata?.latencyMs || null,
          fallbackTier: gen.metadata?.fallbackTier || null,
          error: gen.metadata?.error || null
        })),
        timestamp: new Date().toISOString()
      };
      
      res.json(resilienceStatus);
    } catch (error: any) {
      console.error("Error getting resilience status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get or create user preferences
  app.get("/api/preferences/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const preferences = await storage.getPreferencesBySession(sessionId);
      res.json(preferences || { styles: [], artists: [] });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Save user preferences
  app.post("/api/preferences", validations.preferences, async (req, res) => {
    try {
      const validated = req.body; // Already validated by middleware
      const preferences = await storage.createOrUpdatePreferences(
        validated.sessionId,
        validated.styles || [],
        validated.artists || [],
        validated.dynamicMode || false
      );
      res.json(preferences);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============================================================================
  // Catalogue Bridge: Instant artwork display via cascading library search
  // ============================================================================
  
  app.post("/api/catalogue-bridge", testAuthBypass, isAuthenticated, validations.catalogueBridge, async (req: any, res) => {
    try {
      const { sessionId, styleTags = [], artistTags = [], orientation, limit = 2 } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ message: "sessionId is required" });
      }
      
      // Get userId from authenticated user
      const userId = req.user.claims.sub;
      
      // TASK FIX: Use composite key to prevent cross-endpoint/user collisions
      const cacheKey = makeRecentKey(userId, sessionId, 'bridge');
      
      // Get recently-served artwork IDs from cache (30s window)
      const excludeIds = recentlyServedCache.getRecentIds(cacheKey);
      
      console.log(`[Catalogue Bridge] User ${userId}, session ${sessionId}, styles: [${styleTags}], orientation: ${orientation}, excluding ${excludeIds.length} recent IDs`);
      
      // Call 4-tier cascading search: exact → related → global → procedural
      const result = await storage.getLibraryArtworkWithFallback(userId, {
        styleTags,
        artistTags,
        orientation,
        excludeIds,
        limit,
      });
      
      // Backend Telemetry: Fire-and-forget (non-blocking)
      (async () => {
        try {
          const raiSessionId = await storage.findOrCreateRaiSessionForClientSession(userId, sessionId);
          const metadata = JSON.stringify({
            tier: result.tier,
            latencyMs: result.latencyMs,
            styleTags,
            artistTags,
            artworkCount: result.artworks.length,
          });
          
          await storage.createTelemetryEvents([
            {
              sessionId: raiSessionId,
              userId,
              eventType: `catalogue_bridge.tier_${result.tier}`,
              eventData: metadata,
              audioFeatures: null,
              visualState: null,
            },
            {
              sessionId: raiSessionId,
              userId,
              eventType: 'catalogue_bridge.handoff_latency_ms',
              eventData: metadata,
              audioFeatures: null,
              visualState: null,
            },
          ]);
        } catch (telemetryError: any) {
          console.error('[Catalogue Bridge] Telemetry emission failed (non-blocking):', telemetryError.message);
        }
      })();
      
      // REMOVED: Don't mark as recently-served here - wait for render-ack
      // This prevents artwork from being filtered out before client can display it
      if (result.artworks.length > 0) {
        const artworkIds = result.artworks.map(art => art.id);
        console.log(`[Catalogue Bridge] Served ${result.artworks.length} artworks (tier: ${result.tier}, ${result.latencyMs}ms): [${artworkIds.join(', ')}]`);
      } else {
        console.log(`[Catalogue Bridge] No library artworks, using ${result.tier} tier (${result.latencyMs}ms)`);
      }
      
      res.json({
        artworks: result.artworks,
        tier: result.tier,
        latency: result.latencyMs, // Keep backend field name as latencyMs but expose as 'latency' per API contract
        proceduralData: result.proceduralData,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("Error in catalogue bridge:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================================
  // Render-Ack Impressions: Record impressions only when artwork is displayed
  // ============================================================================
  
  app.post("/api/impressions/rendered", isAuthenticated, validations.impression, async (req: any, res) => {
    try {
      const { artworkIds = [], source, sessionId } = req.body as { 
        artworkIds?: string[]; 
        source?: 'bridge' | 'fresh';
        sessionId?: string;
      };
      
      // Validation: check array exists
      if (!Array.isArray(artworkIds) || artworkIds.length === 0) {
        return res.status(400).json({ error: "artworkIds[] required" });
      }
      
      // Guardrails: max batch size (catalogue bridge returns 2, but allow buffer)
      const MAX_BATCH = 10;
      if (artworkIds.length > MAX_BATCH) {
        return res.status(413).json({ error: `Limit ${MAX_BATCH} ids per call` });
      }
      
      // Get userId from authenticated user
      const userId = req.user.claims.sub;
      
      // Deduplication and sanitization
      const ids = Array.from(new Set(artworkIds.map(String))).filter(Boolean);
      
      // Validate artwork IDs exist in global pool (security + prevent invalid IDs)
      const validIds = await storage.validateArtworkVisibility(userId, ids);
      const rejectedIds = ids.filter(id => !validIds.includes(id));
      
      // Log rejected IDs for monitoring
      if (rejectedIds.length > 0) {
        console.log(`[Render-Ack] Rejected ${rejectedIds.length} invalid IDs:`, rejectedIds);
      }
      
      // Record impressions for valid IDs only
      const recordedCount = validIds.length > 0
        ? await storage.recordRenderedImpressions(userId, validIds, source)
        : 0;
      
      // CRITICAL FIX: Mark artworks as recently-served ONLY after client confirms render
      // This prevents fresh artwork from being filtered out before display
      if (validIds.length > 0 && sessionId) {
        // FIX: Use same composite key format as /api/artworks/next endpoint
        const cacheKey = makeRecentKey(userId, sessionId, 'next');
        recentlyServedCache.markRecent(cacheKey, validIds);
        console.log(`[Render-Ack] Marked ${validIds.length} artworks as recently-served AFTER render confirmation for session ${sessionId}`);
      }
      
      console.log(`[Render-Ack] Recorded ${recordedCount} impressions (source: ${source || 'unknown'}) for user ${userId}`);
      
      res.json({
        recordedCount,
        rejectedIds,
        source: source || 'unknown',
      });
    } catch (error: any) {
      console.error("Error in render-ack impressions:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================================
  // Health Check Endpoint - Comprehensive system monitoring
  // ============================================================================
  
  app.get('/api/health', async (req, res) => {
    const verbose = req.query.verbose === 'true';
    const authToken = req.headers['x-health-token'];
    
    // Protect verbose mode with token (optional for MVP)
    const allowVerbose = verbose && (
      process.env.NODE_ENV !== 'production' ||
      authToken === process.env.HEALTH_CHECK_TOKEN
    );
    
    const healthChecks = {
      http: { status: 'ok', message: 'HTTP server responding' },
      database: { status: 'unknown', message: 'Not checked' },
      websocket: { status: 'unknown', message: 'Not checked', clients: 0 },
      queue: { status: 'unknown', message: 'Not checked' },
      circuitBreaker: { status: 'unknown', message: 'Not checked', state: '' },
      timestamp: new Date().toISOString()
    };
    
    let overallStatus: 'ok' | 'degraded' | 'down' = 'ok';
    
    // 1. Check database connectivity
    try {
      await storage.ping(); // Assumes storage.ping() method exists
      healthChecks.database.status = 'ok';
      healthChecks.database.message = 'Database connection active';
    } catch (error) {
      healthChecks.database.status = 'down';
      healthChecks.database.message = 'Database connection failed';
      overallStatus = 'down';
      console.error('[Health] Database check failed:', error);
    }
    
    // 2. Check WebSocket server status
    try {
      const wsClientCount = wsServer.clients?.size || 0;
      healthChecks.websocket.status = 'ok';
      healthChecks.websocket.message = `WebSocket server active`;
      healthChecks.websocket.clients = wsClientCount;
      
      if (allowVerbose) {
        // Include client states if verbose
        const clientStates = Array.from(wsServer.clients || []).map((client: any) => ({
          readyState: client.readyState,
          bufferedAmount: client.bufferedAmount
        }));
        (healthChecks.websocket as any).clientStates = clientStates;
      }
    } catch (error) {
      healthChecks.websocket.status = 'degraded';
      healthChecks.websocket.message = 'WebSocket server check failed';
      if (overallStatus === 'ok') overallStatus = 'degraded';
    }
    
    // 3. Check queue service health
    try {
      const queueHealth = queueController.getHealth();
      healthChecks.queue.status = queueHealth.isHealthy ? 'ok' : 'degraded';
      healthChecks.queue.message = `Queue: ${queueHealth.queueSize} items, ${queueHealth.activeJobs} active`;
      
      if (allowVerbose) {
        (healthChecks.queue as any).metrics = queueHealth;
      }
      
      if (!queueHealth.isHealthy && overallStatus === 'ok') {
        overallStatus = 'degraded';
      }
    } catch (error) {
      healthChecks.queue.status = 'degraded';
      healthChecks.queue.message = 'Queue service check failed';
      if (overallStatus === 'ok') overallStatus = 'degraded';
    }
    
    // 4. Check circuit breaker state
    try {
      const breakerStatus = generationHealthService.getDetailedStatus();
      healthChecks.circuitBreaker.status = 
        breakerStatus.state === 'open' ? 'degraded' : 'ok';
      healthChecks.circuitBreaker.message = `Circuit breaker: ${breakerStatus.state}`;
      healthChecks.circuitBreaker.state = breakerStatus.state;
      
      if (allowVerbose) {
        (healthChecks.circuitBreaker as any).details = breakerStatus;
      }
      
      if (breakerStatus.state === 'open' && overallStatus === 'ok') {
        overallStatus = 'degraded';
      }
    } catch (error) {
      healthChecks.circuitBreaker.status = 'unknown';
      healthChecks.circuitBreaker.message = 'Circuit breaker check failed';
    }
    
    // 5. Check pool monitor health
    try {
      const poolStats = poolMonitor.getPoolStats();
      const poolHealth = {
        status: poolStats.poolDepth > 0 ? 'ok' : 'degraded',
        message: `Pool depth: ${poolStats.poolDepth}, coverage: ${poolStats.styleCoverage}%`,
        depth: poolStats.poolDepth,
        coverage: poolStats.styleCoverage
      };
      (healthChecks as any).pool = poolHealth;
      
      if (poolStats.poolDepth === 0) {
        overallStatus = 'degraded';
      }
    } catch (error) {
      // Pool monitor is optional
    }
    
    const response = {
      status: overallStatus,
      components: healthChecks,
      timestamp: healthChecks.timestamp
    };
    
    // Record health check telemetry if degraded/down
    if (overallStatus !== 'ok') {
      telemetryService.recordEvent({
        event: 'health.check_failed',
        category: 'health',
        severity: overallStatus === 'down' ? 'error' : 'warning',
        metrics: {
          overall_status: overallStatus,
          failed_components: Object.entries(healthChecks)
            .filter(([_, check]: [string, any]) => check.status !== 'ok')
            .map(([name]) => name)
        }
      });
    }
    
    // Return appropriate status code
    const statusCode = overallStatus === 'down' ? 503 : 200;
    res.status(statusCode).json(response);
  });

  // ============================================================================
  // PHASE 2: RAI Telemetry API Routes
  // ============================================================================

  // Start a new RAI session
  app.post('/api/telemetry/session/start', async (req, res) => {
    try {
      const { userId, artworkId, genomeId } = req.body;
      const session = await storage.createRaiSession(userId, artworkId, genomeId);
      res.json({ sessionId: session.id });
    } catch (error: any) {
      console.error("Error starting RAI session:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // End a RAI session
  app.post('/api/telemetry/session/end', async (req, res) => {
    try {
      const { sessionId } = req.body;
      await storage.endRaiSession(sessionId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error ending RAI session:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Batch insert telemetry events
  app.post('/api/telemetry/events', async (req, res) => {
    try {
      const { events, sessionId, userId } = req.body;
      if (!Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ message: "Events array is required" });
      }
      
      // Get session ID from request body or generate a new one
      const session = sessionId || req.body.session_id || 'anonymous-' + Date.now();
      
      // Ensure the RAI session exists (create if needed)
      try {
        // Try to find or create the session
        const raiSessionId = await storage.findOrCreateRaiSessionForClientSession(
          userId || 'anonymous',
          session
        );
        
        // Validate and normalize each event before inserting
        const validatedEvents = events.map(event => ({
          ...event,
          sessionId: raiSessionId, // Use the RAI session ID
          eventType: event.eventType || event.type || 'unknown', // Map type to eventType
          // Convert timestamp string to Date object if needed
          timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
          eventData: event.eventData ? 
            (typeof event.eventData === 'string' ? event.eventData : JSON.stringify(event.eventData)) : 
            '{}' // Default to empty JSON object if missing
        }));
        
        await storage.createTelemetryEvents(validatedEvents);
        res.json({ success: true, count: events.length });
      } catch (sessionError: any) {
        // If session creation fails, try without session constraint
        console.warn("Session creation failed, attempting sessionless insert:", sessionError);
        
        // For now, return error since DB has foreign key constraint
        res.status(400).json({ 
          message: "Session required for telemetry events. Please create a session first via /api/telemetry/session/start",
          error: sessionError.message 
        });
      }
    } catch (error: any) {
      console.error("Error inserting telemetry events:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/telemetry/catalogue-bridge/stats - Aggregated catalogue bridge performance metrics
  app.get("/api/telemetry/catalogue-bridge/stats", async (req, res) => {
    try {
      const hoursBack = parseInt(req.query.hours as string) || 24;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
      
      // Query catalogue bridge telemetry events (database-level filtering)
      const events = await storage.getCatalogueBridgeTelemetry(since);
      
      // Parse and aggregate data
      const tierCounts = { exact: 0, related: 0, global: 0, procedural: 0 };
      const latencies: number[] = [];
      const tierLatencies: Record<string, number[]> = {
        exact: [],
        related: [],
        global: [],
        procedural: []
      };
      
      for (const event of events) {
        try {
          const data = JSON.parse(event.eventData);
          
          // Extract tier from different event types
          let tier: string | null = null;
          let latencyMs: number | null = null;
          
          if (event.eventType === 'catalogue_bridge.handoff_latency_ms') {
            tier = data.tier;
            latencyMs = data.latencyMs;
          } else if (event.eventType === 'catalogue_bridge.fallback_tier_1') {
            tier = 'exact';
            latencyMs = data.latencyMs;
          } else if (event.eventType === 'catalogue_bridge.fallback_tier_2') {
            tier = 'related';
            latencyMs = data.latencyMs;
          } else if (event.eventType === 'catalogue_bridge.fallback_tier_3') {
            tier = 'global';
            latencyMs = data.latencyMs;
          } else if (event.eventType === 'catalogue_bridge.fallback_tier_4') {
            tier = 'procedural';
            latencyMs = data.latencyMs;
          }
          
          if (tier && latencyMs !== null) {
            // Normalize tier name
            const normalizedTier = tier.toLowerCase() === 'exact' || tier === '1' ? 'exact'
              : tier.toLowerCase() === 'related' || tier === '2' ? 'related'
              : tier.toLowerCase() === 'global' || tier === '3' ? 'global'
              : 'procedural';
            
            tierCounts[normalizedTier]++;
            latencies.push(latencyMs);
            tierLatencies[normalizedTier].push(latencyMs);
          }
        } catch (e) {
          // Skip malformed events
          continue;
        }
      }
      
      // Calculate percentiles
      const calculatePercentile = (arr: number[], p: number) => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil((sorted.length * p) / 100) - 1;
        return sorted[Math.max(0, index)];
      };
      
      const totalRequests = latencies.length;
      const tierDistribution = {
        exact: totalRequests > 0 ? (tierCounts.exact / totalRequests) * 100 : 0,
        related: totalRequests > 0 ? (tierCounts.related / totalRequests) * 100 : 0,
        global: totalRequests > 0 ? (tierCounts.global / totalRequests) * 100 : 0,
        procedural: totalRequests > 0 ? (tierCounts.procedural / totalRequests) * 100 : 0,
      };
      
      const latencyStats = {
        avg: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
        p50: calculatePercentile(latencies, 50),
        p95: calculatePercentile(latencies, 95),
        p99: calculatePercentile(latencies, 99),
        min: latencies.length > 0 ? Math.min(...latencies) : 0,
        max: latencies.length > 0 ? Math.max(...latencies) : 0,
      };
      
      // Per-tier latency stats
      const tierStats = Object.entries(tierLatencies).map(([tier, lats]) => ({
        tier,
        count: lats.length,
        avgLatency: lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : 0,
        p50: calculatePercentile(lats, 50),
        p95: calculatePercentile(lats, 95),
      }));
      
      // Alert: Tier-3/4 usage >20%
      const tier34Percentage = tierDistribution.global + tierDistribution.procedural;
      const alert = tier34Percentage > 20 ? {
        level: 'warning',
        message: `Tier-3/4 usage at ${tier34Percentage.toFixed(1)}% (threshold: 20%)`,
        recommendation: 'Consider expanding library coverage for frequently requested styles'
      } : null;
      
      // Compute histogram buckets from individual event latencies
      const histogramBuckets = [
        { label: '0-50ms', min: 0, max: 50, count: 0 },
        { label: '50-100ms', min: 50, max: 100, count: 0 },
        { label: '100-200ms', min: 100, max: 200, count: 0 },
        { label: '200-400ms', min: 200, max: 400, count: 0 },
        { label: '400ms+', min: 400, max: Infinity, count: 0 },
      ];
      
      for (const latency of latencies) {
        for (const bucket of histogramBuckets) {
          if (latency >= bucket.min && latency < bucket.max) {
            bucket.count++;
            break;
          }
        }
      }
      
      res.json({
        period: {
          since: since.toISOString(),
          hoursBack
        },
        summary: {
          totalRequests,
          tierDistribution,
          latencyStats
        },
        tierStats,
        histogramBuckets,
        alert,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('[Telemetry API] Error:', error);
      res.status(500).json({ message: "Failed to fetch telemetry stats: " + error.message });
    }
  });

  // PHASE 2: Trend Engine - Analyze telemetry and return trend weights
  app.get('/api/trends/analyze', async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const lookbackMinutes = parseInt(req.query.lookbackMinutes as string || '60');
      
      // Query telemetry events from database (Phase 2: simple counts, Phase 3: ML analysis)
      let climaxCount = 0;
      let visionCount = 0;
      let controlAdjustmentCount = 0;
      
      try {
        // Count events by type in lookback window (basic aggregation)
        const cutoffTime = new Date(Date.now() - lookbackMinutes * 60 * 1000);
        const events = await storage.getTelemetryEventsSince(cutoffTime);
        
        climaxCount = events.filter((e: any) => e.eventType === 'climax_detected').length;
        visionCount = events.filter((e: any) => e.eventType === 'vision_analyzed').length;
        controlAdjustmentCount = events.filter((e: any) => e.eventType === 'control_adjustment').length;
      } catch (dbError) {
        console.warn('[TrendEngine] Database query failed, using defaults:', dbError);
      }
      
      // Aggregate telemetry into trend weights
      const trends = {
        particles: {
          spawnRate: { mean: 1.0, variance: 0.1, adjustmentCount: controlAdjustmentCount },
          velocity: { mean: 1.0, variance: 0.1, adjustmentCount: 0 },
          size: { mean: 1.0, variance: 0.1, adjustmentCount: 0 },
        },
        warp: {
          elasticity: { mean: 1.0, variance: 0.1, adjustmentCount: 0 },
          radius: { mean: 1.0, variance: 0.1, adjustmentCount: 0 },
        },
        mixer: {
          saturation: { mean: 1.0, variance: 0.1, adjustmentCount: 0 },
          brightness: { mean: 1.0, variance: 0.1, adjustmentCount: 0 },
          contrast: { mean: 1.0, variance: 0.1, adjustmentCount: 0 },
        },
        climaxFrequency: climaxCount,
        visionSuccessRate: visionCount > 0 ? 1.0 : 0.0,
      };

      // Return aggregated trends (Phase 2: basic counts, Phase 3: ML predictions)
      res.json({ 
        success: true, 
        trends,
        timestamp: new Date().toISOString(),
        lookbackMinutes,
        eventCounts: { climaxCount, visionCount, controlAdjustmentCount },
      });
    } catch (error) {
      console.error('Error analyzing trends:', error);
      res.status(500).json({ error: 'Failed to analyze trends' });
    }
  });

  // ============================================================================
  // Job Status Endpoint
  // ============================================================================
  app.get("/api/jobs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const jobId = req.params.id;
      const userId = req.user.claims.sub;
      
      const job = await storage.getGenerationJob(jobId);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      // Ensure user can only see their own jobs
      if (job.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: job.result,
        errorMessage: job.errorMessage,
        retryCount: job.retryCount,
      });
    } catch (error: any) {
      console.error("Error fetching job:", error);
      res.status(500).json({ message: "Failed to fetch job status" });
    }
  });

  // Generate art based on audio analysis - REQUIRES AUTHENTICATION (now queued)
  app.post("/api/generate-art", isAuthenticated, validations.generateArt, async (req: any, res) => {
    // Circuit breaker timeout guard
    let timeoutId: NodeJS.Timeout | undefined;
    let isTimedOut = false;
    
    try {
      const { sessionId, audioAnalysis, musicInfo, preferences, previousVotes, idempotencyKey } = req.body;

      // Get userId from authenticated user
      const userId = req.user.claims.sub;
      
      // Check circuit breaker state before attempting generation
      const breakerState = generationHealthService.getBreakerState();
      if (breakerState === 'open') {
        console.log('[Generate] Circuit breaker is open - returning service unavailable');
        telemetryService.recordEvent({
          event: 'generation_rejected_breaker_open',
          category: 'generation',
          severity: 'warning',
          userId,
          sessionId
        });
        return res.status(503).json({ 
          message: "Generation service is temporarily unavailable. Please try again later.",
          retryAfter: 30
        });
      }
      
      // Get adaptive timeout from circuit breaker
      const timeout = generationHealthService.getTimeout();
      console.log(`[Generate] Using adaptive timeout: ${timeout}ms for generation (breaker state: ${breakerState})`);
      
      // Set timeout to cancel generation if it takes too long
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        console.log(`[Generate] Timeout reached (${timeout}ms) - marking as timed out`);
        
        // Record timeout with telemetry
        telemetryService.recordEvent({
          event: 'generation_timeout',
          category: 'generation',
          severity: 'error',
          userId,
          sessionId,
          metrics: {
            timeout_ms: timeout,
            breaker_state: breakerState
          }
        });
        
        // Report failure to circuit breaker
        generationHealthService.recordFailure();
        
        if (!res.headersSent) {
          res.status(504).json({ 
            message: "Generation request timed out. Please try again.",
            retryAfter: 5
          });
        }
      }, timeout);
      
      // IDEMPOTENCY: Check for duplicate requests
      if (idempotencyKey) {
        const cacheKey = IdempotencyCache.makeKey(userId, idempotencyKey);
        const cachedResponse = idempotencyCache.getResponse(cacheKey);
        
        if (cachedResponse) {
          console.log(`[IdempotencyKey] Returning cached response for key: ${idempotencyKey}`);
          
          // Clear timeout since we're returning cached response
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          
          return res.json(cachedResponse);
        }
        
        console.log(`[IdempotencyKey] No cached response for key: ${idempotencyKey}, proceeding with generation`);
      }

      // TEMPORARILY DISABLED: Check daily limit
      // const usageCheck = await storage.checkDailyLimit(userId);
      // if (!usageCheck.canGenerate) {
      //   return res.status(429).json({ 
      //     message: "Daily generation limit reached. Upgrade your plan for more generations.",
      //     count: usageCheck.count,
      //     limit: usageCheck.limit,
      //   });
      // }

      // NEW: Build GenerationContext using fallback system
      // Note: Frontend doesn't send audioBuffer, so we build context from what we have
      const music = musicInfo as MusicIdentification | null;
      const audio = audioAnalysis as AudioAnalysis | undefined;
      
      const stylePreferences = {
        styles: preferences?.styles || [],
        autoGenerate: preferences?.dynamicMode || false,
      };
      
      // Determine provenance tier based on data quality
      let provenance: 'MUSIC_ID' | 'AUDIO_ONLY' | 'STYLE_ONLY' = 'STYLE_ONLY';
      
      // IMPORTANT: Ensure audio analysis has all required fields, especially mood
      // Merge with defaults to prevent downstream crashes
      const defaultAudio = createDefaultAudioAnalysis();
      let finalAudio: AudioAnalysis = audio ? {
        ...defaultAudio,  // Start with defaults to ensure all fields exist
        ...audio,         // Override with provided values
        mood: audio.mood || defaultAudio.mood  // Ensure mood is never undefined
      } : defaultAudio;
      
      if (music) {
        // Tier 1: We have music identification
        provenance = 'MUSIC_ID';
      } else if (finalAudio && finalAudio.frequency > 0 && finalAudio.confidence !== undefined && finalAudio.confidence > 0.6) {
        // Tier 2: We have quality audio analysis (must have explicit confidence >0.6)
        provenance = 'AUDIO_ONLY';
      } else {
        // Tier 3: Fall back to style preferences only (no music ID + missing/low audio confidence)
        provenance = 'STYLE_ONLY';
        console.log('[ArtGeneration] ⚠️ STYLE_ONLY tier activated (no music ID, low/no/missing audio confidence)');
      }
      
      // Enhance Tier 3 with voting history if available
      let votingHistory;
      if (provenance === 'STYLE_ONLY' && sessionId) {
        try {
          const votes = await storage.getVotesBySession(sessionId);
          if (votes && votes.length > 0) {
            const upvoted = votes.filter(v => v.vote > 0).map(v => v.artPrompt);
            const downvoted = votes.filter(v => v.vote < 0).map(v => v.artPrompt);
            votingHistory = { upvoted, downvoted };
            console.log('[ArtGeneration] Enhanced STYLE_ONLY with voting history:', upvoted.length, 'upvoted');
          }
        } catch (e) {
          console.warn('[ArtGeneration] Could not fetch voting history:', e);
        }
      }
      
      const context = {
        provenance,
        musicInfo: music || undefined,
        audioAnalysis: finalAudio,
        stylePreferences: {
          ...stylePreferences,
          votingHistory,
        },
        timestamp: new Date(),
      };
      
      // Log telemetry
      console.log(`[Telemetry] Generation provenance: ${provenance}`, {
        hadMusicInfo: !!music,
        hadAudioAnalysis: !!audio,
        audioConfidence: audio?.confidence,
        usedVotingHistory: !!votingHistory,
        userId,
      });

      // NEW: Resolve styles using auto-mode logic from fallback system
      const resolvedStyles = resolveAutoMode(context);
      console.log(`[ArtGeneration] Resolved styles (${provenance}):`, resolvedStyles);

      // NEW: Build context-aware prompt prefix
      const contextPrompt = buildContextualPrompt(context, resolvedStyles);
      console.log(`[ArtGeneration] Context prompt:`, contextPrompt.substring(0, 100));

      // Validate we have audio analysis
      if (!finalAudio || typeof finalAudio.frequency !== 'number') {
        return res.status(400).json({ message: "Invalid audio analysis data" });
      }

      // Generate art prompt using OpenAI (enhanced with fallback-resolved styles)
      const result = await generateArtPrompt({
        audioAnalysis: finalAudio,
        musicInfo: music,
        styles: resolvedStyles, // NEW: Uses fallback-resolved styles
        artists: preferences?.artists || [],
        dynamicMode: preferences?.dynamicMode || false,
        previousVotes: previousVotes || [],
      });

      // Check if we've timed out before starting generation
      if (isTimedOut) {
        console.log('[Generate] Aborting - request already timed out');
        return;
      }
      
      // NEW: Enqueue job for async DALL-E processing
      console.log('[ArtGeneration] 🚀 Enqueueing generation job for async processing...');
      
      // Prepare job payload with all necessary context
      const jobPayload = {
        sessionId,
        prompt: result.prompt,
        dnaVector: result.dnaVector,
        explanation: result.explanation,
        audioFeatures: finalAudio,
        musicInfo: music,
        styles: resolvedStyles,
        artists: preferences?.artists || [],
        provenance,
      };
      
      // Enqueue the job with appropriate priority (higher for premium users)
      const userTier = await storage.getUserSubscriptionTier(userId);
      const priority = userTier === 'ultimate' ? 10 : (userTier === 'premium' ? 5 : 0);
      
      const job = await queueService.enqueueJob(userId, jobPayload, priority);
      console.log('[ArtGeneration] ✅ Job enqueued:', job.id, 'with priority:', priority);
      
      // Increment daily usage (user is always authenticated here)
      const today = new Date().toISOString().split('T')[0];
      await storage.incrementDailyUsage(userId, today);
      console.log('[ArtGeneration] ✅ Daily usage incremented');
      
      // Return job ID for tracking
      const response = {
        jobId: job.id,
        status: 'queued',
        prompt: result.prompt,
        explanation: result.explanation,
        musicInfo: music,
        message: 'Your artwork is being generated. You will be notified when complete.',
      };
      
      // IDEMPOTENCY: Cache successful response
      if (idempotencyKey) {
        const cacheKey = IdempotencyCache.makeKey(userId, idempotencyKey);
        // Cache for 5 minutes to handle retries
        idempotencyCache.setResponse(cacheKey, response, 300);
        console.log(`[IdempotencyKey] Cached response for key: ${idempotencyKey}`);
      }

      // Clear timeout on successful completion
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      res.json(response);
    } catch (error: any) {
      // Clear timeout on error
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      // Don't send duplicate response if we already timed out
      if (isTimedOut) {
        console.log('[Generate] Request already timed out, not sending error response');
        return;
      }
      
      console.error("Error generating art:", error);
      
      // Report failure to circuit breaker (unless it was a client error)
      if (!error.message?.includes('400') && !error.message?.includes('401')) {
        generationHealthService.recordFailure();
      }
      
      res.status(500).json({ message: "Failed to generate artwork: " + error.message });
    }
  });

  // Identify music from audio blob - use raw middleware to accept binary data
  app.post("/api/identify-music", raw({ type: 'audio/*', limit: '10mb' }), async (req, res) => {
    try {
      if (!req.body || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ message: "Invalid audio data" });
      }

      const musicInfo = await identifyMusic(req.body);
      res.json({ musicInfo });
    } catch (error: any) {
      console.error("Error identifying music:", error);
      res.status(500).json({ message: "Failed to identify music: " + error.message });
    }
  });

  // Submit vote
  app.post("/api/vote", validations.vote, async (req, res) => {
    try {
      const validated = req.body; // Already validated by middleware
      const vote = await storage.createVote(validated);
      res.json(vote);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Get voting history
  app.get("/api/votes/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const votes = await storage.getVotesBySession(sessionId);
      res.json(votes);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get session history
  app.get("/api/sessions/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const sessions = await storage.getSessionHistory(sessionId, limit);
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PHASE 1 CATALOG: Style transition endpoint for instant bridge switching
  // Returns best catalog match or procedural fallback for seamless style transitions
  app.post("/api/style-transition", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { sessionId, styleTags, audioMeta, trackId } = req.body;

      const startTime = Date.now();

      // Validate required fields
      if (!sessionId || !styleTags || !Array.isArray(styleTags)) {
        return res.status(400).json({ 
          message: "Missing required fields: sessionId, styleTags (array)" 
        });
      }

      console.log(`[StyleTransition] User ${userId} switching to tags: ${styleTags.join(', ')}`);

      // Fetch catalog candidates (unseen artworks with tag overlap, limit 200)
      const candidates = await storage.getCatalogCandidates(userId, styleTags, 200);
      
      console.log(`[StyleTransition] Found ${candidates.length} catalog candidates`);

      // Build catalog match request
      const matchRequest: CatalogMatchRequest = {
        userId,
        styleTags,
        audioMeta,
        trackId
      };

      // Find best match using in-memory cosine similarity on DNA vectors
      const matchResult = findBestCatalogMatch(candidates, matchRequest);

      const latency = Date.now() - startTime;

      if (matchResult.type === 'catalog' && matchResult.artwork) {
        // Record bridge impression (sets bridgeAt timestamp)
        await storage.recordImpression(userId, matchResult.artwork.id, true);

        console.log(`[StyleTransition] ✅ Catalog match found (score: ${matchResult.score?.toFixed(2)}) - latency: ${latency}ms`);

        // Telemetry: catalog bridge rendered
        console.log(`[Telemetry] Bridge rendered: { type: 'catalog', latency: ${latency}, score: ${matchResult.score}, artworkId: '${matchResult.artwork.id}' }`);

        return res.json({
          bridge: {
            type: 'catalog',
            artwork: matchResult.artwork,
            score: matchResult.score
          },
          latency
        });
      } else {
        console.log(`[StyleTransition] ⚠️ No catalog match - using procedural bridge - latency: ${latency}ms`);

        // Telemetry: procedural bridge fallback
        console.log(`[Telemetry] Bridge rendered: { type: 'procedural', latency: ${latency}, candidateCount: ${candidates.length} }`);

        return res.json({
          bridge: {
            type: 'procedural'
          },
          latency
        });
      }
    } catch (error: any) {
      console.error('[StyleTransition] Error:', error);
      res.status(500).json({ message: "Failed to find style transition: " + error.message });
    }
  });

  // Gallery endpoints (protected)
  app.get("/api/gallery", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const savedArt = await storage.getUserSavedArt(userId);
      res.json(savedArt);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // TASK FIX: Removed shadowing Map variable that was causing catalogue bridge to crash
  // Now using the imported singleton recentlyServedCache with composite keys

  // GET endpoint with PRIORITY QUEUE: fresh → unseen
  // Fresh artwork (this session's last 15 min) shown FIRST, storage pool is fallback only
  app.get("/api/artworks/next", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sessionId = req.query.sessionId as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      
      // Default styles for users without preferences (popular, accessible styles)
      const DEFAULT_STYLES = ['abstract', 'surrealism', 'landscape', 'digital-art'];
      
      // TASK FIX: Use composite key to prevent cross-endpoint/user collisions
      const cacheKey = sessionId ? makeRecentKey(userId, sessionId, 'next') : null;
      const recentlyServedIds = cacheKey ? new Set(recentlyServedCache.getRecentIds(cacheKey)) : new Set<string>();
      
      // BUG FIX: Fetch user preferences (session-scoped first, fallback to user-level)
      const preferences = sessionId 
        ? await storage.getPreferencesBySession(sessionId)
        : null;
      
      const user = await storage.getUser(userId);
      
      // Compute onboarding state server-side (source of truth)
      const hasPreferences = preferences?.styles && preferences.styles.length > 0;
      const onboardingState: 'complete' | 'incomplete' = hasPreferences ? 'complete' : 'incomplete';
      
      // Use default styles if no preferences exist (progressive enhancement)
      const styleTags = hasPreferences ? preferences.styles : DEFAULT_STYLES;
      const artistTags = preferences?.artists || [];
      const orientation = user?.preferredOrientation || undefined;
      
      console.log('[Style Filtering] /api/artworks/next filters:', {
        userId,
        sessionId,
        styleTags,
        artistTags,
        orientation,
        recentlyServedCount: recentlyServedIds.size,
        source: preferences ? 'session' : 'user-profile'
      });
      
      // PRIORITY 1: Fresh AI-generated artwork (this session, last 15 minutes, not yet viewed)
      let freshArtworks = sessionId 
        ? await storage.getFreshArtworks(sessionId, userId, limit)
        : [];
      
      // BUG FIX: Apply orientation filter to fresh queue (hard filter)
      if (orientation && freshArtworks.length > 0) {
        const beforeFilter = freshArtworks.length;
        freshArtworks = freshArtworks.filter(art => art.orientation === orientation);
        console.log(`[Style Filtering] Fresh queue orientation filter: ${beforeFilter} → ${freshArtworks.length}`);
      }
      
      // BUG FIX #1: Filter out recently-served IDs from fresh queue
      const beforeServedFilter = freshArtworks.length;
      freshArtworks = freshArtworks.filter(art => !recentlyServedIds.has(art.id));
      if (beforeServedFilter > freshArtworks.length) {
        console.log(`[ServedCache] Filtered ${beforeServedFilter - freshArtworks.length} recently-served from fresh queue`);
      }
      
      // PRIORITY 2: Unseen storage pool (fallback only when fresh queue empty)
      // BUG FIX: Pass preference filters to getUnseenArtworks
      let combinedArtworks = [...freshArtworks];
      if (combinedArtworks.length < limit) {
        const remainingLimit = limit - combinedArtworks.length;
        const unseenArtworks = await storage.getUnseenArtworks(userId, {
          limit: remainingLimit,
          orientation,
          styleTags,
          artistTags,
        });
        
        // BUG FIX #1: Filter out recently-served IDs from storage pool
        const beforeStorageServedFilter = unseenArtworks.length;
        const filteredUnseen = unseenArtworks.filter(art => !recentlyServedIds.has(art.id));
        if (beforeStorageServedFilter > filteredUnseen.length) {
          console.log(`[ServedCache] Filtered ${beforeStorageServedFilter - filteredUnseen.length} recently-served from storage pool`);
        }
        
        // Deduplicate IDs (fresh queue takes precedence)
        const existingIds = new Set(combinedArtworks.map(a => a.id));
        const uniqueUnseen = filteredUnseen.filter(a => !existingIds.has(a.id));
        
        combinedArtworks.push(...uniqueUnseen);
      }
      
      const needsGeneration = combinedArtworks.length < 5;
      
      // REMOVED: Don't mark as recently-served here - wait for render-ack
      // This fixes fresh artwork being filtered out before display
      
      // BUG FIX #2: Enhanced telemetry with validator metrics
      const telemetry = {
        userId,
        sessionId,
        filters: { orientation, styleTags, artistTags },
        fresh_count_raw: freshArtworks.length + (beforeServedFilter - freshArtworks.length),
        fresh_count_after_filter: freshArtworks.length,
        storage_count_returned: combinedArtworks.length - freshArtworks.length,
        total_returned: combinedArtworks.length,
        recently_served_filtered: recentlyServedIds.size,
        needs_generation: needsGeneration,
        pool_exhausted: combinedArtworks.length === 0,
      };
      
      console.log(`[Style Filtering] Result breakdown:`, telemetry);
      
      // EMERGENCY FALLBACK: NEVER return <2 frames - morphEngine needs at least 2 to prevent glitches
      if (telemetry.pool_exhausted || combinedArtworks.length < 2) {
        console.error(`[ALERT] 🚨 Pool exhausted or insufficient frames (<2) for user ${userId} session ${sessionId} - EMERGENCY FALLBACK ACTIVATED`);
        
        try {
          // Use clean 3-tier fallback service
          const { resolveEmergencyFallback, emitFallbackTelemetry } = await import('./fallback-service');
          const fallbackResult = await resolveEmergencyFallback(
            storage,
            sessionId,
            userId,
            {
              orientation,
              styleTags,
              artistTags,
              recentlyServedIds,
              minFrames: 2 // MorphEngine requirement
            }
          );
          
          combinedArtworks = fallbackResult.artworks;
          (telemetry as any).fallback_tier = fallbackResult.tier;
          (telemetry as any).cache_bypassed = fallbackResult.bypassedCache;
          telemetry.total_returned = combinedArtworks.length;
          telemetry.pool_exhausted = false; // We found frames
          
          // Emit telemetry about fallback usage
          emitFallbackTelemetry(fallbackResult, userId, sessionId);
          
          console.log(`[EmergencyFallback] Resolved via ${fallbackResult.tier} tier: ${combinedArtworks.length} frames`);
        } catch (fallbackError: any) {
          console.error(`[EmergencyFallback] Failed to resolve fallback:`, fallbackError);
          // If all tiers fail, return empty array to trigger generation
          combinedArtworks = [];
          telemetry.pool_exhausted = true;
          (telemetry as any).fallback_failed = true;
        }
      }
      
      // Set no-cache headers to prevent stale data
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      // Determine tier for telemetry
      let tier = 'fresh'; // Default if we have fresh artworks
      if (freshArtworks.length === 0 && combinedArtworks.length > 0) {
        tier = 'storage';
      } else if ((telemetry as any).fallback_tier) {
        tier = (telemetry as any).fallback_tier;
      } else if (combinedArtworks.length === 0) {
        tier = 'empty';
      }
      
      res.json({
        artworks: combinedArtworks,
        poolSize: combinedArtworks.length,
        freshCount: freshArtworks.length,
        storageCount: combinedArtworks.length - freshArtworks.length,
        needsGeneration,
        onboardingState, // Server-computed onboarding state
        tier, // Which cascade tier served the frames
        selectedStyles: styleTags, // Return actual styles being used (defaults or user prefs)
        telemetry, // BUG FIX #2: Include telemetry in response for client monitoring
      });
    } catch (error: any) {
      console.error('[Artworks GET] Error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Hybrid gen+retrieve endpoint - Real-time DALL-E generation based on audio context
  // NEW: Accepts optional audio context (music ID, features, DNA) for personalized generation
  // FALLBACK: Returns pool warm-start if no context provided (backward compatible)
  app.post("/api/artworks/next", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { audioContext, generateRealTime = false, limit = 20 } = req.body;
      
      // BACKWARD COMPATIBLE: Legacy behavior if no audio context
      if (!audioContext || !generateRealTime) {
        const unseenArtworks = await storage.getUnseenArtworks(userId, { limit });
        const needsGeneration = unseenArtworks.length < 5;
        
        console.log(`[Freshness] User ${userId} - Legacy mode - Unseen pool: ${unseenArtworks.length} artworks`);
        
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        return res.json({
          artworks: unseenArtworks,
          poolSize: unseenArtworks.length,
          needsGeneration,
          mode: 'pool-only',
        });
      }
      
      // NEW: Hybrid gen+retrieve flow
      console.log(`[Hybrid Gen] User ${userId} - Real-time generation with audio:`, 
        audioContext.musicId ? `Track: ${audioContext.musicId.title}` : 'No ID');
      
      // Step 1: Check daily limits before creating job
      const usageCheck = await storage.checkDailyLimit(userId);
      if (!usageCheck.canGenerate) {
        console.log(`[Hybrid Gen] User ${userId} hit daily limit - falling back to pool only`);
        const poolArtworks = await storage.getUnseenArtworks(userId, { limit: 1 });
        
        return res.json({
          warmStart: poolArtworks[0] || null,
          jobId: null,
          mode: 'pool-only-limit-reached',
          limitReached: true,
          poolSize: poolArtworks.length,
        });
      }
      
      // Step 2: Get user preferences for pool matching
      const sessionId = `session_${userId}_${Date.now()}`;
      const preferences = await storage.getPreferencesBySession(sessionId) || {
        styles: [],
        artists: [],
        dynamicMode: false,
      };
      
      // Step 3: Find warm-start candidate from pool using ImagePool service
      const { ImagePoolService } = await import('./services/imagePool');
      const poolService = new ImagePoolService();
      
      // Extract target DNA from audio context (if available)
      const targetDNA = audioContext.targetDNA || Array(50).fill(0.5);
      const targetMotifs = [...(preferences.styles || []), ...(preferences.artists || [])];
      
      const poolCandidates = await storage.getPoolCandidates(userId, 20, 35);
      
      // Convert ArtSession to PoolCandidate format (parse dnaVector from JSON string)
      const poolCandidatesFormatted = poolCandidates.map(art => ({
        id: art.id,
        imageUrl: art.imageUrl,
        prompt: art.prompt || '',
        dna: typeof art.dnaVector === 'string' 
          ? JSON.parse(art.dnaVector) 
          : (art.dnaVector || Array(50).fill(0.5)),
        motifs: art.motifs || [],
        qualityScore: art.qualityScore || 50,
        sessionId: art.sessionId,
        userId: art.userId,
        createdAt: art.createdAt,
        lastUsedAt: art.lastUsedAt,
      }));
      
      const bestMatch = await poolService.findBest(
        poolCandidatesFormatted,
        targetDNA,
        targetMotifs,
        { requireQuality: true, minQuality: 35 }
      );
      
      const warmStartMatch = bestMatch ? poolCandidates.find(a => a.id === bestMatch.artwork.id) : null;
      
      // Step 4: Create generation job (charges daily limit immediately)
      const generationJob = await storage.createGenerationJob({
        userId,
        audioContext: JSON.stringify(audioContext),
        warmStartArtworkId: warmStartMatch?.id || null,
        generatedArtworkId: null,
        status: 'pending',
        attemptCount: 0,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      });
      
      // Increment daily usage immediately (optimistic accounting with date)
      const today = new Date().toISOString().split('T')[0];
      await storage.incrementDailyUsage(userId, today);
      
      console.log(`[Hybrid Gen] Created job ${generationJob.id} - Warm-start: ${warmStartMatch?.id || 'none'}`);
      
      // Step 5: Return warm-start immediately (instant visual)
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      res.json({
        warmStart: warmStartMatch || null,
        jobId: generationJob.id,
        mode: 'hybrid-gen+retrieve',
        poolSize: poolCandidates.length,
      });
      
      // Step 6: Trigger async DALL-E generation (non-blocking)
      processGenerationJob(generationJob.id, userId, audioContext, preferences, wss).catch(err => {
        console.error(`[Hybrid Gen] Async worker failed for job ${generationJob.id}:`, err);
      });
      
    } catch (error: any) {
      console.error('[Hybrid Gen] Error in next artwork endpoint:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Mark artwork as viewed (record impression)
  app.post("/api/artworks/:artworkId/viewed", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { artworkId } = req.params;
      
      await storage.recordImpression(userId, artworkId);
      
      console.log(`[Freshness] Recorded impression - User: ${userId}, Artwork: ${artworkId}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[Freshness] Error recording impression:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Batch impression recording (for legacy artwork backfill + performance)
  app.post("/api/artworks/batch-impressions", isAuthenticated, validations.batchImpressions, async (req: any, res) => {
    const startTime = Date.now();
    
    try {
      const userId = req.user.claims.sub;
      const { artworkIds } = req.body as { artworkIds?: string[] };
      
      // Validation: check array exists
      if (!Array.isArray(artworkIds) || artworkIds.length === 0) {
        return res.status(400).json({ error: "artworkIds[] required" });
      }
      
      // Guardrails: max batch size
      const MAX_BATCH = 200;
      if (artworkIds.length > MAX_BATCH) {
        return res.status(413).json({ error: `Limit ${MAX_BATCH} ids per call` });
      }
      
      // Deduplication and sanitization
      const ids = Array.from(new Set(artworkIds.map(String))).filter(Boolean);
      
      // ⭐ NEW: Validate artwork IDs exist in global pool (security)
      const validIds = await storage.validateArtworkVisibility(userId, ids);
      const filtered = ids.length - validIds.length;
      
      // ⭐ NEW: Structured logging for security monitoring
      if (filtered > 0) {
        const invalidIds = ids.filter(id => !validIds.includes(id));
        console.log(JSON.stringify({
          event: 'batch_impressions_filtered',
          userId,
          attempted: ids.length,
          filtered,
          invalidIds: invalidIds.slice(0, 10), // Log first 10 invalid IDs for forensics
          timestamp: new Date().toISOString()
        }));
      }
      
      // Batch insert (only valid IDs)
      const recorded = validIds.length > 0 
        ? await storage.recordBatchImpressions(userId, validIds)
        : 0;
      
      const latencyMs = Date.now() - startTime;
      
      // ⭐ NEW: Enhanced response stats with sampling (10% for success, 100% for failures)
      const shouldLogSuccess = Math.random() < 0.1;
      if (shouldLogSuccess) {
        console.log(JSON.stringify({
          event: 'batch_impressions_success',
          userId,
          attempted: ids.length,
          recorded,
          filtered,
          latency_ms: latencyMs,
          timestamp: new Date().toISOString()
        }));
      }
      
      res.json({ 
        attempted: ids.length,
        recorded,
        filtered,
        ids: validIds,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('[Freshness] Error batch recording impressions:', error);
      res.status(500).json({ error: "Batch insert failed" });
    }
  });

  // Recent artworks endpoint (for display page morphing)
  // GLOBAL POOL: Returns artworks from all users for discovery and instant display
  app.get("/api/recent-artworks", isAuthenticated, async (req: any, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const recentArt = await storage.getRecentArt(limit);
      res.json(recentArt);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/gallery/:artId/toggle", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { artId } = req.params;
      const updated = await storage.toggleArtSaved(artId, userId);
      res.json(updated);
    } catch (error: any) {
      res.status(error.message === "Not authorized" ? 403 : 404).json({ message: error.message });
    }
  });

  app.delete("/api/gallery/:artId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { artId } = req.params;
      await storage.deleteArt(artId, userId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(error.message === "Not authorized" ? 403 : 404).json({ message: error.message });
    }
  });

  // Stripe payment intent for subscription
  app.post("/api/create-payment-intent", async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ 
        message: "Payment processing is not configured. Please contact support." 
      });
    }
    
    try {
      const { amount } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: "usd",
        metadata: {
          product: "Algorhythmic Premium Subscription",
        },
      });
      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating payment intent: " + error.message });
    }
  });

  // Vision API endpoint for GPT-4o Vision feature detection
  app.post("/api/vision/analyze", async (req, res) => {
    try {
      const { image, prompt } = req.body;
      
      if (!image || !prompt) {
        return res.status(400).json({ message: "Missing image or prompt" });
      }
      
      // Call OpenAI GPT-4o Vision API
      const OpenAI = await import("openai");
      const openai = new OpenAI.default({
        apiKey: process.env.OPENAI_API_KEY,
      });
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${image}`,
                  detail: "low", // Use low detail for cost efficiency
                },
              },
            ],
          },
        ],
        max_tokens: 500,
      });
      
      const analysis = response.choices[0]?.message?.content || "";
      
      res.json({ analysis });
    } catch (error: any) {
      console.error("Vision API error:", error);
      res.status(500).json({ message: "Vision analysis failed: " + error.message });
    }
  });

  // Health check is defined earlier in the file with comprehensive checks
  
  // Circuit breaker state endpoint - used by client for adaptive retry
  app.get("/api/health/circuit-breaker-state", (req, res) => {
    const state = generationHealthService.getBreakerState();
    const metrics = generationHealthService.getMetrics();
    const timeout = generationHealthService.getTimeout();
    const shouldAttempt = generationHealthService.shouldAttemptGeneration();
    
    res.json({
      state,
      shouldAttempt,
      timeout,
      metrics: {
        consecutiveFailures: metrics.consecutiveFailures,
        successRate: metrics.successRate,
        p50Latency: metrics.p50Latency,
        p95Latency: metrics.p95Latency,
        p99Latency: metrics.p99Latency,
        totalSuccesses: metrics.totalSuccesses,
        totalTimeouts: metrics.totalTimeouts,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Storage health monitoring endpoint
  app.get("/api/admin/storage-health", async (req, res) => {
    try {
      const stats = await storage.getStorageHealthStats();
      const recentMetrics = await storage.getStorageMetrics(20);
      
      res.json({
        timestamp: new Date().toISOString(),
        health: stats.successRate >= 95 ? "healthy" : stats.successRate >= 80 ? "degraded" : "critical",
        stats,
        recentMetrics,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching storage health: " + error.message });
    }
  });

  app.get("/api/admin/catalogue-health", async (req, res) => {
    try {
      const { CatalogueManager } = await import("./services/catalogue-manager");
      const { PostgresStorage } = await import("./storage");
      
      if (!(storage instanceof PostgresStorage)) {
        return res.status(503).json({ message: "Catalogue requires PostgreSQL database" });
      }
      
      const catalogueManager = new CatalogueManager(storage);
      const report = await catalogueManager.getHealthReport();
      
      res.json({
        timestamp: new Date().toISOString(),
        ...report,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching catalogue health: " + error.message });
    }
  });

  const httpServer = createServer(app);

  // WebSocket server for real-time audio coordination
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Connect WebSocket server to sequence manager for broadcasting
  wsSequence.setWebSocketServer(wss);

  /**
   * Helper: Extract motifs (keywords) from DALL-E prompt
   * Simple keyword extraction based on art terminology
   */
  function extractMotifsFromPrompt(prompt: string): string[] {
    const motifKeywords = [
      // Art styles
      'abstract', 'surreal', 'impressionist', 'expressionist', 'cubist', 'minimalist',
      'baroque', 'renaissance', 'modern', 'contemporary', 'pop art', 'street art',
      // Subjects
      'landscape', 'portrait', 'still life', 'figure', 'nature', 'urban', 'cosmic',
      'geometric', 'organic', 'floral', 'animal', 'human', 'architectural',
      // Moods/themes
      'vibrant', 'dark', 'moody', 'ethereal', 'dreamlike', 'energetic', 'calm',
      'chaotic', 'harmonious', 'melancholic', 'joyful', 'mysterious',
      // Techniques
      'watercolor', 'oil painting', 'digital', 'mixed media', 'collage', 'photographic',
    ];

    const lowerPrompt = prompt.toLowerCase();
    return motifKeywords.filter(keyword => lowerPrompt.includes(keyword));
  }

  /**
   * Async worker: Process generation job in background
   * 1. Generate GPT-4 prompt (with ACRCloud music context)
   * 2. Generate DALL-E 3 image
   * 3. Download and store image
   * 4. Update job status
   * 5. Emit WebSocket event
   */
  async function processGenerationJob(
    jobId: string,
    userId: string,
    audioContext: any,
    preferences: any,
    wss: WebSocketServer
  ): Promise<void> {
    console.log(`[Async Worker] Starting job ${jobId}`);
    
    try {
      // Update job status to processing
      await storage.updateGenerationJob(jobId, {
        status: 'processing',
        startedAt: new Date(),
        attemptCount: 1,
      });
      
      // Extract music context from ACRCloud (if available)
      const musicInfo = audioContext.musicId || null;
      const audioAnalysis = audioContext.features || {
        amplitude: 0.5,
        tempo: 120,
        bassEnergy: 0.5,
        spectralCentroid: 0.5,
        mood: 'neutral',
      };
      
      // Step 1: Generate prompt using GPT-4o Vision (correct signature)
      const promptResult = await generateArtPrompt({
        audioAnalysis,
        musicInfo,
        styles: preferences.styles || [],
        artists: preferences.artists || [],
        dynamicMode: preferences.dynamicMode || false,
        previousVotes: [], // Not needed for first-time generation
      });
      
      console.log(`[Async Worker] Generated prompt for job ${jobId}:`, promptResult.prompt.substring(0, 100));
      
      // Step 2: Generate DALL-E 3 image (returns string URL)
      const imageUrl = await generateArtImage(promptResult.prompt);
      
      console.log(`[Async Worker] DALL-E generated image for job ${jobId}`);
      
      // Step 3: Extract motifs from prompt (simple keyword extraction)
      const motifs = extractMotifsFromPrompt(promptResult.prompt);
      
      // Step 4: Store artwork in database (stringify dnaVector for storage)
      const artwork = await storage.createArtSession({
        sessionId: `job_${jobId}`,
        imageUrl,
        prompt: promptResult.prompt,
        dnaVector: JSON.stringify(promptResult.dnaVector),
        userId,
        motifs,
        qualityScore: 75, // Default quality for fresh generation
        perceptualHash: null, // Will be computed in future
        poolStatus: 'active',
        lastUsedAt: new Date(),
        // BUG FIX: Store preference tags for filtering
        styles: preferences.styles || [],
        artists: preferences.artists || [],
      });
      
      console.log(`[Async Worker] Stored artwork ${artwork.id} for job ${jobId}`);
      
      // Step 5: Update generation job with success
      await storage.updateGenerationJob(jobId, {
        status: 'completed',
        generatedArtworkId: artwork.id,
        completedAt: new Date(),
      });
      
      // Step 5: Emit WebSocket event to notify clients with sequence ID
      const { wsSequence, WS_MESSAGE_TYPES } = await import('./websocket-sequence');
      const message = wsSequence.createSequencedMessage(
        WS_MESSAGE_TYPES.ARTWORK_SWAP,
        {
          jobId,
          status: 'completed',
          artwork,
        }
      );
      
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      });
      
      console.log(`[Async Worker] Job ${jobId} completed successfully - emitted artwork.swap event`);
      
    } catch (error: any) {
      console.error(`[Async Worker] Job ${jobId} failed:`, error);
      
      // Update job with error status
      await storage.updateGenerationJob(jobId, {
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date(),
      });
      
      // NOTE: Daily usage was charged optimistically on job creation
      // For now, we don't refund on failure to keep accounting simple
      // Future: Implement compensating transaction or retry logic
      
      // Emit failure event with sequence ID
      const { wsSequence: wsSeqFail, WS_MESSAGE_TYPES: WS_TYPES_FAIL } = await import('./websocket-sequence');
      const failMessage = wsSeqFail.createSequencedMessage(
        WS_TYPES_FAIL.ARTWORK_SWAP,
        {
          jobId,
          status: 'failed',
          error: error.message,
        }
      );
      
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(failMessage));
        }
      });
    }
  }

  // ============================================================================
  // Artwork Generation with Queue Controller
  // ============================================================================
  
  app.post('/api/artwork/generate', testAuthBypass, isAuthenticated, validations.generateArt, async (req: any, res) => {
    try {
      const { sessionId, audioAnalysis, preferences } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ message: "sessionId is required" });
      }
      
      const userId = req.user.claims.sub;
      
      // Get queue metrics for the Queue Controller
      const queueMetrics = await storage.getQueueMetrics(sessionId);
      
      // Prepare metrics for the Queue Controller
      const metrics = {
        queueSize: queueMetrics.freshCount,
        targetSize: queueController.TARGET_FRAMES,
        minSize: queueController.MIN_FRAMES,
        maxSize: queueController.MAX_FRAMES,
        generationRate: queueMetrics.generationRate,
        consumptionRate: queueMetrics.consumptionRate
      };
      
      // Process tick and get current state
      const state = queueController.tick(metrics);
      
      // Get detailed generation decision
      const decision = queueController.getGenerationDecision();
      const batchSize = queueController.getRecommendedBatchSize();
      queueController.recordTelemetry(
        queueMetrics.freshCount,
        decision.shouldGenerate ? 'generate' : 'skip',
        batchSize
      );
      
      console.log('[Queue Controller] State:', state, 'Queue size:', queueMetrics.freshCount, 
                  'Should generate:', decision.shouldGenerate, 'Reason:', decision.reason, 'Batch size:', batchSize);
      
      // Check if generation is denied by circuit breaker - TRIGGER FALLBACK
      if (!decision.shouldGenerate && (decision.reason === 'breaker_open' || decision.reason === 'breaker_half_open')) {
        console.warn(`[Queue Controller] Circuit breaker ${decision.reason} - triggering fallback cascade`);
        
        try {
          // Import fallback service for emergency frame retrieval
          const { resolveEmergencyFallback } = await import('./fallback-service');
          
          // Get user preferences for style matching
          const preferences = await storage.getPreferencesBySession(sessionId);
          
          // Trigger 3-tier fallback cascade
          const fallbackResult = await resolveEmergencyFallback(
            storage,
            sessionId,
            userId,
            {
              styleTags: preferences?.styles || [],
              artistTags: preferences?.artists || [],
              minFrames: 2, // Need at least 2 frames for morphEngine
              useCache: true
            }
          );
          
          // Log telemetry for fallback usage
          telemetryService.recordEvent({
            category: 'fallback',
            event: 'breaker_triggered_fallback',
            metrics: {
              breaker_state: decision.reason,
              fallback_tier: fallbackResult.tier,
              frames_retrieved: fallbackResult.artworks.length,
              queue_state: state
            },
            severity: 'warning',
            sessionId,
            userId
          });
          
          console.log(`[Queue Controller] Fallback SUCCESS - Retrieved ${fallbackResult.artworks.length} frames from ${fallbackResult.tier} tier`);
          
          // Return fallback frames instead of empty response
          return res.json({
            status: 'fallback',
            reason: decision.reason,
            state,
            batchSize: 0, // No new generation
            framesGenerated: 0,
            frames: fallbackResult.artworks.map(artwork => ({
              id: artwork.id,
              imageUrl: artwork.imageUrl,
              prompt: artwork.prompt,
              fallback: true,
              tier: fallbackResult.tier
            })),
            metrics: queueController.getMetrics(),
            message: `Circuit breaker ${decision.reason} - using fallback frames from ${fallbackResult.tier} tier`
          });
        } catch (fallbackError: any) {
          console.error(`[Queue Controller] Fallback FAILED:`, fallbackError);
          
          // Even if fallback fails, return procedural bridge as last resort
          const { generateProceduralBridge } = await import('./procedural-bridge');
          const proceduralData = generateProceduralBridge(preferences?.styles || ['abstract']);
          
          return res.json({
            status: 'procedural_fallback',
            reason: decision.reason,
            state,
            batchSize: 0,
            framesGenerated: 0,
            procedural: proceduralData, // Frontend can render gradient/particles
            metrics: queueController.getMetrics(),
            message: `Circuit breaker ${decision.reason} - using procedural bridge`
          });
        }
      }
      
      // Check if we should generate (queue full case)
      if (!decision.shouldGenerate) {
        return res.json({
          status: 'queue_full',
          state,
          metrics: queueController.getMetrics(),
          message: 'Queue is full, waiting for frames to be consumed'
        });
      }
      
      // Generate frames based on batch size
      const generatedFrames = [];
      
      for (let i = 0; i < batchSize; i++) {
        try {
          // Generate art prompt using the proper flow
          const promptResult = await generateArtPrompt({
            audioAnalysis: audioAnalysis || createDefaultAudioAnalysis(),
            musicInfo: null,
            styles: preferences?.styles || [],
            artists: preferences?.artists || [],
            dynamicMode: preferences?.dynamicMode || false,
            previousVotes: []
          });
          
          // Generate image using DALL-E
          const imageUrl = await generateArtImage(promptResult.prompt);
          
          if (imageUrl) {
            // Store the generated artwork
            const artSession = await storage.createArtSession({
              sessionId,
              userId,
              imageUrl,
              prompt: promptResult.prompt,
              dnaVector: promptResult.dnaVector ? JSON.stringify(promptResult.dnaVector) : null,
              audioFeatures: audioAnalysis ? JSON.stringify(audioAnalysis) : null,
              generationExplanation: promptResult.explanation || null,
              styles: preferences?.styles || [],
              artists: preferences?.artists || []
            });
            
            generatedFrames.push({
              id: artSession.id,
              imageUrl: artSession.imageUrl,
              prompt: artSession.prompt
            });
            
            // Record generation for rate tracking
            queueController.recordGeneration(1);
          }
        } catch (genError) {
          console.error(`[Queue Controller] Failed to generate frame ${i + 1}:`, genError);
          // Continue with other frames even if one fails
        }
      }
      
      // Return response with generated frames and queue state
      res.json({
        status: 'success',
        state,
        batchSize,
        framesGenerated: generatedFrames.length,
        frames: generatedFrames,
        metrics: queueController.getMetrics(),
        queueState: {
          current: queueMetrics.freshCount,
          target: queueController.TARGET_FRAMES,
          min: queueController.MIN_FRAMES,
          max: queueController.MAX_FRAMES
        }
      });
      
    } catch (error: any) {
      console.error('[Queue Controller] Generation error:', error);
      res.status(500).json({ 
        message: 'Failed to generate artwork',
        error: error.message 
      });
    }
  });
  
  // Queue Controller Status Endpoint
  app.get('/api/queue/status/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      
      // Get queue metrics
      const queueMetrics = await storage.getQueueMetrics(sessionId);
      
      // Get controller state
      const controllerMetrics = queueController.getMetrics();
      
      res.json({
        sessionId,
        queue: {
          freshCount: queueMetrics.freshCount,
          totalCount: queueMetrics.totalCount,
          oldestTimestamp: queueMetrics.oldestTimestamp,
          generationRate: queueMetrics.generationRate,
          consumptionRate: queueMetrics.consumptionRate
        },
        controller: {
          state: controllerMetrics.currentState,
          stateChangeCounter: controllerMetrics.stateChangeCounter,
          targetState: controllerMetrics.lastTargetState,
          thresholds: {
            min: queueController.MIN_FRAMES,
            target: queueController.TARGET_FRAMES,
            max: queueController.MAX_FRAMES
          }
        },
        telemetry: queueController.getTelemetryHistory(10)
      });
    } catch (error: any) {
      console.error('[Queue Controller] Status error:', error);
      res.status(500).json({ 
        message: 'Failed to get queue status',
        error: error.message 
      });
    }
  });
  
  // Queue Controller Telemetry Endpoint
  app.get('/api/queue/telemetry', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const telemetry = queueController.getTelemetryHistory(limit);
      
      res.json({
        count: telemetry.length,
        telemetry,
        currentState: queueController.getState(),
        metrics: queueController.getMetrics()
      });
    } catch (error: any) {
      console.error('[Queue Controller] Telemetry error:', error);
      res.status(500).json({ 
        message: 'Failed to get telemetry',
        error: error.message 
      });
    }
  });

  // Comprehensive Telemetry Dashboard Endpoint
  app.get('/api/telemetry/dashboard', async (req, res) => {
    try {
      const summary = telemetryService.getMetricsSummary();
      const health = telemetryService.getHealthStatus();
      const alerts = telemetryService.checkAlerts();
      
      res.json({
        health,
        alerts,
        metrics: summary,
        successCriteria: {
          zeroBlackFrames: summary.blackFrameCount === 0,
          lowLatency: summary.avgTransitionLatency < 1500,
          minimalFallback: summary.fallbackUsage.rate < 0.05,
          displayLatency: summary.avgTransitionLatency < 100
        },
        timestamp: new Date()
      });
    } catch (error: any) {
      console.error('[Telemetry] Dashboard error:', error);
      res.status(500).json({ 
        message: 'Failed to get telemetry dashboard',
        error: error.message 
      });
    }
  });

  // Client Telemetry GET Endpoint - Get frameDisplayCount
  app.get('/api/telemetry/frameDisplayCount', async (req, res) => {
    try {
      // Get metrics summary from telemetry service
      const summary = telemetryService.getMetricsSummary();
      
      // Return frameDisplayCount and other display metrics
      const frameMetrics = {
        frameDisplayCount: summary.display?.framesGenerated || 0,
        blackFrameCount: summary.display?.blackFramesDetected || 0,
        placeholderCount: summary.display?.placeholdersUsed || 0,
        avgTransitionLatency: summary.display?.avgTransitionLatency || 0,
        totalCycles: summary.display?.morphCyclesCompleted || 0,
        uptime: summary.system?.uptimeSeconds || 0
      };
      
      res.json(frameMetrics);
    } catch (error) {
      console.error('[API] Error fetching frame display count:', error);
      res.status(500).json({ error: 'Failed to fetch frame display metrics' });
    }
  });

  // Client Telemetry Collection Endpoint
  app.post('/api/telemetry/client', async (req, res) => {
    try {
      const { events, summary } = req.body;
      
      // Process client events
      if (events && Array.isArray(events)) {
        events.forEach((event: any) => {
          telemetryService.recordEvent({
            ...event,
            category: event.category || 'display'
          });
        });
      }
      
      // Log client summary
      if (summary) {
        console.log('[ClientTelemetry] Summary:', summary);
      }
      
      res.json({ 
        success: true,
        processed: events?.length || 0
      });
    } catch (error: any) {
      console.error('[Telemetry] Client telemetry error:', error);
      res.status(500).json({ 
        message: 'Failed to process client telemetry',
        error: error.message 
      });
    }
  });

  // Telemetry Metrics Export (Prometheus format)
  app.get('/api/telemetry/metrics', (req, res) => {
    try {
      const metricsText = telemetryService.exportMetrics();
      res.set('Content-Type', 'text/plain; version=0.0.4');
      res.send(metricsText);
    } catch (error: any) {
      console.error('[Telemetry] Metrics export error:', error);
      res.status(500).send('# Error exporting metrics');
    }
  });

  // Circuit Breaker Admin Endpoint (for emergency reset)
  app.post('/api/admin/reset-circuit-breaker', async (req, res) => {
    try {
      const previousState = generationHealthService.forceClosed();
      console.log(`[Admin] Circuit breaker reset from ${previousState} to closed`);
      
      res.json({ 
        success: true,
        previousState,
        currentState: generationHealthService.getCurrentState(),
        message: 'Circuit breaker has been reset to closed state'
      });
    } catch (error: any) {
      console.error('[Admin] Circuit breaker reset error:', error);
      res.status(500).json({ 
        message: 'Failed to reset circuit breaker',
        error: error.message 
      });
    }
  });

  // Get Circuit Breaker Status
  app.get('/api/admin/circuit-breaker-status', (req, res) => {
    try {
      const status = generationHealthService.getDetailedStatus();
      res.json(status);
    } catch (error: any) {
      console.error('[Admin] Circuit breaker status error:', error);
      res.status(500).json({ 
        message: 'Failed to get circuit breaker status',
        error: error.message 
      });
    }
  });

  // WebSocket client tracking
  const wsClients = new Map<WebSocket, string>();
  
  // Helper function to generate client ID
  const generateClientId = () => `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Helper function to resync client
  const resyncClient = (ws: WebSocket, clientId: string, fromSeq: number) => {
    const messages = wsSequence.getMessagesFromSequence(clientId, fromSeq);
    messages.forEach(msg => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    });
    console.log(`[WebSocket] Resynced ${messages.length} messages to client ${clientId} from seq ${fromSeq}`);
  };
  
  // Periodic check for pending messages (retry mechanism)
  const retryInterval = setInterval(() => {
    const pendingMessages = wsSequence.checkPendingMessages();
    pendingMessages.forEach(pending => {
      // Find the client's WebSocket
      for (const [ws, clientId] of Array.from(wsClients)) {
        if (clientId === pending.clientId && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(pending.message));
          wsSequence.markRetried(clientId, pending.seq);
          console.log(`[WebSocket] Retrying message seq ${pending.seq} to client ${clientId}`);
          break;
        }
      }
    });
  }, 5000); // Check every 5 seconds
  
  // Periodic cleanup of stale clients
  const cleanupInterval = setInterval(() => {
    wsSequence.cleanupStaleClients();
  }, 60000); // Cleanup every minute
  
  wss.on('connection', (ws: WebSocket) => {
    const clientId = generateClientId();
    wsClients.set(ws, clientId);
    wsSequence.initializeClient(clientId);
    
    console.log(`[WebSocket] Client ${clientId} connected`);
    
    // Send initial connection/sync message with current sequence
    ws.send(JSON.stringify({
      type: WS_MESSAGE_TYPES.CONNECTION_INIT,
      seq: wsSequence.getCurrentSequence(),
      clientId,
      ts: Date.now()
    }));
    
    // Setup heartbeat interval for this client
    const heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const heartbeat = wsSequence.createClientMessage(
          clientId, 
          WS_MESSAGE_TYPES.HEARTBEAT, 
          { timestamp: Date.now() }
        );
        ws.send(JSON.stringify(heartbeat));
      }
    }, 30000); // Send heartbeat every 30 seconds
    
    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Update client's last seen timestamp for any message
        wsSequence.updateClientLastSeen(clientId);
        
        switch (data.type) {
          case WS_MESSAGE_TYPES.CLIENT_ACK:
            // Client acknowledging a server message
            wsSequence.acknowledgeMessage(clientId, data.seq);
            break;
            
          case WS_MESSAGE_TYPES.HEARTBEAT_ACK:
            // Client responding to heartbeat
            console.log(`[WebSocket] Heartbeat ACK from ${clientId}`);
            break;
            
          case WS_MESSAGE_TYPES.RESYNC_REQUEST:
            // Client requesting resync from a specific sequence
            resyncClient(ws, clientId, data.fromSeq);
            break;
            
          case 'audio-analysis':
            // Existing audio analysis handling
            // Broadcast to all OTHER clients (not the sender)
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                const targetClientId = wsClients.get(client);
                if (targetClientId) {
                  const msg = wsSequence.createClientMessage(
                    targetClientId,
                    'audio-update',
                    data.payload
                  );
                  client.send(JSON.stringify(msg));
                }
              }
            });
            break;
            
          default:
            console.log(`[WebSocket] Unknown message type from ${clientId}:`, data.type);
        }
      } catch (error) {
        console.error(`[WebSocket] Message error from ${clientId}:`, error);
        // Send error message back to client
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: WS_MESSAGE_TYPES.ERROR,
            error: 'Invalid message format',
            ts: Date.now()
          }));
        }
      }
    });

    ws.on('close', () => {
      console.log(`[WebSocket] Client ${clientId} disconnected`);
      clearInterval(heartbeatInterval);
      wsSequence.resetClientSequence(clientId);
      wsClients.delete(ws);
    });
    
    ws.on('error', (error) => {
      console.error(`[WebSocket] Client ${clientId} error:`, error);
    });
  });
  
  // Cleanup intervals on server shutdown
  process.on('SIGINT', () => {
    clearInterval(retryInterval);
    clearInterval(cleanupInterval);
    process.exit(0);
  });

  return httpServer;
}
