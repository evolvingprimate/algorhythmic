# AI Job Queue — Algorhythmic
_Last updated: 2025-11-14 (Revised by Claude)_

This document tracks pending work items for the AI development team. Each job is assigned to a specific AI agent as defined in `AI_TEAM_BOOTSTRAP.txt`.

---

## Job Format

```
Job #N
Owner: [Agent Name]
Status: [pending | in_progress | completed | blocked]
Title: [Brief description]
Spec:
  [Detailed steps for implementation]
```

---

## Active Jobs

### Job #1
**Owner:** ChatGPT+Aider
**Status:** pending
**Title:** Consolidate POOL_CONFIG and eliminate magic numbers in routes

**Context:**
- `server/config/pool.config.ts` was created in async worker commit (8f8aaf7) but never used
- `server/pool-monitor.ts:51` has its own local POOL_CONFIG with different parameters
- `server/routes.ts:2136` has magic number: `combinedArtworks.length < 5`
- Route is `/api/artworks/next` (not `/api/artworks/fresh`)
- No job enqueueing happens in routes.ts (only sets `needsGeneration` flag)

**Architectural Goal:**
Create single source of truth for pool configuration to prevent drift.

**Spec:**

1. **Consolidate POOL_CONFIG in `server/config/pool.config.ts`:**

   Merge both configs into one comprehensive object:
   ```typescript
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
   ```

2. **Update `server/pool-monitor.ts`:**

   a. Remove local POOL_CONFIG (lines 51-68 approx)

   b. Add import at top:
   ```typescript
   import { POOL_CONFIG } from './config/pool.config';
   ```

   c. Verify all POOL_CONFIG references still work (no name changes needed)

3. **Update `server/routes.ts`:**

   a. Add import at top (after other imports):
   ```typescript
   import { POOL_CONFIG } from './config/pool.config';
   ```

   b. Replace line 2136:
   ```typescript
   // BEFORE:
   const needsGeneration = combinedArtworks.length < 5;

   // AFTER:
   const needsGeneration = combinedArtworks.length < POOL_CONFIG.MIN_POOL_THRESHOLD;
   ```

   c. Optional: Add logging before line 2136:
   ```typescript
   console.log(`[ArtworksNext] Pool check: ${combinedArtworks.length}/${POOL_CONFIG.MIN_POOL_THRESHOLD} frames`);
   ```

4. **Verify no other magic numbers:**

   Search for other hardcoded thresholds:
   ```bash
   grep -n "< 5\|< 2\|< 10" server/routes.ts server/pool-monitor.ts
   ```

   Replace any found with appropriate POOL_CONFIG constants.

5. **Test changes:**

   a. Start server: `npm run dev`

   b. Check console for POOL_CONFIG import errors

   c. Call `/api/artworks/next?sessionId=test-session&limit=20`

   d. Verify response includes `needsGeneration` flag

   e. Check logs show pool status with threshold

**Acceptance Criteria:**
- [x] `server/config/pool.config.ts` exists (already done)
- [ ] POOL_CONFIG is comprehensive (includes all params from both sources)
- [ ] `pool-monitor.ts` imports centralized POOL_CONFIG
- [ ] `pool-monitor.ts` has no local POOL_CONFIG definition
- [ ] `routes.ts` imports POOL_CONFIG
- [ ] `routes.ts:2136` uses `POOL_CONFIG.MIN_POOL_THRESHOLD` (no magic number)
- [ ] Server starts without import errors
- [ ] `/api/artworks/next` responds correctly with needsGeneration flag

---

## Completed Jobs

_(None yet)_

---

## Blocked Jobs

_(None yet)_

---

## Notes

- Update job status when you start working on it: `Status: in_progress`
- Move to "Completed Jobs" section when done
- If blocked, move to "Blocked Jobs" and add reason
- Always update the timestamp at the top when editing this file
