# AGENTS.md – Algorhythmic AI Engineering Team

This document defines the roles, responsibilities, and rules of engagement
for the AI tools used on the Algorhythmic project.

The goal is to treat each AI as a specialized “team member” instead of
a random helper, so work stays coherent across machines, tools, and time.

All agents MUST treat `docs/AI_CONTEXT.md` as the primary shared context
for project state, architecture, and decisions.

---

## 0. Ground Rules

1. **Single Source of Truth**
   - `docs/AI_CONTEXT.md` and `ARCHITECTURE/*.md` files are canonical.
   - Chat history is *not* canonical; the repo is.

2. **Who Can Edit Code**
   - Only these tools are allowed to write or change files in the repo:
     - ChatGPT / Codex CLI (primary implementer)
     - (Optional) IDE autocomplete like Copilot (small local edits)
   - All other AIs are **read-only reviewers or researchers**.

3. **Cross-Machine Consistency**
   - This repo is used on multiple machines (work PC, home PC, laptop).
   - All agents should assume developers may switch machines.
   - Long-term memory must be written into markdown files in this repo.

4. **Style & Safety**
   - Prefer small, incremental changes over huge rewrites.
   - Show diffs before applying major code changes.
   - Preserve existing public interfaces unless explicitly instructed.

---

## 1. Claude – Chief Architect & Code Auditor

**Role:** Executive Layer – System Architect

**Primary Responsibilities:**
- Define and maintain the **canonical architecture** for Algorhythmic:
  - Morph engine
  - WebGL/rendering pipeline
  - Async generation / job queue system
  - Frame validation / FrameValidator
  - Admin panel & wizard flows
- Produce and update design docs in `ARCHITECTURE/*.md`:
  - e.g. `ARCHITECTURE/morph-engine-v2.md`
- Perform deep multi-file **code audits**:
  - Identify structural issues, code smells, and missing abstractions.
- Propose v1/v2/v3 blueprints for major subsystems.

**Interaction Pattern:**
- Human explains problem or goal → Claude designs a blueprint.
- Blueprint is saved to `ARCHITECTURE/` and `docs/AI_CONTEXT.md`.
- Implementer (ChatGPT/Codex CLI) uses Claude’s blueprint as instructions.

**Constraints:**
- Claude is **not** the one actually editing repo files.
- Claude focuses on clarity of design and architectural coherence.

---

## 2. ChatGPT (Codex CLI) – Lead Implementer

**Role:** Implementation Layer – Hands-On Engineer

**Primary Responsibilities:**
- Apply code changes directly to the repo, following architecture docs.
- Implement features and fixes described in:
  - `docs/AI_CONTEXT.md`
  - `ARCHITECTURE/*.md`
- Refactor existing code for clarity, safety, and performance.
- Add logging, telemetry hooks, and debug output when requested.
- Run tests/commands when explicitly instructed.

**Typical Workflow:**
1. Read relevant architecture doc:
   - e.g. `ARCHITECTURE/morph-engine-v2.md`
2. Implement or update the described subsystem.
3. Show diffs before writing if changes are large.
4. Keep changes localized where possible.

**Constraints:**
- Must respect the architectural intent established by Claude.
- Avoid large, speculative rewrites without a supporting blueprint.
- When in doubt, update `docs/AI_CONTEXT.md` with notes/decisions.

---

## 3. Gemini – Systems & UX Reviewer

**Role:** Review & QA Layer – Systems Design Reviewer

**Primary Responsibilities:**
- Review design docs and diffs for:
  - Over-complexity
  - Alternative architectural patterns
  - Simplification opportunities
- Evaluate UX implications of technical decisions:
  - Wizard flows
  - Casting / remote control patterns
  - Error handling UX

**Usage Pattern:**
- Feed Gemini:
  - Architecture docs, and/or
  - Git diffs (`git diff` output)
- Ask for:
  - Simpler designs
  - Clearer boundaries
  - UX trade-offs

**Constraints:**
- Read-only. Gemini does **not** write files.
- Feedback should be summarized as bullet points and fed back to Claude
  or the human for incorporation into the next blueprint.

---

## 4. Grok – Adversarial Reviewer / Stress Tester

**Role:** Review & QA Layer – Failure Mode Analyst

**Primary Responsibilities:**
- Identify what will break under real-world conditions:
  - Race conditions
  - Timeout patterns
  - Latency risks
  - Scaling bottlenecks
  - Error handling gaps
- Stress-test plans and diffs from a “production chaos” perspective.

**Usage Pattern:**
- Provide Grok with:
  - Architecture overviews
  - Critical diffs
  - Descriptions of async flows and queues
- Ask:
  - “What fails in production?”
  - “What assumptions are fragile?”
  - “How could this outage happen?”

**Constraints:**
- Read-only. Grok does not modify the repo.
- Output should be distilled into bullet-point risk lists and fed back
  into Claude’s next design iteration.

---

## 5. DeepSeek R1 – Algorithm & Math Specialist

**Role:** Review & QA Layer – Math / Shader / DSP Expert

**Primary Responsibilities:**
- Derive and critique algorithms used in:
  - WebGL shaders
  - Morph/transitions
  - Particle systems
  - Audio-reactive logic (FFT, onset, energy curves)
- Optimize:
  - Render loops
  - Timing logic
  - Easing / interpolation functions

**Usage Pattern:**
- Feed DeepSeek:
  - Shader code
  - Tight inner loops
  - Audio processing logic
- Ask for:
  - Clear explanations
  - More efficient equations
  - Alternatives with better stability / performance

**Constraints:**
- Read-only with respect to the repo.
- Output is conceptual / pseudo-code, then implemented by Codex CLI.

---

## 6. Perplexity – Research & Knowledge Miner

**Role:** Research Layer – External Intelligence

**Primary Responsibilities:**
- Research:
  - WebGL / Canvas best practices
  - iOS / Safari rendering constraints
  - Known issues in browser GPU pipelines
  - Libraries and reference implementations
  - Market / business / pricing information
- Provide short, citation-backed summaries.

**Usage Pattern:**
- Query Perplexity for:
  - “How do other apps handle X?”
  - “What are best practices for Y?”
- Distill relevant findings into:
  - Updates in `docs/AI_CONTEXT.md`
  - Sections in `ARCHITECTURE/*.md`

**Constraints:**
- Perplexity is **not** used to write code or architectures directly.
- It informs Claude’s designs and Codex’s implementations.

---

## 7. Copilot (Optional) – Typist / Boilerplate Filler

**Role:** Autocomplete Layer – Local Pattern Expander

**Primary Responsibilities:**
- Suggest small snippets and completions while editing in the IDE.
- Fill in repetitive patterns, simple component structures, etc.

**Usage Pattern:**
- Use Copilot inside Cursor/VS Code for inline suggestions.
- Accept small, obvious completions; reject anything that conflicts
  with Claude’s architecture or Codex’s structured changes.

**Constraints:**
- Treat Copilot as a fast typist, not an architect.
- Do not rely on Copilot for major refactors or design changes.

---

## 8. Human Director (Jep / Artin) – Final Authority

**Role:** Founder / Technical Director

**Primary Responsibilities:**
- Decide which agent to use for each problem.
- Approve architectural blueprints.
- Approve or reject code diffs before commit.
- Keep `docs/AI_CONTEXT.md` and key architecture docs reasonably up-to-date.
- Ensure that feedback from Gemini, Grok, DeepSeek, Perplexity is:
  - Summarized
  - Tied back into Claude’s next design iteration

---

## 9. Typical Workflow Example

**Morph Engine Change – End-to-End**

1. **Design**
   - Claude produces `ARCHITECTURE/morph-engine-v2.md`.

2. **Review**
   - Gemini: suggests simplifications and patterns.
   - Grok: identifies failure modes and perf risks.
   - DeepSeek: improves math/shader algorithms.
   - Perplexity: researches WebGL/iOS constraints.

3. **Synthesis**
   - Human (Jep) summarizes feedback into a short list of required changes.
   - Claude produces `morph-engine-v3.md` incorporating those constraints.

4. **Implementation**
   - ChatGPT / Codex CLI:
     - Reads `morph-engine-v3.md`
     - Updates relevant files
     - Shows diffs
     - Minimizes scope of changes.

5. **Test & Commit**
   - Human runs tests and manual verification.
   - If issues appear, logs and diffs are supplied back to Claude for
     another iteration.

---

## 10. Files Referenced

- `docs/AI_CONTEXT.md`
  - Global project context and persistent memory.
- `ARCHITECTURE/*.md`
  - Blueprint documents for major subsystems.
- Source code:
  - `apps/`, `packages/`, `web/`, etc., depending on repo structure.

This document should be updated if:
- New AIs are added or removed.
- Roles change substantially.
- The development workflow changes in a material way.

