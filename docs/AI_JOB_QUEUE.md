# AI Job Queue — Algorhythmic
_Last updated: 2025-11-14 (Job #2 added by Claude, sync up by ChatGPT+Aider)_

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

### Job #2
**Owner:** ChatGPT+Aider
**Status:** pending
**Title:** Add telemetry tracking for FrameValidator rejections with > 0.5% alerting

**Context:**
- FrameValidator exists and works (client/src/lib/FrameValidator.ts)
- Currently logs rejections to console only (no structured telemetry)
- TelemetryService exists but has no validator-specific metrics
- Blocking issue: "Need telemetry on validator_rejections > 0.5%"

**Architectural Gap:**
- FrameValidator is client-side, telemetryService is server-side
- Need cross-boundary telemetry reporting via HTTP endpoint
- No 'validation' category in TelemetryEvent type
- No validator counters in TelemetryService
- No alert threshold for rejection rate

**Spec:**

1. **Extend TelemetryService types (`server/telemetry-service.ts`):**

   a. Add 'validation' to category union (line 11):
   ```typescript
   category: 'generation' | 'display' | 'fallback' | 'websocket' | 'validation' | 'system';
   ```

   b. Add validator counters to counters object (after line 151):
   ```typescript
   private counters = {
     // ... existing counters
     validatorAttempts: 0,       // Total validation attempts
     validatorRejections: 0,     // Total rejections
     validatorMaxRetries: 0,     // Max retries exceeded count
   };
   ```

   c. Add validator event processing in `processEventMetrics()` (after line 292):
   ```typescript
   // Track validator metrics
   if (event.category === 'validation') {
     if (event.event === 'frame_validation_attempt') {
       this.counters.validatorAttempts++;
     } else if (event.event === 'frame_rejection') {
       this.counters.validatorRejections++;
     } else if (event.event === 'max_retries_exceeded') {
       this.counters.validatorMaxRetries++;
     }
   }
   ```

   d. Add rejection rate to MetricsSummary interface (after line 52):
   ```typescript
   // Validator metrics
   validatorRejectionRate: number;  // Percentage
   validatorRejectionsTotal: number;
   validatorAttemptsTotal: number;
   validatorMaxRetriesCount: number;
   ```

   e. Add rejection rate calculation in `getMetricsSummary()` (after line 498):
   ```typescript
   const validatorRejectionRate = this.counters.validatorAttempts > 0
     ? this.counters.validatorRejections / this.counters.validatorAttempts
     : 0;
   ```

   f. Include in return object (after line 539):
   ```typescript
   validatorRejectionRate: validatorRejectionRate,
   validatorRejectionsTotal: this.counters.validatorRejections,
   validatorAttemptsTotal: this.counters.validatorAttempts,
   validatorMaxRetriesCount: this.counters.validatorMaxRetries,
   ```

   g. Add alert condition (after line 124):
   ```typescript
   VALIDATOR_REJECTION_RATE: {
     threshold: 0.005,  // 0.5% max
     message: 'Frame validator rejection rate too high',
     severity: 'warning' as const
   }
   ```

   h. Add alert check in `checkAlerts()` (after line 427):
   ```typescript
   // Check validator rejection rate
   if (summary.validatorRejectionRate > ALERT_CONDITIONS.VALIDATOR_REJECTION_RATE.threshold) {
     alerts.push({
       condition: 'VALIDATOR_REJECTION_RATE',
       message: ALERT_CONDITIONS.VALIDATOR_REJECTION_RATE.message,
       severity: ALERT_CONDITIONS.VALIDATOR_REJECTION_RATE.severity,
       value: summary.validatorRejectionRate,
       threshold: ALERT_CONDITIONS.VALIDATOR_REJECTION_RATE.threshold,
       timestamp: new Date()
     });
   }
   ```

2. **Create telemetry API endpoint (`server/routes.ts`):**

   Add after existing telemetry routes:
   ```typescript
   // POST /api/telemetry/validation - Client-side validation events
   app.post('/api/telemetry/validation', async (req, res) => {
     try {
       const { event, metrics } = req.body;

       if (!event || !metrics) {
         return res.status(400).json({ error: 'event and metrics required' });
       }

       telemetryService.recordEvent({
         category: 'validation',
         event,
         metrics,
         severity: event === 'max_retries_exceeded' ? 'error' : 'info',
         sessionId: metrics.sessionId,
         userId: req.user?.claims?.sub
       });

       res.json({ success: true });
     } catch (error: any) {
       console.error('[Telemetry] Validation event error:', error);
       res.status(500).json({ error: error.message });
     }
   });
   ```

3. **Update FrameValidator to send telemetry (`client/src/lib/FrameValidator.ts`):**

   a. Add telemetry helper method (after line 136):
   ```typescript
   private async sendTelemetry(event: string, metrics: Record<string, any>) {
     if (!this.enableTelemetry) return;

     try {
       await fetch('/api/telemetry/validation', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           event,
           metrics: {
             ...metrics,
             sessionId: this.sessionId
           }
         })
       });
     } catch (err) {
       // Silent fail - don't block validation on telemetry errors
       console.warn('[FrameValidator] Telemetry send failed:', err);
     }
   }
   ```

   b. Send telemetry on validation attempt (after line 46):
   ```typescript
   validate(frameIds: string[], currentSessionId: string): ValidationResult {
     // Record validation attempt
     this.sendTelemetry('frame_validation_attempt', {
       frameCount: frameIds.length
     });

     // ... rest of validation logic
   }
   ```

   c. Send telemetry on rejection (after line 75):
   ```typescript
   if (this.enableTelemetry) {
     console.warn('[FrameValidator] ❌ Rejected duplicate frames:', {
       duplicateCount: duplicates.length,
       duplicateIds: duplicates,
       retryAttempt: this.retryCount,
       maxRetries: this.maxRetries,
     });

     // Send telemetry
     this.sendTelemetry('frame_rejection', {
       duplicateCount: duplicates.length,
       retryAttempt: this.retryCount,
       maxRetries: this.maxRetries
     });
   }
   ```

   d. Send telemetry on max retries (after line 79):
   ```typescript
   if (this.retryCount > this.maxRetries) {
     console.error('[FrameValidator] 🚨 Max retries exceeded - pool may be exhausted');

     this.sendTelemetry('max_retries_exceeded', {
       retryCount: this.retryCount,
       maxRetries: this.maxRetries
     });

     return {
       valid: false,
       rejectedFrameIds: duplicates,
       reason: 'max_retries_exceeded',
     };
   }
   ```

4. **Add validator metrics to monitoring endpoint (`server/routes.ts`):**

   Find `/api/monitoring/resilience` and add validator section:
   ```typescript
   // In the resilience status response object:
   validator: {
     rejectionRate: summary.validatorRejectionRate,
     rejectionsTotal: summary.validatorRejectionsTotal,
     attemptsTotal: summary.validatorAttemptsTotal,
     maxRetriesCount: summary.validatorMaxRetriesCount,
     thresholdExceeded: summary.validatorRejectionRate > 0.005
   }
   ```

5. **Test implementation:**

   a. Start server: `npm run dev`

   b. Open browser console and load display page

   c. Trigger validation rejection (manually or via pool exhaustion)

   d. Verify console shows telemetry POST request

   e. Check `/api/monitoring/resilience` response includes validator metrics

   f. Verify rejection rate calculation is correct

**Acceptance Criteria:**
- [ ] TelemetryService has 'validation' category
- [ ] TelemetryService tracks validator counters (attempts, rejections, maxRetries)
- [ ] TelemetryService calculates rejection rate
- [ ] VALIDATOR_REJECTION_RATE alert threshold exists (0.5%)
- [ ] `/api/telemetry/validation` endpoint accepts POST requests
- [ ] FrameValidator sends telemetry on validation attempts
- [ ] FrameValidator sends telemetry on rejections
- [ ] FrameValidator sends telemetry on max retries exceeded
- [ ] `/api/monitoring/resilience` includes validator metrics
- [ ] Alert triggers when rejection rate > 0.5%
- [ ] No errors in browser or server console

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
