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
  // Setup Replit Auth
  await setupAuth(app);

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

      // Validate audio analysis
      const audio = audioAnalysis as AudioAnalysis;
      if (!audio || typeof audio.frequency !== 'number') {
        return res.status(400).json({ message: "Invalid audio analysis data" });
      }

      // Use provided music info or null
      const music = musicInfo as MusicIdentification | null;

      // Generate art prompt using OpenAI
      const result = await generateArtPrompt({
        audioAnalysis: audio,
        musicInfo: music,
        styles: preferences?.styles || [],
        artists: preferences?.artists || [],
        dynamicMode: preferences?.dynamicMode || false,
        previousVotes: previousVotes || [],
      });

      // Generate image using DALL-E
      const imageUrl = await generateArtImage(result.prompt);

      // Save session with music info and explanation
      const session = await storage.createArtSession({
        sessionId,
        userId,
        imageUrl,
        prompt: result.prompt,
        audioFeatures: JSON.stringify(audio),
        musicTrack: music?.title || null,
        musicArtist: music?.artist || null,
        musicGenre: null, // Could be populated from additional API call
        musicAlbum: music?.album || null,
        generationExplanation: result.explanation,
        isSaved: false,
      });

      // Increment daily usage (user is always authenticated here)
      const today = new Date().toISOString().split('T')[0];
      await storage.incrementDailyUsage(userId, today);

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

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  const httpServer = createServer(app);

  // WebSocket server for real-time audio coordination
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

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
