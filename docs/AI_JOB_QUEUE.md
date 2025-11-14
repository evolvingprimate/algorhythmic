# AI Job Queue — Algorhythmic
_Last updated: 2025-11-14_

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
**Title:** Wire POOL_CONFIG into the /api/artworks/fresh route

**Spec:**

1. **Create `server/config/pool.config.ts`:**
   ```typescript
   /**
    * Pool management constants
    * Tunable parameters for async generation triggers
    */

   export const POOL_CONFIG = {
     // Minimum unseen artworks before triggering generation
     MIN_POOL_THRESHOLD: 5,

     // Number of jobs to enqueue when threshold is hit
     JOBS_PER_TRIGGER: 4,

     // Pre-generation config (if not already defined elsewhere)
     TARGET_POOL_COVERAGE: 0.85, // 85% coverage
   } as const;
   ```

2. **Find the route that handles `/api/artworks/fresh`:**
   - Location: `server/routes.ts` or similar route file
   - Search for the endpoint that:
     - Checks pool/unseen artwork count
     - Enqueues generation jobs when pool is low
     - Returns frames to the client

3. **Import POOL_CONFIG at the top of the route file:**
   ```typescript
   import { POOL_CONFIG } from './config/pool.config';
   ```

4. **Replace magic numbers with POOL_CONFIG constants:**
   - Find where the route checks if pool is below threshold
   - Replace hardcoded threshold (if any) with: `POOL_CONFIG.MIN_POOL_THRESHOLD`
   - Replace hardcoded job count (if any) with: `POOL_CONFIG.JOBS_PER_TRIGGER`

   Example pattern to look for and update:
   ```typescript
   // BEFORE (if using magic numbers):
   if (unseenCount < 5) {
     await queueService.enqueuePreGenerationJob(userId, sessionId, styles, 4, 'reason');
   }

   // AFTER:
   if (unseenCount < POOL_CONFIG.MIN_POOL_THRESHOLD) {
     await queueService.enqueuePreGenerationJob(
       userId,
       sessionId,
       styles,
       POOL_CONFIG.JOBS_PER_TRIGGER,
       'Fresh endpoint pool replenishment'
     );
   }
   ```

5. **Add logging for visibility:**
   ```typescript
   console.log(`[Fresh] Pool status: ${unseenCount}/${POOL_CONFIG.MIN_POOL_THRESHOLD} unseen frames`);

   if (unseenCount < POOL_CONFIG.MIN_POOL_THRESHOLD) {
     console.log(`[Fresh] Enqueueing ${POOL_CONFIG.JOBS_PER_TRIGGER} generation jobs`);
     // ... enqueue logic
   }
   ```

6. **Verify the route returns immediately:**
   - Ensure the route does NOT await generation completion
   - Jobs should be enqueued asynchronously
   - Response should return available frames or fallback frames with <1s latency

7. **Test locally:**
   - Start server: `npm run dev`
   - Call `/api/artworks/fresh` with a session that has low pool
   - Verify console logs show pool threshold check
   - Verify jobs are enqueued (check telemetry/logs)
   - Verify route responds quickly (<1s)

**Acceptance Criteria:**
- [ ] `server/config/pool.config.ts` exists with MIN_POOL_THRESHOLD=5 and JOBS_PER_TRIGGER=4
- [ ] Route imports POOL_CONFIG
- [ ] No magic numbers for pool threshold or job count in route
- [ ] Logging shows pool status on each request
- [ ] Route responds <1s even when pool is empty
- [ ] Jobs are successfully enqueued when threshold is hit

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
