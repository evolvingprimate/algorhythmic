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
  artPreferences,
  artVotes,
  artSessions,
  users,
  dailyUsage,
  storageMetrics,
  SUBSCRIPTION_TIERS,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq, desc, and, gte } from "drizzle-orm";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

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
  
  // Users (for subscription management and authentication)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>; // For Replit Auth
  updateUserSubscription(id: string, tier: string, stripeCustomerId?: string, stripeSubscriptionId?: string): Promise<User>;
  
  // Daily Usage
  getDailyUsage(userId: string, date: string): Promise<DailyUsage | undefined>;
  incrementDailyUsage(userId: string, date: string): Promise<DailyUsage>;
  getUserDailyLimit(userId: string): Promise<number>;
  checkDailyLimit(userId: string): Promise<{ canGenerate: boolean; count: number; limit: number }>;
  
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
    const id = randomUUID();
    const session: ArtSession = {
      id,
      ...insertSession,
      userId: insertSession.userId || null,
      audioFeatures: insertSession.audioFeatures || null,
      musicTrack: insertSession.musicTrack || null,
      musicArtist: insertSession.musicArtist || null,
      musicGenre: insertSession.musicGenre || null,
      musicAlbum: insertSession.musicAlbum || null,
      generationExplanation: insertSession.generationExplanation || null,
      isSaved: insertSession.isSaved || false,
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
    const created = await this.db
      .insert(artSessions)
      .values(insertSession)
      .returning();
    return created[0];
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
    const created = await this.db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
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
}

// Use PostgreSQL storage if DATABASE_URL is available, otherwise fallback to MemStorage
export const storage = process.env.DATABASE_URL 
  ? new PostgresStorage() 
  : new MemStorage();
