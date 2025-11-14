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
**Status:** completed
**Title:** Consolidate POOL_CONFIG and eliminate magic numbers in routes

**Context:**
- `server/config/pool.config.ts` was created in async worker commit (8f8aaf7) but never used
- `server/pool-monitor.ts:51` had its own local POOL_CONFIG with different parameters
- `server/routes.ts:2136` had magic number: `combinedArtworks.length < 5`
- Route is `/api/artworks/next` (not `/api/artworks/fresh`)
- No job enqueueing happens in routes.ts (only sets `needsGeneration` flag)

**Resolution:**
- All pool config is now in `server/config/pool.config.ts`
- `server/pool-monitor.ts` and `server/routes.ts` import and use the centralized POOL_CONFIG
- All magic numbers replaced with POOL_CONFIG constants
- Server starts and `/api/artworks/next` responds as expected

---

## Completed Jobs

- Job #1 – Consolidate POOL_CONFIG and eliminate magic numbers in routes (2025-11-14, ChatGPT+Aider)

---

## Blocked Jobs

_(None yet)_

---

## Notes

- Update job status when you start working on it: `Status: in_progress`
- Move to "Completed Jobs" section when done
- If blocked, move to "Blocked Jobs" and add reason
- Always update the timestamp at the top when editing this file
