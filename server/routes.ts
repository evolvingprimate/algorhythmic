import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { raw } from "express";
import Stripe from "stripe";
import { storage } from "./storage";
import { generateArtPrompt, generateArtImage } from "./openai-service";
import { identifyMusic } from "./music-service";
import { insertArtVoteSchema, insertArtPreferenceSchema, type AudioAnalysis, type MusicIdentification } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { ObjectStorageService } from "./objectStorage";
import { generateWithFallback, resolveAutoMode, buildContextualPrompt } from "./generation/fallbackOrchestrator";
import { createDefaultAudioAnalysis } from "./generation/audioAnalyzer";
import { findBestCatalogMatch, type CatalogMatchRequest } from "./generation/catalogMatcher";

// Initialize Stripe only if keys are available (optional for MVP)
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-10-29.clover",
  });
} else {
  console.warn('Stripe not configured - payment features will be unavailable');
}

export async function registerRoutes(app: Express): Promise<Server> {
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
  app.post("/api/preferences", async (req, res) => {
    try {
      const validated = insertArtPreferenceSchema.parse(req.body);
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
      const { events } = req.body;
      if (!Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ message: "Events array is required" });
      }
      
      await storage.createTelemetryEvents(events);
      res.json({ success: true, count: events.length });
    } catch (error: any) {
      console.error("Error inserting telemetry events:", error);
      res.status(500).json({ message: error.message });
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

  // Generate art based on audio analysis - REQUIRES AUTHENTICATION
  app.post("/api/generate-art", isAuthenticated, async (req: any, res) => {
    try {
      const { sessionId, audioAnalysis, musicInfo, preferences, previousVotes } = req.body;

      // Get userId from authenticated user
      const userId = req.user.claims.sub;

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
      let finalAudio = audio;
      
      if (music) {
        // Tier 1: We have music identification
        provenance = 'MUSIC_ID';
        finalAudio = audio || createDefaultAudioAnalysis();
      } else if (audio && audio.frequency > 0 && audio.confidence !== undefined && audio.confidence > 0.6) {
        // Tier 2: We have quality audio analysis (must have explicit confidence >0.6)
        provenance = 'AUDIO_ONLY';
      } else {
        // Tier 3: Fall back to style preferences only (no music ID + missing/low audio confidence)
        provenance = 'STYLE_ONLY';
        finalAudio = audio || createDefaultAudioAnalysis();
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

      // Generate image using DALL-E
      console.log('[ArtGeneration] 🎨 Generating image with DALL-E...');
      const dalleUrl = await generateArtImage(result.prompt);
      console.log('[ArtGeneration] ✅ DALL-E generation complete:', dalleUrl);
      
      // Store image permanently in object storage with verification
      // CRITICAL: This must succeed - no fallback to temporary DALL-E URLs
      console.log('[ArtGeneration] 💾 Storing image permanently in Replit Object Storage...');
      const objectStorageService = new ObjectStorageService();
      const imageUrl = await objectStorageService.storeImageFromUrl(dalleUrl, userId);
      console.log('[ArtGeneration] ✅ Image stored and verified:', imageUrl);

      // DATABASE INTEGRITY CHECK: Validate imageUrl is a permanent storage path
      if (!imageUrl.startsWith('/public-objects/')) {
        throw new Error(
          `Database integrity violation: imageUrl must be permanent storage path, got: ${imageUrl}`
        );
      }
      console.log('[ArtGeneration] ✅ Database integrity check passed');

      // Save session with music info, explanation, and DNA vector
      console.log('[ArtGeneration] 💾 Saving to database...');
      const session = await storage.createArtSession({
        sessionId,
        userId,
        imageUrl,
        prompt: result.prompt,
        dnaVector: JSON.stringify(result.dnaVector),
        audioFeatures: JSON.stringify(audio),
        musicTrack: music?.title || null,
        musicArtist: music?.artist || null,
        musicGenre: null, // Could be populated from additional API call
        musicAlbum: music?.album || null,
        generationExplanation: result.explanation,
        isSaved: false,
      });

      console.log('[ArtGeneration] ✅ Database save complete, session ID:', session.id);

      // Increment daily usage (user is always authenticated here)
      const today = new Date().toISOString().split('T')[0];
      await storage.incrementDailyUsage(userId, today);
      console.log('[ArtGeneration] ✅ Daily usage incremented');

      console.log('[ArtGeneration] 🎉 Complete pipeline success: DALL-E → Storage → Verification → Database');

      res.json({
        imageUrl,
        prompt: result.prompt,
        explanation: result.explanation,
        musicInfo: music,
        session,
      });
    } catch (error: any) {
      console.error("Error generating art:", error);
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
  app.post("/api/vote", async (req, res) => {
    try {
      const validated = insertArtVoteSchema.parse(req.body);
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

  // GET endpoint with PRIORITY QUEUE: fresh → unseen
  // Fresh artwork (this session's last 15 min) shown FIRST, storage pool is fallback only
  app.get("/api/artworks/next", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sessionId = req.query.sessionId as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      
      // PRIORITY 1: Fresh AI-generated artwork (this session, last 15 minutes, not yet viewed)
      const freshArtworks = sessionId 
        ? await storage.getFreshArtworks(sessionId, userId, limit)
        : [];
      
      // PRIORITY 2: Unseen storage pool (fallback only when fresh queue empty)
      let combinedArtworks = [...freshArtworks];
      if (combinedArtworks.length < limit) {
        const remainingLimit = limit - combinedArtworks.length;
        const unseenArtworks = await storage.getUnseenArtworks(userId, remainingLimit);
        
        // Deduplicate IDs (fresh queue takes precedence)
        const existingIds = new Set(combinedArtworks.map(a => a.id));
        const uniqueUnseen = unseenArtworks.filter(a => !existingIds.has(a.id));
        
        combinedArtworks.push(...uniqueUnseen);
      }
      
      const needsGeneration = combinedArtworks.length < 5;
      
      console.log(`[Artworks GET] User ${userId} - Fresh: ${freshArtworks.length}, Storage: ${combinedArtworks.length - freshArtworks.length}, Total: ${combinedArtworks.length}`);
      
      // Set no-cache headers to prevent stale data
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      res.json({
        artworks: combinedArtworks,
        poolSize: combinedArtworks.length,
        freshCount: freshArtworks.length,
        storageCount: combinedArtworks.length - freshArtworks.length,
        needsGeneration,
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
        const unseenArtworks = await storage.getUnseenArtworks(userId, limit);
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
        const poolArtworks = await storage.getUnseenArtworks(userId, 1);
        
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
  app.post("/api/artworks/batch-impressions", isAuthenticated, async (req: any, res) => {
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

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
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

  const httpServer = createServer(app);

  // WebSocket server for real-time audio coordination
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

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
      });
      
      console.log(`[Async Worker] Stored artwork ${artwork.id} for job ${jobId}`);
      
      // Step 5: Update generation job with success
      await storage.updateGenerationJob(jobId, {
        status: 'completed',
        generatedArtworkId: artwork.id,
        completedAt: new Date(),
      });
      
      // Step 5: Emit WebSocket event to notify clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'artwork.swap',
            data: {
              jobId,
              status: 'completed',
              artwork,
            },
          }));
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
      
      // Emit failure event
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'artwork.swap',
            data: {
              jobId,
              status: 'failed',
              error: error.message,
            },
          }));
        }
      });
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected to WebSocket');

    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'audio-analysis') {
          // Broadcast audio analysis to all connected clients (for multi-device sync)
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'audio-update',
                data: data.payload,
              }));
            }
          });
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected from WebSocket');
    });

    // Send welcome message
    ws.send(JSON.stringify({ 
      type: 'connected', 
      message: 'Connected to Algorhythmic WebSocket server' 
    }));
  });

  return httpServer;
}
