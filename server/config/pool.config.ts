/**
 * Tunable pool thresholds for async artwork generation.
 * Adjust these values to control pool size and job batching behavior.
 */
export const POOL_CONFIG = {
  MIN_POOL_THRESHOLD: 5,
  JOBS_PER_TRIGGER: 4,
  TARGET_POOL_COVERAGE: 0.85,
};
