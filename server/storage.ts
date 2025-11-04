import { 
  type ArtPreference, 
  type InsertArtPreference,
  type ArtVote,
  type InsertArtVote,
  type ArtSession,
  type InsertArtSession,
  type User,
  type InsertUser
} from "@shared/schema";
import { randomUUID } from "crypto";

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
  
  // Users (for subscription management)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
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
      isActive: true,
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
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

export const storage = new MemStorage();
