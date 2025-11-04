import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User preferences for art styles
export const artPreferences = pgTable("art_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  styles: text("styles").array().notNull().default(sql`'{}'::text[]`),
  artists: text("artists").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Voting history for generated art
export const artVotes = pgTable("art_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  artPrompt: text("art_prompt").notNull(),
  vote: integer("vote").notNull(), // 1 for upvote, -1 for downvote
  audioCharacteristics: text("audio_characteristics"), // JSON string of audio features
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Generated art sessions
export const artSessions = pgTable("art_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  imageUrl: text("image_url").notNull(),
  prompt: text("prompt").notNull(),
  audioFeatures: text("audio_features"), // JSON string
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Subscription users
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  subscriptionTier: text("subscription_tier").notNull().default("free"), // free, premium, ultimate
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Insert schemas
export const insertArtPreferenceSchema = createInsertSchema(artPreferences).omit({
  id: true,
  createdAt: true,
});

export const insertArtVoteSchema = createInsertSchema(artVotes).omit({
  id: true,
  createdAt: true,
});

export const insertArtSessionSchema = createInsertSchema(artSessions).omit({
  id: true,
  createdAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  isActive: true,
});

// Types
export type ArtPreference = typeof artPreferences.$inferSelect;
export type InsertArtPreference = z.infer<typeof insertArtPreferenceSchema>;

export type ArtVote = typeof artVotes.$inferSelect;
export type InsertArtVote = z.infer<typeof insertArtVoteSchema>;

export type ArtSession = typeof artSessions.$inferSelect;
export type InsertArtSession = z.infer<typeof insertArtSessionSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// Audio analysis result type
export type AudioAnalysis = {
  frequency: number;
  amplitude: number;
  tempo: number;
  bassLevel: number;
  trebleLevel: number;
  mood: "energetic" | "calm" | "dramatic" | "playful" | "melancholic";
};

// Art generation request type
export type ArtGenerationRequest = {
  sessionId: string;
  audioAnalysis: AudioAnalysis;
  preferences: {
    styles: string[];
    artists: string[];
  };
  previousVotes?: Array<{
    prompt: string;
    vote: number;
  }>;
};
