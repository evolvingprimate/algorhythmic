# Algorhythmic — AI Project Context
_Last updated: 2025-11-14 (sync up by ChatGPT+Aider)_

This document is the single source of truth for the current architecture, components, progress, and priorities of the Algorhythmic platform. All AI agents should reference this before generating plans, specs, or code.

---

# 1. High-Level Overview

Algorhythmic is a generative, audio-reactive art system that:
- Listens to room audio or uploaded tracks.
- Generates images based on style parameters using AI (e.g., DALL·E).
- Displays these images using transitions, morphing engines, and dynamic animation.
- Tracks impressions and user preferences.
- Manages session state and prevents image repetition.
- Supports fallback tiers and progressive loading of art assets.

Key components:
- Frontend (React + TypeScript)
- Backend (Node/Express + Drizzle + Postgres)
- Artwork Generation (OpenAI API, fallback tiers)
- Session Engine / Frame Validator
- Event Logging / Telemetry
- Progressive loading + fallback pool architecture
- Admin / Analytics (future)

---

# 2. Current Architecture Summary

## Frontend
- React + TypeScript
- “Wizard Flow” for Style → Audio → Display
- FrameValidator runs client-side
- Uses React Query for async data fetching
- Issues: race conditions in Style/Audio transition (recent fix applied)

## Backend
- Node.js + Express
- Drizzle ORM (PostgreSQL)
- Key routes:
  - `/api/generate` — requests new artwork from OpenAI
  - `/api/artworks/fresh` — fetches unseen frames
  - `/api/impressions` — logs user preferences

## Database Schema (High-level)
- `artworks` — stored frames
- `art_sessions` — session IDs, timestamps
- `user_art_impressions` — likes/dislikes
- Indices:  
  - `user_art_impressions(user_id, artwork_id)` UNIQUE  
  - `art_sessions(session_id, created_at DESC)` INDEX

## Generation Pipeline
1. Frontend requests fresh frames.
2. Backend queries unseen artworks.
3. If pool is insufficient:
   - Trigger background generation job (future: async queue)
   - Return fallback frames
4. FrameValidator ensures no repeats within session.

---

# 3. Known Issues (Open Tickets)

## Blocking
- ~~Need async generation queue (decouple from HTTP latency)~~ ✅ **COMPLETE** (commit 8f8aaf7 + Job #1)
- ~~Need stable FrameValidator gating with retries~~ ✅ **COMPLETE** (FrameValidator implemented with maxRetries=2)
- Need telemetry on validator_rejections > 0.5% ⏳ **IN PROGRESS** (Job #2 spec ready)

## Next Sprint
- Predictive pre-generation (85–90% pool coverage)
- Redis caching layer for fresh queries
- Privacy: userId hashing

## Nice-to-Have
- Mobile/tablet perf testing
- Admin analytics dashboard
- Visual DNA replay mode

---

# 4. Completed Work (Summary)

- FrameValidator implemented (session-scoped, maxRetries=2)
- DB indexes verified
- Style→Audio wizard transition issue addressed
- Telemetry: fresh_count_raw, fresh_count_after_filter
- Regression QA suites drafted
- Async worker separation complete (standalone + embedded modes)
- POOL_CONFIG consolidated (single source of truth)
- Magic numbers eliminated from routes and pool-monitor

---

# 5. Development Workflow Notes

## Branching
- Use feature branches: `feature/<name>`
- Replit Agent 3 applies small, explicit changes from specs
- Aider works on local clone synced with GitHub + Dropbox

## Testing
- Playwright E2E tests for:
  - “No repeats over 20 frames”
  - Wizard flow

## Documentation
- Claude is responsible for PLAN + SPEC
- ChatGPT updates `AI_CONTEXT.md` after merges

---

# 6. Open Questions / Decisions To Be Made

- Which job queue library to use for async generation?
- Where Redis should run (local Docker? Managed service?)
- Whether to enable fallback DALL·E vs cached images vs custom pool

---

# 7. Agent Notes (for Multi-AI Consistency)

- All AI agents must respect the canonical team roles.
- Follow PLAN → SPEC → BUILD → REVIEW → TEST → DOCUMENT.
- Keep changes atomic and reversible.
- Always request missing context before making assumptions.

---

# End of AI_CONTEXT.md
