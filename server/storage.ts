import { 
  type ArtPreference, 
  type InsertArtPreference,
  type ArtVote,
  type InsertArtVote,
  type ArtSession,
  type InsertArtSession,
  type User,
  type InsertUser,
  type UpsertUser,
  type DailyUsage,
  type InsertDailyUsage,
  type StorageMetric,
  type InsertStorageMetric,
  type RaiSession,
  type InsertRaiSession,
  type TelemetryEvent,
  type InsertTelemetryEvent,
  type GenerationJob,
  type InsertGenerationJob,
  type CreditLedger,
  type InsertCreditLedger,
  type UserCredits,
  type InsertUserCredits,
  artPreferences,
  artVotes,
  artSessions,
  userArtImpressions,
  users,
  dailyUsage,
  storageMetrics,
  raiSessions,
  telemetryEvents,
  generationJobs,
  creditLedger,
  userCredits,
  SUBSCRIPTION_TIERS,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq, desc, and, or, isNull, lt, gte, sql, getTableColumns, inArray, type SQL } from "drizzle-orm";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { expandStyles } from "@shared/style-relations";
import { generateProceduralBridge } from "./procedural-bridge";

// Helper function to normalize tier names (handles both hyphenated and underscored formats)
function normalizeTierName(tier: string): keyof typeof SUBSCRIPTION_TIERS {
  // Convert hyphenated to underscored format for backward compatibility
  const normalized = tier.replace(/-/g, '_');
  
  // Validate it's a known tier, fallback to free if unknown
  if (normalized in SUBSCRIPTION_TIERS) {
    return normalized as keyof typeof SUBSCRIPTION_TIERS;
  }
  
  return 'free';
}

export interface IStorage {
  // Art Preferences
  getPreferencesBySession(sessionId: string): Promise<ArtPreference | undefined>;
  createOrUpdatePreferences(sessionId: string, styles: string[], artists: string[], dynamicMode?: boolean): Promise<ArtPreference>;
  
  // Art Votes
  getVotesBySession(sessionId: string): Promise<ArtVote[]>;
  createVote(vote: InsertArtVote): Promise<ArtVote>;
  
  // Art Sessions
  createArtSession(session: InsertArtSession): Promise<ArtSession>;
  getSessionHistory(sessionId: string, limit?: number): Promise<ArtSession[]>;
  getUserSavedArt(userId: string, limit?: number): Promise<ArtSession[]>;
  getUserRecentArt(userId: string, limit?: number): Promise<ArtSession[]>;
  getRecentArt(limit?: number): Promise<ArtSession[]>; // Global artwork pool (all users)
  toggleArtSaved(artId: string, userId: string): Promise<ArtSession>;
  deleteArt(artId: string, userId: string): Promise<void>;
  
  // User Art Impressions (Freshness Pipeline)
  recordImpression(userId: string, artworkId: string, isBridge?: boolean): Promise<void>;
  recordBatchImpressions(userId: string, artworkIds: string[]): Promise<number>;
  recordRenderedImpressions(userId: string, artworkIds: string[], source?: 'bridge' | 'fresh'): Promise<number>;
  validateArtworkVisibility(userId: string, artworkIds: string[]): Promise<string[]>; // Filter to valid IDs in global pool
  getUnseenArtworks(
    userId: string, 
    options?: {
      limit?: number;
      orientation?: string;
      styleTags?: string[];
      artistTags?: string[];
    }
  ): Promise<ArtSession[]>;
  getFreshArtworks(sessionId: string, userId: string, limit?: number): Promise<ArtSession[]>; // Fresh AI-generated artwork (priority queue)
  getCatalogCandidates(userId: string, styleTags: string[], limit?: number): Promise<ArtSession[]>; // Catalog search for style switching
  getEmergencyFallbackArtworks(userId: string, options?: {
    limit?: number;
    orientation?: string;
  }): Promise<ArtSession[]>; // Emergency fallback with randomization to prevent cycling
  
  // Users (for subscription management and authentication)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>; // For Replit Auth
  updateUserSubscription(id: string, tier: string, stripeCustomerId?: string, stripeSubscriptionId?: string): Promise<User>;
  
  // Daily Usage (LEGACY - being replaced by monthly credit system)
  getDailyUsage(userId: string, date: string): Promise<DailyUsage | undefined>;
  incrementDailyUsage(userId: string, date: string): Promise<DailyUsage>;
  getUserDailyLimit(userId: string): Promise<number>;
  checkDailyLimit(userId: string): Promise<{ canGenerate: boolean; count: number; limit: number }>;
  
  // Monthly Credit System
  initializeUserCredits(userId: string, tier: string): Promise<UserCredits>;
  getCreditsContext(userId: string): Promise<{
    balance: number;
    rolloverBalance: number;
    baseQuota: number;
    cycleStart: Date;
    cycleEnd: Date;
    daysRemaining: number;
  }>;
  deductCredit(userId: string, amount: number, metadata?: Record<string, any>): Promise<{ success: boolean; newBalance: number }>;
  refundCredit(userId: string, amount: number, reason: string, metadata?: Record<string, any>): Promise<{ success: boolean; newBalance: number }>;
  getCreditHistory(userId: string, limit?: number): Promise<CreditLedger[]>;
  
  // Image Catalogue Manager
  getCatalogCoverage(userId: string, orientation?: string): Promise<{
    totalLibrary: number;
    unseenCount: number;
    unseenRatio: number;
    distinctStyles: number;
  }>;
  getLibraryArtwork(userId: string, orientation?: string, styles?: string[], limit?: number): Promise<ArtSession[]>;
  getLibraryArtworkWithFallback(
    userId: string,
    options: {
      styleTags?: string[];     // Empty array = short-circuit to global
      artistTags?: string[];    // Future expansion
      orientation?: string;     // Filter by orientation (dropped in global tier)
      excludeIds?: string[];    // Recently-served cache (max 100 IDs)
      limit?: number;           // Default: 2 for instant display
    }
  ): Promise<{
    artworks: ArtSession[];
    tier: 'exact' | 'related' | 'procedural' | 'global'; // Updated: 4-tier cascade
    latencyMs: number;          // Per-tier latency tracking
    proceduralData?: import('./procedural-bridge').ProceduralBridgeData; // Tier 3.5 metadata
  }>;
  
  // Storage Metrics
  recordStorageMetric(metric: InsertStorageMetric): Promise<StorageMetric>;
  getStorageMetrics(limit?: number): Promise<StorageMetric[]>;
  getStorageHealthStats(): Promise<{
    totalAttempts: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    avgVerificationTime: number;
    recentFailures: StorageMetric[];
  }>;

  // RAI Telemetry (Phase 2)
  createRaiSession(userId: string | null, artworkId?: string, genomeId?: string): Promise<RaiSession>;
  endRaiSession(sessionId: string): Promise<void>;
  createTelemetryEvents(events: InsertTelemetryEvent[]): Promise<void>;
  getTelemetryEventsSince(cutoffTime: Date): Promise<TelemetryEvent[]>;
  findOrCreateRaiSessionForClientSession(userId: string, clientSessionId: string): Promise<string>;

  // Generation Jobs (Hybrid gen+retrieve)
  createGenerationJob(job: InsertGenerationJob): Promise<GenerationJob>;
  getGenerationJob(id: string): Promise<GenerationJob | undefined>;
  updateGenerationJob(id: string, updates: Partial<GenerationJob>): Promise<GenerationJob>;
  getPoolCandidates(userId: string, limit?: number, minQuality?: number): Promise<ArtSession[]>;
  
  // Queue management (for Queue Controller)
  getFreshQueueSize(sessionId: string): Promise<number>;
  getQueueMetrics(sessionId: string): Promise<{
    freshCount: number;
    totalCount: number;
    oldestTimestamp: Date | null;
    consumptionRate: number;
    generationRate: number;
  }>;
}

export class MemStorage implements IStorage {
  private preferences: Map<string, ArtPreference>;
  private votes: Map<string, ArtVote>;
  private sessions: Map<string, ArtSession>;
  private users: Map<string, User>;
  private dailyUsageMap: Map<string, DailyUsage>;

  constructor() {
    this.preferences = new Map();
    this.votes = new Map();
    this.sessions = new Map();
    this.users = new Map();
    this.dailyUsageMap = new Map();
  }

  // Art Preferences
  async getPreferencesBySession(sessionId: string): Promise<ArtPreference | undefined> {
    return Array.from(this.preferences.values()).find(
      (pref) => pref.sessionId === sessionId
    );
  }

  async createOrUpdatePreferences(sessionId: string, styles: string[], artists: string[], dynamicMode: boolean = false): Promise<ArtPreference> {
    const existing = await this.getPreferencesBySession(sessionId);
    
    if (existing) {
      const updated: ArtPreference = {
        ...existing,
        styles,
        artists,
        dynamicMode,
      };
      this.preferences.set(existing.id, updated);
      return updated;
    }

    const id = randomUUID();
    const preference: ArtPreference = {
      id,
      sessionId,
      styles,
      artists,
      dynamicMode,
      createdAt: new Date(),
    };
    this.preferences.set(id, preference);
    return preference;
  }

  // Art Votes
  async getVotesBySession(sessionId: string): Promise<ArtVote[]> {
    return Array.from(this.votes.values())
      .filter((vote) => vote.sessionId === sessionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createVote(insertVote: InsertArtVote): Promise<ArtVote> {
    const id = randomUUID();
    const vote: ArtVote = {
      id,
      ...insertVote,
      audioCharacteristics: insertVote.audioCharacteristics || null,
      createdAt: new Date(),
    };
    this.votes.set(id, vote);
    return vote;
  }

  // Art Sessions
  async createArtSession(insertSession: InsertArtSession): Promise<ArtSession> {
    // Phase 3C: Transaction-like rollback pattern for MemStorage
    console.log('[MemStorage] Creating art session with validation pattern');
    
    // Pre-creation validation (cheap fail-fast)
    if (!insertSession.imageUrl || insertSession.imageUrl.trim() === '') {
      console.error('[MemStorage] Rejected art session: empty/null imageUrl');
      throw new Error('imageUrl is required and cannot be empty');
    }
    
    // Additional validation - check URL format
    const urlPattern = /^(\/public-objects\/|https?:\/\/|\/)/;
    if (!urlPattern.test(insertSession.imageUrl)) {
      console.error(`[MemStorage] Rejected art session: Invalid imageUrl format: ${insertSession.imageUrl}`);
      throw new Error(`Invalid imageUrl format: ${insertSession.imageUrl}`);
    }
    
    const id = randomUUID();
    const session: ArtSession = {
      id,
      ...insertSession,
      userId: insertSession.userId ?? null,
      dnaVector: insertSession.dnaVector ?? null,
      audioFeatures: insertSession.audioFeatures ?? null,
      musicTrack: insertSession.musicTrack ?? null,
      musicArtist: insertSession.musicArtist ?? null,
      musicGenre: insertSession.musicGenre ?? null,
      musicAlbum: insertSession.musicAlbum ?? null,
      generationExplanation: insertSession.generationExplanation ?? null,
      isSaved: insertSession.isSaved ?? false,
      // ImagePool metadata fields
      motifs: insertSession.motifs ?? null,
      qualityScore: insertSession.qualityScore ?? null,
      perceptualHash: insertSession.perceptualHash ?? null,
      poolStatus: insertSession.poolStatus ?? null,
      lastUsedAt: insertSession.lastUsedAt ?? null,
      // User preference tags (for filtering)
      styles: insertSession.styles ?? null,
      artists: insertSession.artists ?? null,
      // Image Catalogue Manager fields
      isLibrary: insertSession.isLibrary ?? false,
      orientation: insertSession.orientation ?? null,
      aspectRatio: insertSession.aspectRatio ?? null,
      catalogueTier: insertSession.catalogueTier ?? null,
      width: insertSession.width ?? null,
      height: insertSession.height ?? null,
      safeArea: insertSession.safeArea ?? null,
      focalPoints: insertSession.focalPoints ?? null,
      sidefillPalette: insertSession.sidefillPalette ?? null,
      createdAt: new Date(),
    };
    this.sessions.set(id, session);
    return session;
  }

  async getSessionHistory(sessionId: string, limit: number = 20): Promise<ArtSession[]> {
    return Array.from(this.sessions.values())
      .filter((session) => session.sessionId === sessionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getUserSavedArt(userId: string, limit: number = 100): Promise<ArtSession[]> {
    return Array.from(this.sessions.values())
      .filter(s => s.userId === userId && s.isSaved)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getUserRecentArt(userId: string, limit: number = 20): Promise<ArtSession[]> {
    return Array.from(this.sessions.values())
      .filter(s => s.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getRecentArt(limit: number = 20): Promise<ArtSession[]> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async recordImpression(userId: string, artworkId: string): Promise<void> {
    // Stub implementation (not used, DbStorage handles this)
    return;
  }

  async validateArtworkVisibility(userId: string, artworkIds: string[]): Promise<string[]> {
    // Filter to only IDs that exist in session map
    return artworkIds.filter(id => this.sessions.has(id));
  }

  async recordBatchImpressions(userId: string, artworkIds: string[]): Promise<number> {
    // Stub implementation (not used, DbStorage handles this)
    return artworkIds.length;
  }

  async recordRenderedImpressions(userId: string, artworkIds: string[], source?: 'bridge' | 'fresh'): Promise<number> {
    // Stub implementation (not used, PostgresStorage handles this)
    return artworkIds.length;
  }

  async getUnseenArtworks(
    userId: string, 
    options?: {
      limit?: number;
      orientation?: string;
      styleTags?: string[];
      artistTags?: string[];
    }
  ): Promise<ArtSession[]> {
    // Stub implementation (not used, DbStorage handles this)
    return this.getRecentArt(options?.limit ?? 20);
  }

  async getFreshArtworks(sessionId: string, userId: string, limit: number = 20): Promise<ArtSession[]> {
    // Return recently created artworks from this session (in-memory stub)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    return Array.from(this.sessions.values())
      .filter((art) => 
        art.sessionId === sessionId && 
        art.createdAt >= fifteenMinutesAgo
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async toggleArtSaved(artId: string, userId: string): Promise<ArtSession> {
    const art = this.sessions.get(artId);
    if (!art) {
      throw new Error("Art not found");
    }
    if (art.userId !== userId) {
      throw new Error("Not authorized");
    }
    const updated: ArtSession = {
      ...art,
      isSaved: !art.isSaved,
    };
    this.sessions.set(artId, updated);
    return updated;
  }

  async deleteArt(artId: string, userId: string): Promise<void> {
    const art = this.sessions.get(artId);
    if (!art) {
      throw new Error("Art not found");
    }
    if (art.userId !== userId) {
      throw new Error("Not authorized");
    }
    this.sessions.delete(artId);
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      id,
      ...insertUser,
      email: insertUser.email || null,
      firstName: insertUser.firstName || null,
      lastName: insertUser.lastName || null,
      profileImageUrl: insertUser.profileImageUrl || null,
      subscriptionTier: insertUser.subscriptionTier || "free",
      stripeCustomerId: insertUser.stripeCustomerId || null,
      stripeSubscriptionId: insertUser.stripeSubscriptionId || null,
      isActive: true,
      preferredOrientation: insertUser.preferredOrientation || null,
      controllerState: insertUser.controllerState || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const existing = this.users.get(userData.id as string);
    if (existing) {
      const updated: User = {
        ...existing,
        email: userData.email ?? existing.email,
        firstName: userData.firstName ?? existing.firstName,
        lastName: userData.lastName ?? existing.lastName,
        profileImageUrl: userData.profileImageUrl ?? existing.profileImageUrl,
        preferredOrientation: userData.preferredOrientation ?? existing.preferredOrientation,
        controllerState: userData.controllerState ?? existing.controllerState,
        updatedAt: new Date(),
      };
      this.users.set(existing.id, updated);
      return updated;
    }

    const newUser: User = {
      id: userData.id as string,
      email: userData.email || null,
      firstName: userData.firstName || null,
      lastName: userData.lastName || null,
      profileImageUrl: userData.profileImageUrl || null,
      subscriptionTier: userData.subscriptionTier || "free",
      stripeCustomerId: userData.stripeCustomerId || null,
      stripeSubscriptionId: userData.stripeSubscriptionId || null,
      isActive: userData.isActive ?? true,
      preferredOrientation: userData.preferredOrientation || null,
      controllerState: userData.controllerState || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(newUser.id, newUser);
    return newUser;
  }

  async updateUserSubscription(
    id: string, 
    tier: string, 
    stripeCustomerId?: string, 
    stripeSubscriptionId?: string
  ): Promise<User> {
    const user = await this.getUser(id);
    if (!user) {
      throw new Error("User not found");
    }

    const updated: User = {
      ...user,
      subscriptionTier: tier,
      stripeCustomerId: stripeCustomerId || user.stripeCustomerId,
      stripeSubscriptionId: stripeSubscriptionId || user.stripeSubscriptionId,
    };
    this.users.set(id, updated);
    return updated;
  }

  // Daily Usage
  async getDailyUsage(userId: string, date: string): Promise<DailyUsage | undefined> {
    const key = `${userId}_${date}`;
    return this.dailyUsageMap.get(key);
  }

  async incrementDailyUsage(userId: string, date: string): Promise<DailyUsage> {
    const key = `${userId}_${date}`;
    const existing = this.dailyUsageMap.get(key);

    if (existing) {
      const updated: DailyUsage = {
        ...existing,
        generationCount: existing.generationCount + 1,
        updatedAt: new Date(),
      };
      this.dailyUsageMap.set(key, updated);
      return updated;
    }

    const id = randomUUID();
    const newUsage: DailyUsage = {
      id,
      userId,
      date,
      generationCount: 1,
      updatedAt: new Date(),
    };
    this.dailyUsageMap.set(key, newUsage);
    return newUsage;
  }

  async getUserDailyLimit(userId: string): Promise<number> {
    const user = await this.getUser(userId);
    if (!user) {
      return SUBSCRIPTION_TIERS.free.dailyLimit;
    }
    const tier = normalizeTierName(user.subscriptionTier);
    return SUBSCRIPTION_TIERS[tier].dailyLimit;
  }

  async checkDailyLimit(userId: string): Promise<{ canGenerate: boolean; count: number; limit: number }> {
    const today = new Date().toISOString().split('T')[0];
    const usage = await this.getDailyUsage(userId, today);
    const limit = await this.getUserDailyLimit(userId);
    const count = usage?.generationCount || 0;

    return {
      canGenerate: count < limit,
      count,
      limit,
    };
  }

  // Storage Metrics (stub implementation for MemStorage)
  async recordStorageMetric(metric: InsertStorageMetric): Promise<StorageMetric> {
    // MemStorage doesn't persist metrics - return stub
    const id = randomUUID();
    return {
      id,
      ...metric,
      userId: metric.userId ?? null,
      fileSize: metric.fileSize ?? null,
      dalleUrl: metric.dalleUrl ?? null,
      storageUrl: metric.storageUrl ?? null,
      attemptCount: metric.attemptCount ?? 1,
      verificationTimeMs: metric.verificationTimeMs ?? null,
      errorMessage: metric.errorMessage ?? null,
      createdAt: new Date(),
    };
  }

  async getStorageMetrics(limit: number = 100): Promise<StorageMetric[]> {
    // MemStorage doesn't persist metrics
    return [];
  }

  async getStorageHealthStats(): Promise<{
    totalAttempts: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    avgVerificationTime: number;
    recentFailures: StorageMetric[];
  }> {
    // MemStorage doesn't persist metrics
    return {
      totalAttempts: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 100,
      avgVerificationTime: 0,
      recentFailures: [],
    };
  }

  // RAI Telemetry Methods (Phase 2) - Stubs for MemStorage
  async createRaiSession(userId: string | null, artworkId?: string, genomeId?: string): Promise<RaiSession> {
    const session: RaiSession = {
      id: randomUUID(),
      userId,
      clientSessionId: null,
      artworkId: artworkId || null,
      genomeId: genomeId || null,
      audioContext: null,
      visualContext: null,
      startedAt: new Date(),
      endedAt: null,
      durationSeconds: null,
    };
    return session;
  }

  async endRaiSession(sessionId: string): Promise<void> {
    // MemStorage doesn't persist sessions
  }

  async createTelemetryEvents(events: InsertTelemetryEvent[]): Promise<void> {
    // MemStorage doesn't persist telemetry
  }

  async getTelemetryEventsSince(cutoffTime: Date): Promise<TelemetryEvent[]> {
    // MemStorage doesn't persist telemetry
    return [];
  }

  async findOrCreateRaiSessionForClientSession(userId: string, clientSessionId: string): Promise<string> {
    // MemStorage doesn't persist sessions - return mock ID
    return randomUUID();
  }

  // Generation Jobs (MemStorage stubs)
  async createGenerationJob(job: InsertGenerationJob): Promise<GenerationJob> {
    const id = randomUUID();
    return {
      id,
      ...job,
      audioContext: job.audioContext ?? null,
      warmStartArtworkId: job.warmStartArtworkId ?? null,
      generatedArtworkId: job.generatedArtworkId ?? null,
      status: job.status ?? 'pending',
      attemptCount: job.attemptCount ?? 0,
      errorMessage: job.errorMessage ?? null,
      createdAt: new Date(),
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
    };
  }

  async getGenerationJob(id: string): Promise<GenerationJob | undefined> {
    return undefined;
  }

  async updateGenerationJob(id: string, updates: Partial<GenerationJob>): Promise<GenerationJob> {
    throw new Error('MemStorage does not support generation jobs');
  }

  async getPoolCandidates(userId: string, limit: number = 20, minQuality: number = 35): Promise<ArtSession[]> {
    // MemStorage: return unseen artworks (same as getUnseenArtworks)
    return Array.from(this.sessions.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getCatalogCandidates(userId: string, styleTags: string[], limit: number = 200): Promise<ArtSession[]> {
    // MemStorage stub: filter by tag overlap (simple in-memory filtering)
    if (!styleTags || styleTags.length === 0) return [];
    
    const tagSet = new Set(styleTags.map(t => t.toLowerCase()));
    return Array.from(this.sessions.values())
      .filter(session => {
        if (!session.motifs || session.motifs.length === 0) return false;
        return session.motifs.some(motif => tagSet.has(motif.toLowerCase()));
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  // Monthly Credit System (MemStorage stubs)
  async initializeUserCredits(userId: string, tier: string): Promise<UserCredits> {
    const tierKey = normalizeTierName(tier);
    const baseQuota = SUBSCRIPTION_TIERS[tierKey].dailyLimit * 30;
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    return {
      userId,
      balance: baseQuota,
      rolloverBalance: 0,
      baseQuota,
      billingCycleStart: cycleStart,
      billingCycleEnd: cycleEnd,
      timezone: 'UTC',
      lastUpdated: new Date(),
    };
  }

  async getCreditsContext(userId: string): Promise<{
    balance: number;
    rolloverBalance: number;
    baseQuota: number;
    cycleStart: Date;
    cycleEnd: Date;
    daysRemaining: number;
  }> {
    const user = await this.getUser(userId);
    const tier = user?.subscriptionTier || 'free';
    const tierKey = normalizeTierName(tier);
    const baseQuota = SUBSCRIPTION_TIERS[tierKey].dailyLimit * 30;
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const daysRemaining = Math.max(0, Math.ceil((cycleEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    
    return {
      balance: baseQuota,
      rolloverBalance: 0,
      baseQuota,
      cycleStart,
      cycleEnd,
      daysRemaining,
    };
  }

  async deductCredit(userId: string, amount: number, metadata?: Record<string, any>): Promise<{ success: boolean; newBalance: number }> {
    return { success: true, newBalance: 100 };
  }

  async refundCredit(userId: string, amount: number, reason: string, metadata?: Record<string, any>): Promise<{ success: boolean; newBalance: number }> {
    return { success: true, newBalance: 100 };
  }

  async getCreditHistory(userId: string, limit: number = 50): Promise<CreditLedger[]> {
    return [];
  }

  // Image Catalogue Manager (MemStorage stubs)
  async getCatalogCoverage(userId: string, orientation?: string): Promise<{
    totalLibrary: number;
    unseenCount: number;
    unseenRatio: number;
    distinctStyles: number;
  }> {
    return {
      totalLibrary: 0,
      unseenCount: 0,
      unseenRatio: 0,
      distinctStyles: 0,
    };
  }

  async getLibraryArtwork(userId: string, orientation?: string, styles?: string[], limit: number = 20): Promise<ArtSession[]> {
    return [];
  }

  async getLibraryArtworkWithFallback(
    userId: string,
    options: {
      styleTags?: string[];
      artistTags?: string[];
      orientation?: string;
      excludeIds?: string[];
      limit?: number;
    }
  ): Promise<{
    artworks: ArtSession[];
    tier: 'exact' | 'related' | 'procedural' | 'global';
    latencyMs: number;
    proceduralData?: import('./procedural-bridge').ProceduralBridgeData;
  }> {
    // MemStorage stub: return empty with global tier
    // In production, this would do in-memory filtering similar to PostgresStorage
    return { artworks: [], tier: 'global', latencyMs: 0 };
  }

  async getEmergencyFallbackArtworks(
    userId: string,
    options?: {
      limit?: number;
      orientation?: string;
    }
  ): Promise<ArtSession[]> {
    const limit = options?.limit ?? 20;
    const orientation = options?.orientation;
    
    // Get all sessions from memory, filter by imageUrl and orientation
    const allSessions = Array.from(this.sessions.values())
      .filter(session => {
        if (!session.imageUrl) return false;
        if (orientation && session.orientation !== orientation) return false;
        return true;
      });
    
    // Shuffle for variety (similar to RANDOM() in SQL)
    const shuffled = allSessions.sort(() => Math.random() - 0.5);
    
    // Return limited results
    return shuffled.slice(0, limit);
  }
  
  // Queue management methods (for Queue Controller)
  async getFreshQueueSize(sessionId: string): Promise<number> {
    // Count art sessions for this session that haven't been consumed yet
    // In MemStorage, we'll approximate this by counting recent sessions
    const recentSessions = Array.from(this.sessions.values())
      .filter(session => {
        if (session.sessionId !== sessionId) return false;
        // Check if created within last hour (fresh queue)
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
        return session.createdAt > hourAgo;
      });
    
    return recentSessions.length;
  }
  
  async getQueueMetrics(sessionId: string): Promise<{
    freshCount: number;
    totalCount: number;
    oldestTimestamp: Date | null;
    consumptionRate: number;
    generationRate: number;
  }> {
    // Get all sessions for this sessionId
    const sessionArtworks = Array.from(this.sessions.values())
      .filter(session => session.sessionId === sessionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    
    // Fresh count: artworks created in last hour
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const freshCount = sessionArtworks.filter(s => s.createdAt > hourAgo).length;
    
    // Get oldest timestamp
    const oldestTimestamp = sessionArtworks.length > 0 ? sessionArtworks[0].createdAt : null;
    
    // Calculate rates based on recent activity (simplified for MemStorage)
    const minuteAgo = new Date(Date.now() - 60 * 1000);
    const recentGenerations = sessionArtworks.filter(s => s.createdAt > minuteAgo).length;
    
    return {
      freshCount,
      totalCount: sessionArtworks.length,
      oldestTimestamp,
      consumptionRate: 0, // Would need tracking of consumption events
      generationRate: recentGenerations // Approximation: recent generations per minute
    };
  }

  // Telemetry methods (stub for MemStorage)
  async getCatalogueBridgeTelemetry(cutoffTime: Date): Promise<TelemetryEvent[]> {
    // Return empty array for in-memory storage
    // Real telemetry is only tracked in PostgresStorage
    return [];
  }
}

// PostgreSQL Storage Implementation
export class PostgresStorage implements IStorage {
  private db;

  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    // Configure WebSocket for Neon serverless
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    this.db = drizzle(pool);
  }

  // Art Preferences
  async getPreferencesBySession(sessionId: string): Promise<ArtPreference | undefined> {
    const results = await this.db
      .select()
      .from(artPreferences)
      .where(eq(artPreferences.sessionId, sessionId))
      .limit(1);
    return results[0];
  }

  async createOrUpdatePreferences(
    sessionId: string,
    styles: string[],
    artists: string[],
    dynamicMode: boolean = false
  ): Promise<ArtPreference> {
    const existing = await this.getPreferencesBySession(sessionId);

    if (existing) {
      const updated = await this.db
        .update(artPreferences)
        .set({ styles, artists, dynamicMode })
        .where(eq(artPreferences.id, existing.id))
        .returning();
      return updated[0];
    }

    const created = await this.db
      .insert(artPreferences)
      .values({ sessionId, styles, artists, dynamicMode })
      .returning();
    return created[0];
  }

  // Art Votes
  async getVotesBySession(sessionId: string): Promise<ArtVote[]> {
    return await this.db
      .select()
      .from(artVotes)
      .where(eq(artVotes.sessionId, sessionId))
      .orderBy(desc(artVotes.createdAt));
  }

  async createVote(insertVote: InsertArtVote): Promise<ArtVote> {
    const created = await this.db
      .insert(artVotes)
      .values(insertVote)
      .returning();
    return created[0];
  }

  // Art Sessions
  async createArtSession(insertSession: InsertArtSession): Promise<ArtSession> {
    // Phase 3C: Transaction with rollback pattern for data integrity
    console.log('[Storage] Creating art session with transaction rollback pattern');
    
    // Pre-transaction validation (cheap fail-fast)
    if (!insertSession.imageUrl || insertSession.imageUrl.trim() === '') {
      console.error('[Storage] Rejected art session: empty/null imageUrl');
      throw new Error('imageUrl is required and cannot be empty');
    }
    
    try {
      // Use Drizzle transaction for atomic operation
      const result = await this.db.transaction(async (tx) => {
        // Step 1: Insert the record
        const [created] = await tx
          .insert(artSessions)
          .values(insertSession)
          .returning();
        
        // Step 2: Post-insert validation (ensure DB didn't corrupt the data)
        if (!created || !created.imageUrl) {
          console.error('[Storage] Transaction rollback: DB returned null imageUrl after insert');
          throw new Error('Database corruption detected: imageUrl became null after insert');
        }
        
        // Step 3: Additional validation - check URL format
        const urlPattern = /^(\/public-objects\/|https?:\/\/|\/)/;
        if (!urlPattern.test(created.imageUrl)) {
          console.error(`[Storage] Transaction rollback: Invalid imageUrl format: ${created.imageUrl}`);
          throw new Error(`Invalid imageUrl format: ${created.imageUrl}`);
        }
        
        console.log(`[Storage] Art session created successfully: ${created.id} with imageUrl: ${created.imageUrl.substring(0, 50)}...`);
        return created;
      });
      
      return result;
    } catch (error) {
      // Transaction automatically rolled back on error
      console.error('[Storage] Art session creation failed, transaction rolled back:', error);
      throw error;
    }
  }

  async getSessionHistory(sessionId: string, limit: number = 20): Promise<ArtSession[]> {
    return await this.db
      .select()
      .from(artSessions)
      .where(eq(artSessions.sessionId, sessionId))
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
  }

  async getUserSavedArt(userId: string, limit: number = 100): Promise<ArtSession[]> {
    return await this.db
      .select()
      .from(artSessions)
      .where(and(eq(artSessions.userId, userId), eq(artSessions.isSaved, true)))
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
  }

  async getUserRecentArt(userId: string, limit: number = 20): Promise<ArtSession[]> {
    return await this.db
      .select()
      .from(artSessions)
      .where(eq(artSessions.userId, userId))
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
  }

  async getRecentArt(limit: number = 20): Promise<ArtSession[]> {
    return await this.db
      .select()
      .from(artSessions)
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
  }

  async toggleArtSaved(artId: string, userId: string): Promise<ArtSession> {
    const art = await this.db
      .select()
      .from(artSessions)
      .where(eq(artSessions.id, artId))
      .limit(1);
    
    if (!art[0]) {
      throw new Error("Art not found");
    }
    if (art[0].userId !== userId) {
      throw new Error("Not authorized");
    }
    
    const updated = await this.db
      .update(artSessions)
      .set({ isSaved: !art[0].isSaved })
      .where(eq(artSessions.id, artId))
      .returning();
    return updated[0];
  }

  async deleteArt(artId: string, userId: string): Promise<void> {
    const art = await this.db
      .select()
      .from(artSessions)
      .where(eq(artSessions.id, artId))
      .limit(1);
    
    if (!art[0]) {
      throw new Error("Art not found");
    }
    if (art[0].userId !== userId) {
      throw new Error("Not authorized");
    }
    
    await this.db
      .delete(artSessions)
      .where(eq(artSessions.id, artId));
  }

  async updateArtSessionMetadata(
    artId: string,
    metadata: {
      focalPoints?: any[];
      safeArea?: any;
      sidefillPalette?: string[];
    }
  ): Promise<ArtSession> {
    const updated = await this.db
      .update(artSessions)
      .set({
        focalPoints: metadata.focalPoints ? JSON.stringify(metadata.focalPoints) : undefined,
        safeArea: metadata.safeArea ? JSON.stringify(metadata.safeArea) : undefined,
        sidefillPalette: metadata.sidefillPalette ? JSON.stringify(metadata.sidefillPalette) : undefined,
      })
      .where(eq(artSessions.id, artId))
      .returning();
    
    if (!updated[0]) {
      throw new Error("Art session not found");
    }
    
    return updated[0];
  }

  async getLibraryArtworksNeedingEnrichment(
    limit: number = 100,
    skipExisting: boolean = true
  ): Promise<ArtSession[]> {
    const conditions = [eq(artSessions.isLibrary, true)];
    
    // Skip artworks that already have metadata
    if (skipExisting) {
      conditions.push(isNull(artSessions.focalPoints));
    }
    
    return await this.db
      .select()
      .from(artSessions)
      .where(and(...conditions))
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
  }

  // User Art Impressions (Freshness Pipeline)
  async recordImpression(userId: string, artworkId: string, isBridge: boolean = false): Promise<void> {
    // CRITICAL: UPSERT to update viewedAt timestamp on repeat views
    // This resets the 7-day cooldown each time artwork is seen
    // PHASE 1 CATALOG: Now supports bridgeAt timestamp for catalog bridges
    const values: any = { 
      userId, 
      artworkId, 
      viewedAt: sql`NOW()` 
    };
    const updates: any = { 
      viewedAt: sql`NOW()` 
    };
    
    // Only set bridgeAt if this is a catalog bridge
    if (isBridge) {
      values.bridgeAt = sql`NOW()`;
      updates.bridgeAt = sql`NOW()`;
    }
    
    await this.db
      .insert(userArtImpressions)
      .values(values)
      .onConflictDoUpdate({
        target: [userArtImpressions.userId, userArtImpressions.artworkId],
        set: updates
      });
  }

  async validateArtworkVisibility(userId: string, artworkIds: string[]): Promise<string[]> {
    if (!artworkIds.length) return [];
    
    // Filter to only IDs that exist in global artwork pool
    // Note: All artworks are globally visible (shared pool design)
    const results = await this.db
      .select({ id: artSessions.id })
      .from(artSessions)
      .where(inArray(artSessions.id, artworkIds));
    
    return results.map(r => r.id);
  }

  async recordBatchImpressions(userId: string, artworkIds: string[]): Promise<number> {
    if (!artworkIds.length) return 0;
    
    // CRITICAL: UPSERT to update viewedAt timestamp on repeat views (same as recordImpression)
    // This resets the 7-day cooldown each time artwork is seen
    const rows = artworkIds.map(artworkId => ({
      userId,
      artworkId,
      viewedAt: sql`NOW()` as any,
    }));
    
    await this.db
      .insert(userArtImpressions)
      .values(rows)
      .onConflictDoUpdate({
        target: [userArtImpressions.userId, userArtImpressions.artworkId],
        set: { viewedAt: sql`NOW()` } // Update timestamp on conflict (maintains cooldown logic)
      });
    
    return artworkIds.length;
  }

  async recordRenderedImpressions(userId: string, artworkIds: string[], source?: 'bridge' | 'fresh'): Promise<number> {
    if (!artworkIds.length) return 0;
    
    // Determine if this is a bridge impression
    const isBridge = source === 'bridge';
    
    // Construct rows for batch insert (similar to recordImpression but batched)
    const rows = artworkIds.map(artworkId => {
      const row: any = {
        userId,
        artworkId,
        viewedAt: sql`NOW()`,
      };
      
      // Only set bridgeAt if this is a catalog bridge
      if (isBridge) {
        row.bridgeAt = sql`NOW()`;
      }
      
      return row;
    });
    
    // UPSERT: Insert new impressions or update existing ones
    await this.db
      .insert(userArtImpressions)
      .values(rows)
      .onConflictDoUpdate({
        target: [userArtImpressions.userId, userArtImpressions.artworkId],
        set: isBridge 
          ? { viewedAt: sql`NOW()`, bridgeAt: sql`NOW()` }
          : { viewedAt: sql`NOW()` }
      });
    
    return artworkIds.length;
  }

  async getUnseenArtworks(
    userId: string, 
    options?: {
      limit?: number;
      orientation?: string;
      styleTags?: string[];
      artistTags?: string[];
    }
  ): Promise<ArtSession[]> {
    const limit = options?.limit ?? 20;
    const orientation = options?.orientation;
    const styleTags = options?.styleTags || [];
    const artistTags = options?.artistTags || [];
    
    // FEATURE FLAG: Switch between OR (lenient) and AND (strict) filtering
    const PREFERENCE_STRICT_MATCH = false; // Future: environment variable
    
    console.log('[Style Filtering] getUnseenArtworks called with:', {
      userId,
      limit,
      orientation,
      styleTags,
      artistTags,
      strictMode: PREFERENCE_STRICT_MATCH
    });
    
    // Build WHERE conditions
    const baseConditions = [isNull(userArtImpressions.id)]; // Must be unseen
    
    // Hard filter: orientation (exact match required)
    if (orientation) {
      baseConditions.push(eq(artSessions.orientation, orientation));
    }
    
    // Soft filter: style tags (OR logic - any matching tag qualifies)
    // Empty arrays mean "no preference" (don't filter)
    let styleCondition: SQL | undefined;
    if (styleTags.length > 0) {
      if (PREFERENCE_STRICT_MATCH) {
        // Future AND logic: artwork must contain ALL user style tags
        styleCondition = and(
          ...styleTags.map(tag => 
            sql`${artSessions.styles} @> ARRAY[${tag}]::text[]`
          )
        );
      } else {
        // Current OR logic: artwork must contain AT LEAST ONE user style tag
        styleCondition = or(
          ...styleTags.map(tag => 
            sql`${artSessions.styles} @> ARRAY[${tag}]::text[]`
          )
        );
      }
    }
    
    // Soft filter: artist tags (OR logic - any matching artist qualifies)
    let artistCondition: SQL | undefined;
    if (artistTags.length > 0) {
      artistCondition = or(
        ...artistTags.map(tag => 
          sql`${artSessions.artists} @> ARRAY[${tag}]::text[]`
        )
      );
    }
    
    // Combine all conditions
    const whereConditions = [...baseConditions];
    if (styleCondition) whereConditions.push(styleCondition);
    if (artistCondition) whereConditions.push(artistCondition);
    
    // PASS 1: Try full preference match
    console.log('[Style Filtering] PASS 1: Full preference match');
    let results = await this.db
      .select(getTableColumns(artSessions))
      .from(artSessions)
      .leftJoin(
        userArtImpressions,
        and(
          eq(artSessions.id, userArtImpressions.artworkId),
          eq(userArtImpressions.userId, userId)
        )
      )
      .where(and(...whereConditions))
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
    
    console.log('[Style Filtering] PASS 1 results:', results.length);
    
    // PASS 2: If insufficient results, broaden search (orientation-only)
    if (results.length < limit && orientation) {
      console.log('[Style Filtering] PASS 2: Broadened to orientation-only (dropped style/artist filters)');
      const broadenedResults = await this.db
        .select(getTableColumns(artSessions))
        .from(artSessions)
        .leftJoin(
          userArtImpressions,
          and(
            eq(artSessions.id, userArtImpressions.artworkId),
            eq(userArtImpressions.userId, userId)
          )
        )
        .where(
          and(
            isNull(userArtImpressions.id),
            eq(artSessions.orientation, orientation)
          )
        )
        .orderBy(desc(artSessions.createdAt))
        .limit(limit - results.length); // Fill remainder
      
      results = [...results, ...broadenedResults];
      console.log('[Style Filtering] PASS 2 added:', broadenedResults.length, 'total:', results.length);
    }
    
    // PASS 3: Final fallback - no filters (orientation exhausted or no preference)
    if (results.length < limit) {
      console.log('[Style Filtering] PASS 3: Final fallback (no filters)');
      const fallbackResults = await this.db
        .select(getTableColumns(artSessions))
        .from(artSessions)
        .leftJoin(
          userArtImpressions,
          and(
            eq(artSessions.id, userArtImpressions.artworkId),
            eq(userArtImpressions.userId, userId)
          )
        )
        .where(isNull(userArtImpressions.id))
        .orderBy(desc(artSessions.createdAt))
        .limit(limit - results.length);
      
      results = [...results, ...fallbackResults];
      console.log('[Style Filtering] PASS 3 added:', fallbackResults.length, 'total:', results.length);
    }
    
    console.log('[Style Filtering] Final result count:', results.length);
    return results.slice(0, limit); // Ensure we don't exceed limit
  }

  // CRITICAL FIX: Emergency fallback with randomization to prevent cycling same frames
  async getEmergencyFallbackArtworks(
    userId: string, 
    options?: {
      limit?: number;
      orientation?: string;
    }
  ): Promise<ArtSession[]> {
    const limit = options?.limit ?? 20;
    const orientation = options?.orientation;
    
    try {
      // Use ORDER BY RANDOM() for variety instead of same 2 frames every time
      const result = await this.db.execute<ArtSession>(sql`
        SELECT ${sql.join(Object.values(getTableColumns(artSessions)).map(column => sql.identifier(column.name)), sql`, `)}
        FROM ${artSessions}
        WHERE ${artSessions.imageUrl} IS NOT NULL
          ${orientation ? sql`AND ${artSessions.orientation} = ${orientation}` : sql``}
        ORDER BY RANDOM()
        LIMIT ${limit}
      `);
      
      console.log(`[EmergencyFallback] Retrieved ${result.rows.length} random artworks for variety`);
      return result.rows;
    } catch (error) {
      console.error('[EmergencyFallback] Random query failed:', error);
      // Last resort: return any artworks we can find
      try {
        const fallback = await this.db
          .select()
          .from(artSessions)
          .where(sql`${artSessions.imageUrl} IS NOT NULL`)
          .limit(limit);
        return fallback;
      } catch (e) {
        return [];
      }
    }
  }

  async getFreshArtworks(sessionId: string, userId: string, limit: number = 20): Promise<ArtSession[]> {
    // Fresh artwork: created in this session within last 15 minutes
    // BUG FIX #5: NOW FILTERS BY IMPRESSIONS - ensures "never repeat" guarantee
    // Fresh frames are prioritized but MUST respect user's viewed history
    const FRESH_WINDOW_MINUTES = 15; // Configurable freshness interval
    const freshWindowAgo = new Date(Date.now() - FRESH_WINDOW_MINUTES * 60 * 1000);
    
    // Count total fresh frames before filtering (for telemetry)
    const rawCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(artSessions)
      .where(
        and(
          eq(artSessions.sessionId, sessionId),
          gte(artSessions.createdAt, freshWindowAgo)
        )
      );
    
    const freshCountRaw = Number(rawCount[0]?.count ?? 0);
    
    // Apply impression filter using LEFT JOIN pattern (same as getUnseenArtworks)
    const results = await this.db
      .select(getTableColumns(artSessions))
      .from(artSessions)
      .leftJoin(
        userArtImpressions,
        and(
          eq(artSessions.id, userArtImpressions.artworkId),
          eq(userArtImpressions.userId, userId)
        )
      )
      .where(
        and(
          eq(artSessions.sessionId, sessionId),  // Session-scoped fresh queue
          gte(artSessions.createdAt, freshWindowAgo), // Last 15 min only
          isNull(userArtImpressions.id) // EXCLUDE SEEN FRAMES
        )
      )
      .orderBy(desc(artSessions.createdAt)) // Newest first
      .limit(limit);
    
    const freshCountAfterFilter = results.length;
    
    // Telemetry: Log filtering effectiveness
    if (freshCountRaw > 0) {
      console.log(`[Fresh Queue] Raw: ${freshCountRaw}, After Filter: ${freshCountAfterFilter}, Filtered Out: ${freshCountRaw - freshCountAfterFilter}`);
    }
    
    return results;
  }

  async getUserArtImpressions(userId: string): Promise<any[]> {
    return await this.db
      .select()
      .from(userArtImpressions)
      .where(eq(userArtImpressions.userId, userId));
  }

  async getCatalogueStats(): Promise<{
    total: number;
    byOrientation: { landscape: number; portrait: number; square: number };
    needsEnrichment: number;
  }> {
    // Total library artworks
    const totalResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(artSessions)
      .where(eq(artSessions.isLibrary, true));
    
    const total = Number(totalResult[0]?.count ?? 0);

    // By orientation
    const landscapeResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(artSessions)
      .where(and(eq(artSessions.isLibrary, true), eq(artSessions.orientation, "landscape")));
    
    const portraitResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(artSessions)
      .where(and(eq(artSessions.isLibrary, true), eq(artSessions.orientation, "portrait")));
    
    const squareResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(artSessions)
      .where(and(eq(artSessions.isLibrary, true), eq(artSessions.orientation, "square")));

    // Needs enrichment
    const needsEnrichmentResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(artSessions)
      .where(and(eq(artSessions.isLibrary, true), isNull(artSessions.focalPoints)));

    return {
      total,
      byOrientation: {
        landscape: Number(landscapeResult[0]?.count ?? 0),
        portrait: Number(portraitResult[0]?.count ?? 0),
        square: Number(squareResult[0]?.count ?? 0),
      },
      needsEnrichment: Number(needsEnrichmentResult[0]?.count ?? 0),
    };
  }

  async getLibraryArtworkCount(orientation: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(artSessions)
      .where(and(eq(artSessions.isLibrary, true), eq(artSessions.orientation, orientation)));
    
    return Number(result[0]?.count ?? 0);
  }

  async getUserViewedLibraryCount(userId: string, orientation: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(DISTINCT ${userArtImpressions.artworkId})` })
      .from(userArtImpressions)
      .innerJoin(artSessions, eq(userArtImpressions.artworkId, artSessions.id))
      .where(
        and(
          eq(userArtImpressions.userId, userId),
          eq(artSessions.isLibrary, true),
          eq(artSessions.orientation, orientation)
        )
      );
    
    return Number(result[0]?.count ?? 0);
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    const results = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return results[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const results = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return results[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const created = await this.db
      .insert(users)
      .values(insertUser)
      .returning();
    return created[0];
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // Build update set conditionally - only include fields that are actually defined
    // This prevents overwriting existing user data with null/undefined on re-auth
    const updateSet: Record<string, any> = { updatedAt: new Date() };
    
    if (userData.email !== undefined) updateSet.email = userData.email;
    if (userData.firstName !== undefined) updateSet.firstName = userData.firstName;
    if (userData.lastName !== undefined) updateSet.lastName = userData.lastName;
    if (userData.profileImageUrl !== undefined) updateSet.profileImageUrl = userData.profileImageUrl;
    if (userData.preferredOrientation !== undefined) updateSet.preferredOrientation = userData.preferredOrientation;
    if (userData.controllerState !== undefined) updateSet.controllerState = userData.controllerState;
    
    const created = await this.db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: updateSet,
      })
      .returning();
    return created[0];
  }

  async updateUserSubscription(
    id: string,
    tier: string,
    stripeCustomerId?: string,
    stripeSubscriptionId?: string
  ): Promise<User> {
    const existingUser = await this.getUser(id);
    if (!existingUser) {
      throw new Error("User not found");
    }

    const updated = await this.db
      .update(users)
      .set({
        subscriptionTier: tier,
        stripeCustomerId: stripeCustomerId ?? existingUser.stripeCustomerId,
        stripeSubscriptionId: stripeSubscriptionId ?? existingUser.stripeSubscriptionId,
      })
      .where(eq(users.id, id))
      .returning();
    
    return updated[0];
  }

  // Daily Usage
  async getDailyUsage(userId: string, date: string): Promise<DailyUsage | undefined> {
    const results = await this.db
      .select()
      .from(dailyUsage)
      .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.date, date)))
      .limit(1);
    return results[0];
  }

  async incrementDailyUsage(userId: string, date: string): Promise<DailyUsage> {
    const existing = await this.getDailyUsage(userId, date);

    if (existing) {
      const updated = await this.db
        .update(dailyUsage)
        .set({
          generationCount: existing.generationCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(dailyUsage.id, existing.id))
        .returning();
      return updated[0];
    }

    const created = await this.db
      .insert(dailyUsage)
      .values({
        userId,
        date,
        generationCount: 1,
      })
      .returning();
    return created[0];
  }

  async getUserDailyLimit(userId: string): Promise<number> {
    const user = await this.getUser(userId);
    if (!user) {
      return SUBSCRIPTION_TIERS.free.dailyLimit;
    }
    const tier = normalizeTierName(user.subscriptionTier);
    return SUBSCRIPTION_TIERS[tier].dailyLimit;
  }

  async checkDailyLimit(userId: string): Promise<{ canGenerate: boolean; count: number; limit: number }> {
    const today = new Date().toISOString().split('T')[0];
    const usage = await this.getDailyUsage(userId, today);
    const limit = await this.getUserDailyLimit(userId);
    const count = usage?.generationCount || 0;

    return {
      canGenerate: count < limit,
      count,
      limit,
    };
  }

  // ============================================================================
  // Monthly Credit System
  // ============================================================================

  async initializeUserCredits(userId: string, tier: string): Promise<UserCredits> {
    const tierKey = normalizeTierName(tier);
    const baseQuota = SUBSCRIPTION_TIERS[tierKey].dailyLimit * 30; // Convert daily to monthly
    
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    const existing = await this.db
      .select()
      .from(userCredits)
      .where(eq(userCredits.userId, userId))
      .limit(1);
    
    if (existing.length > 0) {
      return existing[0];
    }
    
    const [created] = await this.db
      .insert(userCredits)
      .values({
        userId,
        balance: baseQuota,
        rolloverBalance: 0,
        baseQuota,
        billingCycleStart: cycleStart,
        billingCycleEnd: cycleEnd,
        timezone: 'UTC',
      })
      .returning();
    
    await this.db.insert(creditLedger).values({
      userId,
      eventType: 'grant',
      amount: baseQuota,
      balanceAfter: baseQuota,
      description: 'Initial credit grant',
      metadata: JSON.stringify({ tier: tierKey }),
    });
    
    return created;
  }

  async getCreditsContext(userId: string): Promise<{
    balance: number;
    rolloverBalance: number;
    baseQuota: number;
    cycleStart: Date;
    cycleEnd: Date;
    daysRemaining: number;
  }> {
    const credits = await this.db
      .select()
      .from(userCredits)
      .where(eq(userCredits.userId, userId))
      .limit(1);
    
    if (credits.length === 0) {
      const user = await this.getUser(userId);
      const tier = user?.subscriptionTier || 'free';
      const initialized = await this.initializeUserCredits(userId, tier);
      credits.push(initialized);
    }
    
    const credit = credits[0];
    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil((credit.billingCycleEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    
    return {
      balance: credit.balance,
      rolloverBalance: credit.rolloverBalance,
      baseQuota: credit.baseQuota,
      cycleStart: credit.billingCycleStart,
      cycleEnd: credit.billingCycleEnd,
      daysRemaining,
    };
  }

  async deductCredit(userId: string, amount: number, metadata?: Record<string, any>): Promise<{ success: boolean; newBalance: number }> {
    return await this.db.transaction(async (tx) => {
      const idempotencyKey = metadata?.artworkId ? `artwork-${metadata.artworkId}-deduct` : undefined;
      
      if (idempotencyKey) {
        const existing = await tx
          .select()
          .from(creditLedger)
          .where(eq(creditLedger.idempotencyKey, idempotencyKey))
          .limit(1);
        
        if (existing.length > 0) {
          return { success: true, newBalance: existing[0].balanceAfter };
        }
      }
      
      const [credits] = await tx
        .select()
        .from(userCredits)
        .where(eq(userCredits.userId, userId))
        .limit(1);
      
      if (!credits) {
        throw new Error('User credits not initialized');
      }
      
      if (credits.balance < amount) {
        return { success: false, newBalance: credits.balance };
      }
      
      const newBalance = credits.balance - amount;
      
      await tx
        .update(userCredits)
        .set({ balance: newBalance, lastUpdated: new Date() })
        .where(eq(userCredits.userId, userId));
      
      await tx.insert(creditLedger).values({
        userId,
        eventType: 'deduct',
        amount: -amount,
        balanceAfter: newBalance,
        description: metadata?.description || 'Credit deduction',
        metadata: metadata ? JSON.stringify(metadata) : null,
        idempotencyKey,
      });
      
      return { success: true, newBalance };
    });
  }

  async refundCredit(userId: string, amount: number, reason: string, metadata?: Record<string, any>): Promise<{ success: boolean; newBalance: number }> {
    return await this.db.transaction(async (tx) => {
      const [credits] = await tx
        .select()
        .from(userCredits)
        .where(eq(userCredits.userId, userId))
        .limit(1);
      
      if (!credits) {
        throw new Error('User credits not initialized');
      }
      
      const newBalance = credits.balance + amount;
      
      await tx
        .update(userCredits)
        .set({ balance: newBalance, lastUpdated: new Date() })
        .where(eq(userCredits.userId, userId));
      
      await tx.insert(creditLedger).values({
        userId,
        eventType: 'refund',
        amount: amount,
        balanceAfter: newBalance,
        description: reason,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });
      
      return { success: true, newBalance };
    });
  }

  async getCreditHistory(userId: string, limit: number = 50): Promise<CreditLedger[]> {
    return await this.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId))
      .orderBy(desc(creditLedger.createdAt))
      .limit(limit);
  }

  // ============================================================================
  // Image Catalogue Manager
  // ============================================================================

  async getCatalogCoverage(userId: string, orientation?: string): Promise<{
    totalLibrary: number;
    unseenCount: number;
    unseenRatio: number;
    distinctStyles: number;
  }> {
    let libraryQuery = this.db
      .select({ id: artSessions.id })
      .from(artSessions)
      .where(eq(artSessions.isLibrary, true));
    
    if (orientation) {
      libraryQuery = this.db
        .select({ id: artSessions.id })
        .from(artSessions)
        .where(and(
          eq(artSessions.isLibrary, true),
          eq(artSessions.orientation, orientation)
        ));
    }
    
    const libraryArt = await libraryQuery;
    const totalLibrary = libraryArt.length;
    
    const viewedArt = await this.db
      .select({ artworkId: userArtImpressions.artworkId })
      .from(userArtImpressions)
      .where(eq(userArtImpressions.userId, userId));
    
    const viewedIds = new Set(viewedArt.map(v => v.artworkId));
    const unseenCount = libraryArt.filter(art => !viewedIds.has(art.id)).length;
    const unseenRatio = totalLibrary > 0 ? unseenCount / totalLibrary : 0;
    
    const stylesQuery = this.db
      .selectDistinct({ motif: sql<string>`unnest(motifs)` })
      .from(artSessions)
      .where(eq(artSessions.isLibrary, true));
    
    const styles = await stylesQuery;
    const distinctStyles = styles.filter(s => s.motif).length;
    
    return {
      totalLibrary,
      unseenCount,
      unseenRatio,
      distinctStyles,
    };
  }

  async getLibraryArtwork(userId: string, orientation?: string, styles?: string[], limit: number = 20): Promise<ArtSession[]> {
    const viewedArt = await this.db
      .select({ artworkId: userArtImpressions.artworkId })
      .from(userArtImpressions)
      .where(eq(userArtImpressions.userId, userId));
    
    const viewedIds = viewedArt.map(v => v.artworkId);
    
    let whereConditions = [eq(artSessions.isLibrary, true)];
    
    if (orientation) {
      whereConditions.push(eq(artSessions.orientation, orientation));
    }
    
    if (viewedIds.length > 0) {
      whereConditions.push(sql`${artSessions.id} NOT IN (${sql.join(viewedIds.map(id => sql`${id}`), sql`, `)})`);
    }
    
    if (styles && styles.length > 0) {
      whereConditions.push(sql`${artSessions.motifs} && ARRAY[${sql.join(styles.map(s => sql`${s}`), sql`, `)}]::text[]`);
    }
    
    return await this.db
      .select()
      .from(artSessions)
      .where(and(...whereConditions))
      .orderBy(sql`RANDOM()`)
      .limit(limit);
  }

  async getLibraryArtworkWithFallback(
    userId: string,
    options: {
      styleTags?: string[];
      artistTags?: string[];
      orientation?: string;
      excludeIds?: string[];
      limit?: number;
    }
  ): Promise<{
    artworks: ArtSession[];
    tier: 'exact' | 'related' | 'procedural' | 'global';
    latencyMs: number;
    proceduralData?: import('./procedural-bridge').ProceduralBridgeData;
  }> {
    const startTime = Date.now();
    const { 
      styleTags = [], 
      artistTags = [], 
      orientation, 
      excludeIds = [], 
      limit = 2 
    } = options;
    
    // Sanitize excludeIds (max 100 to protect query planner)
    const safeExcludeIds = excludeIds.slice(0, 100);
    
    // OPTIMIZATION: Fetch viewed artwork IDs once upfront (last 200) to avoid repeated NOT EXISTS
    const viewedArtworks = await this.db
      .select({ artworkId: userArtImpressions.artworkId })
      .from(userArtImpressions)
      .where(eq(userArtImpressions.userId, userId))
      .orderBy(desc(userArtImpressions.viewedAt))
      .limit(200);
    
    const viewedIds = viewedArtworks.map(v => v.artworkId);
    const combinedExcludeIds = [...safeExcludeIds, ...viewedIds].slice(0, 300); // Cap at 300 total
    
    // Each tier gets its own independent timing budget (reset before each tier)
    let tierStartTime = Date.now();
    const upfrontLatency = tierStartTime - startTime;
    
    // Early return: empty tags -> short-circuit to global tier
    if (styleTags.length === 0 && artistTags.length === 0) {
      const globalResults = await this.db.execute<ArtSession>(sql`
        SELECT ${sql.join(Object.values(getTableColumns(artSessions)).map(column => sql.identifier(column.name)), sql`, `)}
        FROM ${artSessions}
        WHERE ${artSessions.isLibrary} = true
          ${orientation ? sql`AND ${artSessions.orientation} = ${orientation}` : sql``}
          ${combinedExcludeIds.length > 0 ? sql`AND ${artSessions.id} NOT IN (${sql.join(combinedExcludeIds.map(id => sql`${id}`), sql`, `)})` : sql``}
        ORDER BY ${artSessions.createdAt} DESC
        LIMIT ${limit}
      `);
      
      const latencyMs = Date.now() - startTime;
      return { artworks: globalResults.rows, tier: 'global', latencyMs };
    }
    
    // Tier 1: Exact match (40ms budget - no transaction overhead!)
    tierStartTime = Date.now(); // Reset for this tier's independent budget
    if (true) { // Always attempt Tier-1
      try {
        const exactStyleArray = sql`ARRAY[${sql.join(styleTags.map(tag => sql`${tag}`), sql`, `)}]::text[]`;
        
        // Direct query without transaction wrapper - eliminates ~250ms HTTP overhead
        const tier1Results = await this.db.execute<ArtSession>(sql`
          SELECT ${sql.join(Object.values(getTableColumns(artSessions)).map(column => sql.identifier(column.name)), sql`, `)}
          FROM ${artSessions}
          WHERE ${artSessions.isLibrary} = true
            ${orientation ? sql`AND ${artSessions.orientation} = ${orientation}` : sql``}
            AND ${artSessions.styles} @> ${exactStyleArray}
            ${combinedExcludeIds.length > 0 ? sql`AND ${artSessions.id} NOT IN (${sql.join(combinedExcludeIds.map(id => sql`${id}`), sql`, `)})` : sql``}
          ORDER BY ${artSessions.createdAt} DESC
          LIMIT ${limit}
        `);
        
        console.log(`[CatalogueBridge Debug] Tier-1 query returned ${tier1Results.rows.length} results, elapsed=${Date.now() - tierStartTime}ms`);
        
        if (tier1Results.rows.length > 0) {
          const latencyMs = Date.now() - startTime; // Total latency including upfront fetch
          return { artworks: tier1Results.rows, tier: 'exact', latencyMs };
        }
      } catch (error: any) {
        // Timeout or query error - continue to Tier 2
        if (!error.message?.includes('timeout')) {
          console.error('Tier 1 query error:', error);
        }
      }
    }
    
    // Tier 2: Related styles (80ms budget - no transaction overhead!)
    tierStartTime = Date.now(); // Reset for this tier's independent budget
    if (true) { // Always attempt Tier-2
      try {
        const relatedStyleTags = expandStyles(styleTags);
        const exactStyleArray = sql`ARRAY[${sql.join(styleTags.map(tag => sql`${tag}`), sql`, `)}]::text[]`;
        const relatedStyleArray = sql`ARRAY[${sql.join(relatedStyleTags.map(tag => sql`${tag}`), sql`, `)}]::text[]`;
        
        // Direct query without transaction wrapper
        const tier2Results = await this.db.execute<ArtSession>(sql`
          SELECT ${sql.join(Object.values(getTableColumns(artSessions)).map(column => sql.identifier(column.name)), sql`, `)}
          FROM ${artSessions}
          WHERE ${artSessions.isLibrary} = true
            ${orientation ? sql`AND ${artSessions.orientation} = ${orientation}` : sql``}
            AND ${artSessions.styles} && ${relatedStyleArray}
            AND NOT (${artSessions.styles} @> ${exactStyleArray})
            ${combinedExcludeIds.length > 0 ? sql`AND ${artSessions.id} NOT IN (${sql.join(combinedExcludeIds.map(id => sql`${id}`), sql`, `)})` : sql``}
          ORDER BY ${artSessions.createdAt} DESC
          LIMIT ${limit}
        `);
        
        if (tier2Results.rows.length > 0) {
          const latencyMs = Date.now() - startTime;
          return { artworks: tier2Results.rows, tier: 'related', latencyMs };
        }
      } catch (error: any) {
        // Timeout or query error - continue to Tier 3
        if (!error.message?.includes('timeout')) {
          console.error('Tier 2 query error:', error);
        }
      }
    }
    
    // Tier 3: Global fallback (120ms budget, orientation filter dropped - no transaction overhead!)
    // Last chance to find library content before falling back to procedural bridge
    tierStartTime = Date.now(); // Reset for this tier's independent budget
    if (true) { // Always attempt Tier-3
      try {
        // Direct query without transaction wrapper
        const globalResults = await this.db.execute<ArtSession>(sql`
          SELECT ${sql.join(Object.values(getTableColumns(artSessions)).map(column => sql.identifier(column.name)), sql`, `)}
          FROM ${artSessions}
          WHERE ${artSessions.isLibrary} = true
            ${combinedExcludeIds.length > 0 ? sql`AND ${artSessions.id} NOT IN (${sql.join(combinedExcludeIds.map(id => sql`${id}`), sql`, `)})` : sql``}
          ORDER BY ${artSessions.createdAt} DESC
          LIMIT ${limit}
        `);
        
        // If global tier found results, return them
        if (globalResults.rows.length > 0) {
          const latencyMs = Date.now() - startTime;
          return { artworks: globalResults.rows, tier: 'global', latencyMs };
        }
      } catch (error: any) {
        // Timeout or query error - fall back to procedural
        if (!error.message?.includes('timeout')) {
          console.error('Tier 3 query error:', error);
        }
      }
    }
    
    // Tier 4: Procedural Bridge (ultimate fallback - no library content available at all)
    // Generate deterministic gradient parameters for instant display
    // This is only reached when:
    // - No exact matches (Tier 1)
    // - No related matches (Tier 2)  
    // - No global library artwork exists (Tier 3)
    // - OR we exceeded the 180ms timeout
    const proceduralData = generateProceduralBridge(styleTags, orientation);
    const proceduralLatencyMs = Date.now() - startTime;
    
    return {
      artworks: [],
      tier: 'procedural',
      latencyMs: proceduralLatencyMs,
      proceduralData
    };
  }

  // Storage Metrics
  async recordStorageMetric(metric: InsertStorageMetric): Promise<StorageMetric> {
    const created = await this.db
      .insert(storageMetrics)
      .values(metric)
      .returning();
    return created[0];
  }

  async getStorageMetrics(limit: number = 100): Promise<StorageMetric[]> {
    return await this.db
      .select()
      .from(storageMetrics)
      .orderBy(desc(storageMetrics.createdAt))
      .limit(limit);
  }

  async getStorageHealthStats(): Promise<{
    totalAttempts: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    avgVerificationTime: number;
    recentFailures: StorageMetric[];
  }> {
    // Get all metrics from last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const allMetrics = await this.db
      .select()
      .from(storageMetrics)
      .where(gte(storageMetrics.createdAt, sevenDaysAgo))
      .orderBy(desc(storageMetrics.createdAt));

    const totalAttempts = allMetrics.length;
    const successCount = allMetrics.filter(m => m.success).length;
    const failureCount = totalAttempts - successCount;
    const successRate = totalAttempts > 0 ? (successCount / totalAttempts) * 100 : 0;
    
    const verificationTimes = allMetrics
      .filter(m => m.verificationTimeMs !== null)
      .map(m => m.verificationTimeMs!);
    const avgVerificationTime = verificationTimes.length > 0
      ? verificationTimes.reduce((a, b) => a + b, 0) / verificationTimes.length
      : 0;

    const recentFailures = allMetrics
      .filter(m => !m.success)
      .slice(0, 10);

    return {
      totalAttempts,
      successCount,
      failureCount,
      successRate,
      avgVerificationTime,
      recentFailures,
    };
  }

  // ============================================================================
  // RAI Telemetry Methods (Phase 2)
  // ============================================================================

  async createRaiSession(userId: string | null, artworkId?: string, genomeId?: string): Promise<RaiSession> {
    const sessionData: InsertRaiSession = {
      userId,
      artworkId: artworkId || null,
      genomeId: genomeId || null,
      audioContext: null,
      visualContext: null,
      endedAt: null,
      durationSeconds: null,
    };

    const [session] = await this.db
      .insert(raiSessions)
      .values(sessionData)
      .returning();

    return session;
  }

  async endRaiSession(sessionId: string): Promise<void> {
    const session = await this.db
      .select()
      .from(raiSessions)
      .where(eq(raiSessions.id, sessionId))
      .limit(1);

    if (session.length === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const startedAt = session[0].startedAt;
    const endedAt = new Date();
    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

    await this.db
      .update(raiSessions)
      .set({
        endedAt,
        durationSeconds,
      })
      .where(eq(raiSessions.id, sessionId));
  }

  async createTelemetryEvents(events: InsertTelemetryEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.db.insert(telemetryEvents).values(events);
  }

  async getTelemetryEventsSince(cutoffTime: Date): Promise<TelemetryEvent[]> {
    try {
      const results = await this.db
        .select()
        .from(telemetryEvents)
        .where(sql`${telemetryEvents.timestamp} >= ${cutoffTime.toISOString()}`)
        .orderBy(telemetryEvents.timestamp);
      return results;
    } catch (error: any) {
      console.error('[PostgresStorage] Failed to query telemetry events:', error);
      return [];
    }
  }

  async getCatalogueBridgeTelemetry(cutoffTime: Date): Promise<TelemetryEvent[]> {
    try {
      const results = await this.db
        .select()
        .from(telemetryEvents)
        .where(
          and(
            sql`${telemetryEvents.timestamp} >= ${cutoffTime.toISOString()}`,
            sql`${telemetryEvents.eventType} LIKE 'catalogue_bridge%'`
          )
        )
        .orderBy(telemetryEvents.timestamp);
      return results;
    } catch (error: any) {
      console.error('[PostgresStorage] Failed to query catalogue bridge telemetry:', error);
      return [];
    }
  }

  async findOrCreateRaiSessionForClientSession(userId: string, clientSessionId: string): Promise<string> {
    try {
      // Look for existing RAI session with matching clientSessionId
      const existing = await this.db
        .select()
        .from(raiSessions)
        .where(
          and(
            eq(raiSessions.userId, userId),
            eq(raiSessions.clientSessionId, clientSessionId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        return existing[0].id;
      }

      // Create lightweight RAI session with clientSessionId
      const sessionData: InsertRaiSession = {
        userId,
        clientSessionId,
        artworkId: null,
        genomeId: null,
        audioContext: null,
        visualContext: null,
        endedAt: null,
        durationSeconds: null,
      };

      const [session] = await this.db
        .insert(raiSessions)
        .values(sessionData)
        .returning();

      return session.id;
    } catch (error: any) {
      console.error('[PostgresStorage] Failed to find/create RAI session:', error);
      throw error; // Propagate error instead of silent fallback
    }
  }

  // ============================================================================
  // Generation Jobs (Hybrid gen+retrieve)
  // ============================================================================

  async createGenerationJob(job: InsertGenerationJob): Promise<GenerationJob> {
    const [created] = await this.db
      .insert(generationJobs)
      .values(job)
      .returning();
    return created;
  }

  async getGenerationJob(id: string): Promise<GenerationJob | undefined> {
    const results = await this.db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, id))
      .limit(1);
    return results[0];
  }

  async updateGenerationJob(id: string, updates: Partial<GenerationJob>): Promise<GenerationJob> {
    const [updated] = await this.db
      .update(generationJobs)
      .set(updates)
      .where(eq(generationJobs.id, id))
      .returning();
    return updated;
  }

  async getPoolCandidates(userId: string, limit: number = 20, minQuality: number = 35): Promise<ArtSession[]> {
    // Build conditional where clauses
    const whereConditions = [
      isNull(userArtImpressions.id), // Unseen only
      or(eq(artSessions.poolStatus, 'active'), isNull(artSessions.poolStatus)), // Active or legacy (NULL) pool items
    ];
    
    // Add quality filter if specified
    if (minQuality > 0) {
      whereConditions.push(gte(artSessions.qualityScore, minQuality));
    }
    
    // Query unseen artworks with optional quality filter
    const results = await this.db
      .select(getTableColumns(artSessions))
      .from(artSessions)
      .leftJoin(
        userArtImpressions,
        and(
          eq(artSessions.id, userArtImpressions.artworkId),
          eq(userArtImpressions.userId, userId)
        )
      )
      .where(and(...whereConditions))
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
    
    return results;
  }

  async getCatalogCandidates(userId: string, styleTags: string[], limit: number = 200): Promise<ArtSession[]> {
    // Guard: Empty tags would return all unseen artworks (defeats catalog matching)
    if (!styleTags || styleTags.length === 0) {
      return [];
    }

    // Build array literal for SQL with proper typing
    const tagArray = sql`array[${sql.join(styleTags.map(tag => sql`${tag}`), sql`, `)}]::text[]`;
    
    // Query unseen artworks with array overlap on motifs
    const results = await this.db
      .select(getTableColumns(artSessions))
      .from(artSessions)
      .leftJoin(
        userArtImpressions,
        and(
          eq(artSessions.id, userArtImpressions.artworkId),
          eq(userArtImpressions.userId, userId)
        )
      )
      .where(
        and(
          isNull(userArtImpressions.id), // Never-repeat: exclude seen
          sql<boolean>`coalesce(${artSessions.motifs}, '{}') && ${tagArray}` // Array overlap with NULL safety
        )
      )
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
    
    return results;
  }
  
  // Queue management methods (for Queue Controller)
  async getFreshQueueSize(sessionId: string): Promise<number> {
    // Count fresh, unconsumed artworks for this session
    // Consider "fresh" as artworks created in last hour that haven't been marked as consumed
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const result = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(artSessions)
      .where(
        and(
          eq(artSessions.sessionId, sessionId),
          gte(artSessions.createdAt, hourAgo),
          // Could add a 'consumed' flag in the future for more accurate tracking
        )
      );
    
    return Number(result[0]?.count ?? 0);
  }
  
  async getQueueMetrics(sessionId: string): Promise<{
    freshCount: number;
    totalCount: number;
    oldestTimestamp: Date | null;
    consumptionRate: number;
    generationRate: number;
  }> {
    // Get total count and oldest timestamp for this session
    const sessionStats = await this.db
      .select({
        totalCount: sql<number>`COUNT(*)`,
        oldestTimestamp: sql<Date | null>`MIN(${artSessions.createdAt})`,
      })
      .from(artSessions)
      .where(eq(artSessions.sessionId, sessionId));
    
    // Get fresh count (last hour)
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const freshResult = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(artSessions)
      .where(
        and(
          eq(artSessions.sessionId, sessionId),
          gte(artSessions.createdAt, hourAgo)
        )
      );
    
    // Calculate generation rate (last minute)
    const minuteAgo = new Date(Date.now() - 60 * 1000);
    const recentGenResult = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(artSessions)
      .where(
        and(
          eq(artSessions.sessionId, sessionId),
          gte(artSessions.createdAt, minuteAgo)
        )
      );
    
    // Note: Consumption rate would require tracking actual consumption events
    // For now, we'll estimate based on impression records
    const recentConsumptionResult = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(userArtImpressions)
      .innerJoin(artSessions, eq(userArtImpressions.artworkId, artSessions.id))
      .where(
        and(
          eq(artSessions.sessionId, sessionId),
          gte(userArtImpressions.viewedAt, minuteAgo)
        )
      );
    
    return {
      freshCount: Number(freshResult[0]?.count ?? 0),
      totalCount: Number(sessionStats[0]?.totalCount ?? 0),
      oldestTimestamp: sessionStats[0]?.oldestTimestamp ?? null,
      consumptionRate: Number(recentConsumptionResult[0]?.count ?? 0), // Frames consumed per minute
      generationRate: Number(recentGenResult[0]?.count ?? 0), // Frames generated per minute
    };
  }
}

// Use PostgreSQL storage if DATABASE_URL is available, otherwise fallback to MemStorage
export const storage = process.env.DATABASE_URL 
  ? new PostgresStorage() 
  : new MemStorage();

console.log(`[Storage] Initialized: ${storage instanceof PostgresStorage ? 'PostgresStorage' : 'MemStorage'} (DATABASE_URL=${!!process.env.DATABASE_URL})`);
