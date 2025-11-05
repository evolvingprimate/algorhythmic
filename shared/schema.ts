import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User preferences for art styles
export const artPreferences = pgTable("art_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  styles: text("styles").array().notNull().default(sql`'{}'::text[]`),
  artists: text("artists").array().notNull().default(sql`'{}'::text[]`),
  dynamicMode: boolean("dynamic_mode").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sessionIdIdx: index("art_preferences_session_id_idx").on(table.sessionId),
}));

// Voting history for generated art
export const artVotes = pgTable("art_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  artPrompt: text("art_prompt").notNull(),
  vote: integer("vote").notNull(), // 1 for upvote, -1 for downvote
  audioCharacteristics: text("audio_characteristics"), // JSON string of audio features
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sessionIdIdx: index("art_votes_session_id_idx").on(table.sessionId),
}));

// Generated art sessions
export const artSessions = pgTable("art_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  userId: varchar("user_id"),
  imageUrl: text("image_url").notNull(),
  prompt: text("prompt").notNull(),
  audioFeatures: text("audio_features"), // JSON string
  musicTrack: text("music_track"), // Identified song title
  musicArtist: text("music_artist"), // Identified artist
  musicGenre: text("music_genre"), // Identified genre
  musicAlbum: text("music_album"), // Album name
  generationExplanation: text("generation_explanation"), // Why this image was created
  isSaved: boolean("is_saved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sessionIdIdx: index("art_sessions_session_id_idx").on(table.sessionId),
  userIdIdx: index("art_sessions_user_id_idx").on(table.userId),
}));

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: text("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => ({
    expireIdx: index("IDX_session_expire").on(table.expire),
  })
);

// Subscription users (updated for Replit Auth compatibility)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  subscriptionTier: text("subscription_tier").notNull().default("free"), // free, premium, ultimate
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
  updatedAt: true,
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

// Replit Auth specific type
export type UpsertUser = typeof users.$inferInsert;

// Audio analysis result type
export type AudioAnalysis = {
  frequency: number;
  amplitude: number;
  tempo: number;
  bassLevel: number;
  trebleLevel: number;
  mood: "energetic" | "calm" | "dramatic" | "playful" | "melancholic";
};

// Music identification result type
export type MusicIdentification = {
  title: string;
  artist: string;
  album?: string;
  albumArtworkUrl?: string;
  release_date?: string;
  label?: string;
  timecode?: string;
  song_link?: string;
  apple_music?: {
    previews?: Array<{ url: string }>;
    url?: string;
  };
  spotify?: {
    album?: { id: string };
    id?: string;
  };
};

// Art generation request type
export type ArtGenerationRequest = {
  sessionId: string;
  audioAnalysis: AudioAnalysis;
  musicInfo?: MusicIdentification | null;
  preferences: {
    styles: string[];
    artists: string[];
  };
  previousVotes?: Array<{
    prompt: string;
    vote: number;
  }>;
};
