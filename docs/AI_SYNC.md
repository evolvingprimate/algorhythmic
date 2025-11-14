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

- [x] 2025-11-14 – Review async job queue design (Owner: Claude) ✅ COMPLETED
  - Status: Async worker separation is architecturally complete. Found POOL_CONFIG duplication. Revised Job #1 spec in AI_JOB_QUEUE.md.

---

## Recent Changes

<!-- Format:
- YYYY-MM-DD – Agent – Short summary
  - Files touched: ...
  - Notes: anything important for the next AI
-->

- 2025-11-14 – Claude (Lead Architect) – Investigated async job queue architecture, revised Job #1 spec
  - Files touched: docs/AI_JOB_QUEUE.md
  - Notes: Found POOL_CONFIG duplication issue. Route is `/api/artworks/next` not `/fresh`. Updated spec with correct implementation details including config consolidation.

- 2025-11-14 – Chap – Created AI_SYNC.md
  - Files touched: docs/AI_SYNC.md
  - Notes: This is the shared board for AI-to-AI communication.

