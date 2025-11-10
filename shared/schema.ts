import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
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

// Generated art sessions (extended with ImagePool metadata for hybrid gen+retrieve)
export const artSessions = pgTable("art_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  userId: varchar("user_id"),
  imageUrl: text("image_url").notNull(),
  prompt: text("prompt").notNull(),
  dnaVector: text("dna_vector"), // JSON string of 50-point DNA vector for morphing
  audioFeatures: text("audio_features"), // JSON string
  musicTrack: text("music_track"), // Identified song title
  musicArtist: text("music_artist"), // Identified artist
  musicGenre: text("music_genre"), // Identified genre
  musicAlbum: text("music_album"), // Album name
  generationExplanation: text("generation_explanation"), // Why this image was created
  isSaved: boolean("is_saved").notNull().default(false),
  // ImagePool metadata (optional fields for hybrid gen+retrieve system)
  motifs: text("motifs").array().default(sql`'{}'::text[]`), // Extracted visual themes: ["bell", "storm", "silhouette"]
  qualityScore: integer("quality_score").default(50), // 0-100 aesthetic score (default 50)
  perceptualHash: varchar("perceptual_hash"), // pHash/dHash for deduplication
  poolStatus: varchar("pool_status").default("active"), // active, archived, pending
  lastUsedAt: timestamp("last_used_at"), // For LRU eviction
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sessionIdIdx: index("art_sessions_session_id_idx").on(table.sessionId),
  userIdIdx: index("art_sessions_user_id_idx").on(table.userId),
  qualityScoreIdx: index("art_sessions_quality_score_idx").on(table.qualityScore),
  poolStatusIdx: index("art_sessions_pool_status_idx").on(table.poolStatus),
}));

// User favorites for weighted rotation (future feature)
export const artFavorites = pgTable("art_favorites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  artworkId: varchar("artwork_id").notNull().references(() => artSessions.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("art_favorites_user_id_idx").on(table.userId),
  artworkIdIdx: index("art_favorites_artwork_id_idx").on(table.artworkId),
  uniqueUserArtwork: uniqueIndex("art_favorites_unique_user_artwork").on(table.userId, table.artworkId),
}));

// User art impressions - Tracks which artworks each user has viewed
// CRITICAL for "never see the same frame twice" guarantee
// PHASE 1 STYLE SWITCHING: Added bridgeAt for catalog bridge tracking
export const userArtImpressions = pgTable("user_art_impressions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  artworkId: varchar("artwork_id").notNull().references(() => artSessions.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
  bridgeAt: timestamp("bridge_at"), // Nullable: set when shown as catalog bridge for style transition
}, (table) => ({
  userIdIdx: index("user_art_impressions_user_id_idx").on(table.userId),
  artworkIdIdx: index("user_art_impressions_artwork_id_idx").on(table.artworkId),
  uniqueUserArtwork: uniqueIndex("user_art_impressions_unique_user_artwork").on(table.userId, table.artworkId),
  viewedAtIdx: index("user_art_impressions_viewed_at_idx").on(table.viewedAt),
  // Composite index for efficient 7-day freshness queries (LEFT JOIN + range filter)
  userViewedCompositeIdx: index("user_art_impressions_user_viewed_idx").on(table.userId, table.viewedAt),
  bridgeAtIdx: index("user_art_impressions_bridge_at_idx").on(table.bridgeAt),
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
  subscriptionTier: text("subscription_tier").notNull().default("free"), // free, premium, ultimate, enthusiast, business_basic, business_premium
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Daily usage tracking for image generations
export const dailyUsage = pgTable("daily_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: varchar("date").notNull(), // Format: YYYY-MM-DD
  generationCount: integer("generation_count").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userDateIdx: index("daily_usage_user_date_idx").on(table.userId, table.date),
}));

// Storage metrics for monitoring object storage reliability
export const storageMetrics = pgTable("storage_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  fileName: text("file_name").notNull(), // artwork-{uuid}.png
  fileSize: integer("file_size"), // Bytes
  dalleUrl: text("dalle_url"), // Original DALL-E URL (for debugging)
  storageUrl: text("storage_url"), // Final /public-objects/ URL
  attemptCount: integer("attempt_count").notNull().default(1), // Number of retries
  success: boolean("success").notNull(), // True if final verification passed
  verificationTimeMs: integer("verification_time_ms"), // Total time for download + upload + verify
  errorMessage: text("error_message"), // Error details if failed
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  successIdx: index("storage_metrics_success_idx").on(table.success),
  createdAtIdx: index("storage_metrics_created_at_idx").on(table.createdAt),
  userIdIdx: index("storage_metrics_user_id_idx").on(table.userId),
}));

// Generation Jobs - Hybrid gen+retrieve job tracking
export const generationJobs = pgTable("generation_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  warmStartArtworkId: varchar("warm_start_artwork_id").references(() => artSessions.id, { onDelete: "set null" }),
  generatedArtworkId: varchar("generated_artwork_id").references(() => artSessions.id, { onDelete: "set null" }),
  audioContext: text("audio_context"), // JSON: {musicId, audioFeatures, targetDNA, motifs}
  status: varchar("status").notNull().default("pending"), // pending, processing, completed, failed
  attemptCount: integer("attempt_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  userIdIdx: index("generation_jobs_user_id_idx").on(table.userId),
  statusIdx: index("generation_jobs_status_idx").on(table.status),
  createdAtIdx: index("generation_jobs_created_at_idx").on(table.createdAt),
}));

// ============================================================================
// PHASE 2: RAI (Real-time Aesthetic Intelligence) Tables
// ============================================================================

// RAI Sessions - Maestro playback sessions for telemetry grouping
export const raiSessions = pgTable("rai_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  artworkId: varchar("artwork_id").references(() => artSessions.id, { onDelete: "set null" }),
  genomeId: varchar("genome_id"), // Reference to dna_genomes.id (nullable for initial sessions)
  audioContext: text("audio_context"), // JSON: {bpm, energy, mood, musicTrack}
  visualContext: text("visual_context"), // JSON: {style, palette, effectsActive}
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  durationSeconds: integer("duration_seconds"),
}, (table) => ({
  userIdIdx: index("rai_sessions_user_id_idx").on(table.userId),
  artworkIdIdx: index("rai_sessions_artwork_id_idx").on(table.artworkId),
  genomeIdIdx: index("rai_sessions_genome_id_idx").on(table.genomeId),
  startedAtIdx: index("rai_sessions_started_at_idx").on(table.startedAt),
}));

// Telemetry Events - Append-only log of all user/system events
export const telemetryEvents = pgTable("telemetry_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => raiSessions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // session_start, session_end, artwork_impression, user_action, control_adjustment, climax_detected, vision_analyzed
  eventData: text("event_data").notNull(), // JSON: type-specific payload
  audioFeatures: text("audio_features"), // JSON snapshot: {rms, onsetStrength, beatConfidence, bpm}
  visualState: text("visual_state"), // JSON snapshot: {currentFrame, effectsActive, parameterValues}
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ({
  sessionIdIdx: index("telemetry_events_session_id_idx").on(table.sessionId),
  eventTypeIdx: index("telemetry_events_event_type_idx").on(table.eventType),
  timestampIdx: index("telemetry_events_timestamp_idx").on(table.timestamp),
  userIdIdx: index("telemetry_events_user_id_idx").on(table.userId),
}));

// DNA Genomes - Baseline and evolved genome definitions
export const dnaGenomes = pgTable("dna_genomes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  artworkId: varchar("artwork_id").references(() => artSessions.id, { onDelete: "cascade" }),
  parentGenomeIds: text("parent_genome_ids").array(), // For crossover tracking
  generation: integer("generation").notNull().default(0), // 0 = baseline, >0 = evolved
  dnaVector: text("dna_vector").notNull(), // JSON: 50-point genome
  visualTraits: text("visual_traits").notNull(), // JSON: {palette, motion, complexity, energy}
  audioReactivity: text("audio_reactivity"), // JSON: parameter response curves
  fitnessScore: integer("fitness_score"), // Engagement-based fitness (0-1000)
  impressionCount: integer("impression_count").notNull().default(0),
  likeCount: integer("like_count").notNull().default(0),
  skipCount: integer("skip_count").notNull().default(0),
  avgViewDuration: integer("avg_view_duration"), // Seconds
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastEvaluated: timestamp("last_evaluated"), // Last fitness calculation
}, (table) => ({
  artworkIdIdx: index("dna_genomes_artwork_id_idx").on(table.artworkId),
  generationIdx: index("dna_genomes_generation_idx").on(table.generation),
  fitnessScoreIdx: index("dna_genomes_fitness_score_idx").on(table.fitnessScore),
  createdAtIdx: index("dna_genomes_created_at_idx").on(table.createdAt),
}));

// Trend Weights - Time-bucketed parameter preference matrices
export const trendWeights = pgTable("trend_weights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timeBucket: text("time_bucket").notNull(), // hourly, daily, weekly
  bucketStart: timestamp("bucket_start").notNull(),
  bucketEnd: timestamp("bucket_end").notNull(),
  moodCategory: text("mood_category"), // energetic, calm, dramatic, playful, melancholic
  parameterWeights: text("parameter_weights").notNull(), // JSON: {particles.spawnRate: {mean, stddev, trend}, ...}
  genomePreferences: text("genome_preferences"), // JSON: ranked genome IDs by popularity
  sampleSize: integer("sample_size").notNull(), // Number of events used
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  timeBucketIdx: index("trend_weights_time_bucket_idx").on(table.timeBucket, table.bucketStart),
  moodCategoryIdx: index("trend_weights_mood_category_idx").on(table.moodCategory),
  createdAtIdx: index("trend_weights_created_at_idx").on(table.createdAt),
}));

// Engagement Rollups - Nightly aggregated metrics
export const engagementRollups = pgTable("engagement_rollups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: varchar("date").notNull(), // YYYY-MM-DD
  genomeId: varchar("genome_id").references(() => dnaGenomes.id, { onDelete: "cascade" }),
  artworkId: varchar("artwork_id").references(() => artSessions.id, { onDelete: "cascade" }),
  impressions: integer("impressions").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  skips: integer("skips").notNull().default(0),
  totalViewDuration: integer("total_view_duration").notNull().default(0), // Seconds
  avgViewDuration: integer("avg_view_duration"), // Seconds
  controlAdjustments: integer("control_adjustments").notNull().default(0),
  engagementScore: integer("engagement_score"), // Weighted composite (0-100)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  dateIdx: index("engagement_rollups_date_idx").on(table.date),
  genomeIdIdx: index("engagement_rollups_genome_id_idx").on(table.genomeId),
  artworkIdIdx: index("engagement_rollups_artwork_id_idx").on(table.artworkId),
  engagementScoreIdx: index("engagement_rollups_engagement_score_idx").on(table.engagementScore),
}));

// User DNA Profiles - Personal preference evolution per user
export const userDnaProfiles = pgTable("user_dna_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  preferredMoods: text("preferred_moods").array(), // [energetic, calm, ...]
  preferredStyles: text("preferred_styles").array(), // Style IDs
  preferredGenomes: text("preferred_genomes").array(), // Genome IDs
  parameterBias: text("parameter_bias"), // JSON: {particles.spawnRate: +20%, warp.elasticity: -10%}
  likedTraits: text("liked_traits"), // JSON: {palette: [warm, vibrant], motion: [smooth, fast]}
  sessionCount: integer("session_count").notNull().default(0),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: uniqueIndex("user_dna_profiles_user_id_unique").on(table.userId),
  lastUpdatedIdx: index("user_dna_profiles_last_updated_idx").on(table.lastUpdated),
}));

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

export const insertDailyUsageSchema = createInsertSchema(dailyUsage).omit({
  id: true,
  updatedAt: true,
});

export const insertStorageMetricSchema = createInsertSchema(storageMetrics).omit({
  id: true,
  createdAt: true,
});

export const insertArtFavoriteSchema = createInsertSchema(artFavorites).omit({
  id: true,
  createdAt: true,
});

// RAI insert schemas
export const insertRaiSessionSchema = createInsertSchema(raiSessions).omit({
  id: true,
  startedAt: true,
});

export const insertTelemetryEventSchema = createInsertSchema(telemetryEvents).omit({
  id: true,
  timestamp: true,
});

export const insertDnaGenomeSchema = createInsertSchema(dnaGenomes).omit({
  id: true,
  createdAt: true,
});

export const insertTrendWeightSchema = createInsertSchema(trendWeights).omit({
  id: true,
  createdAt: true,
});

export const insertEngagementRollupSchema = createInsertSchema(engagementRollups).omit({
  id: true,
  createdAt: true,
});

export const insertUserDnaProfileSchema = createInsertSchema(userDnaProfiles).omit({
  id: true,
  createdAt: true,
  lastUpdated: true,
});

export const insertGenerationJobSchema = createInsertSchema(generationJobs).omit({
  id: true,
  createdAt: true,
});

// Audio Context DTO for hybrid gen+retrieve
export const audioContextSchema = z.object({
  musicId: z.object({
    track: z.string().optional(),
    artist: z.string().optional(),
    album: z.string().optional(),
    genre: z.string().optional(),
  }).optional(),
  audioFeatures: z.object({
    rms: z.number().optional(),
    spectralCentroid: z.number().optional(),
    tempo: z.number().optional(),
    energy: z.number().optional(),
    mood: z.string().optional(),
  }).optional(),
  targetDNA: z.array(z.number()).length(50).optional(),
  motifs: z.array(z.string()).optional(),
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

export type DailyUsage = typeof dailyUsage.$inferSelect;
export type InsertDailyUsage = z.infer<typeof insertDailyUsageSchema>;

export type StorageMetric = typeof storageMetrics.$inferSelect;
export type InsertStorageMetric = z.infer<typeof insertStorageMetricSchema>;

export type ArtFavorite = typeof artFavorites.$inferSelect;
export type InsertArtFavorite = z.infer<typeof insertArtFavoriteSchema>;

// RAI types
export type RaiSession = typeof raiSessions.$inferSelect;
export type InsertRaiSession = z.infer<typeof insertRaiSessionSchema>;

export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
export type InsertTelemetryEvent = z.infer<typeof insertTelemetryEventSchema>;

export type DnaGenome = typeof dnaGenomes.$inferSelect;
export type InsertDnaGenome = z.infer<typeof insertDnaGenomeSchema>;

export type TrendWeight = typeof trendWeights.$inferSelect;
export type InsertTrendWeight = z.infer<typeof insertTrendWeightSchema>;

export type EngagementRollup = typeof engagementRollups.$inferSelect;
export type InsertEngagementRollup = z.infer<typeof insertEngagementRollupSchema>;

export type UserDnaProfile = typeof userDnaProfiles.$inferSelect;
export type InsertUserDnaProfile = z.infer<typeof insertUserDnaProfileSchema>;

export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertGenerationJob = z.infer<typeof insertGenerationJobSchema>;

export type AudioContext = z.infer<typeof audioContextSchema>;

// Replit Auth specific type
export type UpsertUser = typeof users.$inferInsert;

// Subscription tier configuration
export const SUBSCRIPTION_TIERS = {
  free: { name: "Free", dailyLimit: 3, price: 0 },
  premium: { name: "Premium", dailyLimit: 10, price: 14.99 },
  ultimate: { name: "Ultimate", dailyLimit: 999999, price: 19.99 },
  enthusiast: { name: "Enthusiast", dailyLimit: 50, price: 49.99 },
  business_basic: { name: "Business Basic", dailyLimit: 100, price: 199.99 },
  business_premium: { name: "Business Premium", dailyLimit: 300, price: 499 },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// Audio analysis result type
export type AudioAnalysis = {
  frequency: number;
  amplitude: number;
  tempo: number;
  bassLevel: number;
  trebleLevel: number;
  mood: "energetic" | "calm" | "dramatic" | "playful" | "melancholic";
  spectralCentroid?: number;
  confidence?: number;
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

// Generation Context for Fallback System (3-tier: MUSIC_ID → AUDIO_ONLY → STYLE_ONLY)
export type GenerationProvenance = 'MUSIC_ID' | 'AUDIO_ONLY' | 'STYLE_ONLY';

export type GenerationContext = {
  provenance: GenerationProvenance;
  musicInfo?: MusicIdentification;
  audioAnalysis?: AudioAnalysis;
  stylePreferences: {
    styles: string[];
    autoGenerate: boolean;
    votingHistory?: {
      upvoted: string[];
      downvoted: string[];
    };
  };
  timestamp: Date;
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
