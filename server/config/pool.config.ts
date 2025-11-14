/**
 * Pool management constants - Single source of truth
 * Tunable parameters for async generation triggers and monitoring
 */

export const POOL_CONFIG = {
  // Route-level thresholds (for /api/artworks/next)
  MIN_POOL_THRESHOLD: 5,        // Trigger needsGeneration flag
  JOBS_PER_TRIGGER: 4,           // Jobs to enqueue when threshold hit

  // Monitor-level thresholds (for PoolMonitor)
  PRE_GENERATION_THRESHOLD: 0.85,  // 85% coverage triggers pre-gen
  CRITICAL_THRESHOLD: 0.95,        // 95% coverage = critical alert
  TARGET_POOL_SIZE: 10,            // Target frames per session
  MIN_POOL_SIZE: 2,                // Minimum frames (MorphEngine needs 2)
  PRE_GEN_BATCH_SIZE: 5,           // Frames per pre-gen batch

  // Timing and limits (from pool-monitor.ts)
  MONITOR_INTERVAL_MS: 30000,           // 30s monitoring interval
  CONSUMPTION_WINDOW_MS: 300000,        // 5min consumption tracking window
  SESSION_INACTIVE_MS: 600000,          // 10min session timeout
  PRE_GEN_COOLDOWN_MS: 60000,           // 1min cooldown between pre-gen
  MAX_PRE_GEN_PER_HOUR: 50,             // Rate limiting
  COST_PER_GENERATION: 0.02,            // USD per generation
  MAX_HOURLY_SPEND: 1.00,               // USD spending cap

  // Coverage and targeting
  TARGET_POOL_COVERAGE: 0.85,      // 85% target coverage
} as const;
