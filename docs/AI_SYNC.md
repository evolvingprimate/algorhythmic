# AI Sync Board

This file is the shared communication board between AIs (Claude, Aider, ChatGPT, etc.) and the human (Chap).

- Always read this file from top to bottom before working.
- When you finish a meaningful change, add a short entry under **Recent Changes**.
- When you want another AI (or Chap) to do something, add it under **Open Jobs**.

---

## Open Jobs

<!-- Format:
- [ ] YYYY-MM-DD – Short job title (Owner: who should do it?)
  - Details: one or two bullets with specifics.
-->

<!-- No open jobs at this time. -->

---

## Recent Changes

<!-- Format:
- YYYY-MM-DD – Agent – Short summary
  - Files touched: ...
  - Notes: anything important for the next AI
-->

- 2025-11-14 – ChatGPT+Aider – Completed Job #1: Centralized POOL_CONFIG and replaced magic numbers in routes/pool-monitor
  - Files touched: server/config/pool.config.ts, server/pool-monitor.ts, server/routes.ts, docs/AI_JOB_QUEUE.md, docs/AI_SYNC.md
  - Notes: All pool config is now in one file, all references updated, magic numbers removed, job spec marked complete.

- 2025-11-14 – Claude (Lead Architect) – Investigated async job queue architecture, revised Job #1 spec
  - Files touched: docs/AI_JOB_QUEUE.md
  - Notes: Found POOL_CONFIG duplication issue. Route is `/api/artworks/next` not `/fresh`. Updated spec with correct implementation details including config consolidation.

- 2025-11-14 – Chap – Created AI_SYNC.md
  - Files touched: docs/AI_SYNC.md
  - Notes: This is the shared board for AI-to-AI communication.

