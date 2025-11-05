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
  artPreferences,
  artVotes,
  artSessions,
  users,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq, desc, and } from "drizzle-orm";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

export interface IStorage {
  // Art Preferences
  getPreferencesBySession(sessionId: string): Promise<ArtPreference | undefined>;
  createOrUpdatePreferences(sessionId: string, styles: string[], artists: string[]): Promise<ArtPreference>;
  
  // Art Votes
  getVotesBySession(sessionId: string): Promise<ArtVote[]>;
  createVote(vote: InsertArtVote): Promise<ArtVote>;
  
  // Art Sessions
  createArtSession(session: InsertArtSession): Promise<ArtSession>;
  getSessionHistory(sessionId: string, limit?: number): Promise<ArtSession[]>;
  getUserSavedArt(userId: string, limit?: number): Promise<ArtSession[]>;
  toggleArtSaved(artId: string, userId: string): Promise<ArtSession>;
  deleteArt(artId: string, userId: string): Promise<void>;
  
  // Users (for subscription management and authentication)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>; // For Replit Auth
  updateUserSubscription(id: string, tier: string, stripeCustomerId?: string, stripeSubscriptionId?: string): Promise<User>;
}

export class MemStorage implements IStorage {
  private preferences: Map<string, ArtPreference>;
  private votes: Map<string, ArtVote>;
  private sessions: Map<string, ArtSession>;
  private users: Map<string, User>;

  constructor() {
    this.preferences = new Map();
    this.votes = new Map();
    this.sessions = new Map();
    this.users = new Map();
  }

  // Art Preferences
  async getPreferencesBySession(sessionId: string): Promise<ArtPreference | undefined> {
    return Array.from(this.preferences.values()).find(
      (pref) => pref.sessionId === sessionId
    );
  }

  async createOrUpdatePreferences(sessionId: string, styles: string[], artists: string[]): Promise<ArtPreference> {
    const existing = await this.getPreferencesBySession(sessionId);
    
    if (existing) {
      const updated: ArtPreference = {
        ...existing,
        styles,
        artists,
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
    artists: string[]
  ): Promise<ArtPreference> {
    const existing = await this.getPreferencesBySession(sessionId);

    if (existing) {
      const updated = await this.db
        .update(artPreferences)
        .set({ styles, artists })
        .where(eq(artPreferences.id, existing.id))
        .returning();
      return updated[0];
    }

    const created = await this.db
      .insert(artPreferences)
      .values({ sessionId, styles, artists })
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
}

// Use PostgreSQL storage if DATABASE_URL is available, otherwise fallback to MemStorage
export const storage = process.env.DATABASE_URL 
  ? new PostgresStorage() 
  : new MemStorage();
