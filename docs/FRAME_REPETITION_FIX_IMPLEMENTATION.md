# Frame Repetition Bug Fix - Implementation Summary
**Date**: 2025-11-10  
**Status**: IMPLEMENTED - Awaiting Testing  
**Bug ID**: #5 (Frame Repetition Loop)

---

## Implementation Summary

### Problem
Fresh frames bypassed impression filtering, causing frames to loop every 15 minutes despite "never repeat" guarantee.

### Solution (3-Layer Defense)

#### Layer 1: Backend Fix ✅
**File**: `server/storage.ts`

**Changes**:
- Added LEFT JOIN with `userArtImpressions` to `getFreshArtworks()`
- Added configurable `FRESH_WINDOW_MINUTES = 15` constant
- Added telemetry logging: `freshCountRaw` vs `freshCountAfterFilter`

**Before**:
```typescript
// NO impression filtering
const results = await this.db
  .select()
  .from(artSessions)
  .where(and(
    eq(artSessions.sessionId, sessionId),
    gte(artSessions.createdAt, fifteenMinutesAgo)
  ))
```

**After**:
```typescript
// WITH impression filtering
const results = await this.db
  .select(getTableColumns(artSessions))
  .from(artSessions)
  .leftJoin(userArtImpressions, and(
    eq(artSessions.id, userArtImpressions.artworkId),
    eq(userArtImpressions.userId, userId)
  ))
  .where(and(
    eq(artSessions.sessionId, sessionId),
    gte(artSessions.createdAt, freshWindowAgo),
    isNull(userArtImpressions.id) // EXCLUDE SEEN
  ))
```

**Telemetry Output**:
```
[Fresh Queue] Raw: 8, After Filter: 3, Filtered Out: 5
```

#### Layer 2: FrameValidator Service ✅
**File**: `client/src/lib/FrameValidator.ts`

**Features**:
- Session-scoped duplicate tracking (resets on session change)
- Max 2 retries (prevents spinner loops on thin pools)
- Telemetry integration (logs rejections)
- Seed method (initialize with existing frames)

**API**:
```typescript
const validator = new FrameValidator({ maxRetries: 2, enableTelemetry: true });

// Validate frames before morphing
const validation = validator.validate(frameIds, sessionId);
if (!validation.valid) {
  // Trigger refetch
  queryClient.invalidateQueries({ queryKey: ["/api/artworks/next", sessionId] });
}
```

#### Layer 3: Display Integration ✅
**File**: `client/src/pages/display.tsx`

**Integration Points**:
1. Initialize validator: `frameValidatorRef = useRef(new FrameValidator())`
2. Validate before loading frames in `loadValidatedFrames()`
3. Handle rejections with refetch (max 2 attempts)
4. Reset validator on session change

**Validation Flow**:
```
Fetch frames → Validate IDs → Pass? Load : Refetch
                                     ↓
                              Max retries? Show fallback
```

---

## Testing Plan

### Test 1: Loop Detection ⏱️ PENDING
**Scenario**: View frames 1-3, verify frame 4 is NEW
**Expected**: No duplicates in 20-frame sequence
**Command**: Manual browser testing with console logs

### Test 2: Validator Rejection ⏱️ PENDING
**Scenario**: Verify validator rejects duplicates and triggers refetch
**Expected**: Console shows rejection + refetch, no frame loops
**Command**: Watch browser console for `[FrameValidator] ❌ Rejected`

### Test 3: Fresh Queue Expiry ⏱️ PENDING
**Scenario**: Wait 16 minutes after generation
**Expected**: Next frame comes from storage pool (not expired fresh queue)
**Command**: Generate → wait → verify backend logs show storage pool fetch

---

## Expected Behavior Changes

### Before Fix
```
User views: 1 → 2 → 3 → 2 (LOOP!) → 1 (LOOP!) → 3 (LOOP!)
Backend: Always returns all fresh frames (ignores impressions)
Duration: Loops for 15 minutes until fresh queue expires
```

### After Fix
```
User views: 1 → 2 → 3 → 4 → 5 → 6 (UNIQUE forever)
Backend: Returns fresh frames MINUS seen ones
Validator: Catches any race conditions
Duration: Zero repetitions guaranteed
```

---

## Telemetry Metrics

### Backend Logs
```
[Fresh Queue] Raw: 8, After Filter: 3, Filtered Out: 5
[Artworks GET] User xyz - Fresh: 3, Storage: 2, Total: 5
```

### Frontend Logs
```
[FrameValidator] ✅ Validated 5 fresh frames (total seen: 12)
[FrameValidator] ❌ Rejected duplicate frames: { duplicateCount: 2, retryAttempt: 1 }
[Display] 🔄 Refetching fresh frames after validator rejection
```

---

## Architect Review Pending

Awaiting final review to confirm:
- [ ] Backend filter correctly excludes seen frames
- [ ] Validator prevents duplicates during race conditions
- [ ] Telemetry logs provide actionable data
- [ ] No edge cases or performance regressions

---

**Next Steps**:
1. Architect review (include git diff)
2. Manual testing (20-frame sequence)
3. E2E Playwright test
4. Mark bug as RESOLVED
