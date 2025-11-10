# Impression Recording Monitoring Queries

## Overview
SQL queries for monitoring the freshness pipeline and impression recording health.

---

## 1. Duplicate Detection (Should Always Return 0 Rows)

```sql
-- Verify NO duplicate impressions exist
SELECT 
  user_id,
  artwork_id,
  COUNT(*) as duplicate_count
FROM user_art_impressions
GROUP BY user_id, artwork_id
HAVING COUNT(*) > 1;
```

**Expected Result**: 0 rows (unique constraint prevents duplicates)

---

## 2. System Health Overview

```sql
-- Current impression recording stats
SELECT 
  COUNT(*) as total_impressions,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT artwork_id) as unique_artworks_viewed
FROM user_art_impressions;
```

---

## 3. User Freshness KPI (Target: >90% Unseen)

```sql
-- Per-user freshness percentage
WITH user_impressions AS (
  SELECT 
    user_id,
    COUNT(DISTINCT artwork_id) as viewed_count
  FROM user_art_impressions
  GROUP BY user_id
),
total_artworks AS (
  SELECT COUNT(*) as total 
  FROM art_sessions 
  WHERE pool_status = 'active'
)
SELECT 
  ui.user_id,
  u.email,
  ui.viewed_count as viewed_artworks,
  ta.total as total_available,
  (ta.total - ui.viewed_count) as unseen_available,
  ROUND(100.0 * (ta.total - ui.viewed_count) / ta.total, 1) as unseen_percentage
FROM user_impressions ui
JOIN users u ON u.id = ui.user_id
CROSS JOIN total_artworks ta
WHERE ui.viewed_count > 0
ORDER BY ui.viewed_count DESC
LIMIT 20;
```

**Alert Threshold**: If `unseen_percentage` < 10% for active users, trigger artwork generation

---

## 4. Hourly Recording Performance

```sql
-- 24-hour impression recording patterns
SELECT 
  DATE_TRUNC('hour', viewed_at) as hour,
  COUNT(*) as impressions_recorded,
  COUNT(DISTINCT user_id) as active_users,
  ROUND(AVG(COUNT(*)) OVER (
    ORDER BY DATE_TRUNC('hour', viewed_at) 
    ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
  ), 1) as rolling_avg_3h
FROM user_art_impressions
WHERE viewed_at >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', viewed_at)
ORDER BY hour DESC;
```

---

## 5. Pool Exhaustion Risk (Early Warning)

```sql
-- Users approaching pool exhaustion
SELECT 
  u.email,
  COUNT(DISTINCT uai.artwork_id) as viewed_count,
  (SELECT COUNT(*) FROM art_sessions WHERE pool_status = 'active') as pool_size,
  ROUND(100.0 * COUNT(DISTINCT uai.artwork_id) / 
    (SELECT COUNT(*) FROM art_sessions WHERE pool_status = 'active'), 1) as pool_coverage_pct
FROM users u
JOIN user_art_impressions uai ON uai.user_id = u.id
GROUP BY u.id, u.email
HAVING COUNT(DISTINCT uai.artwork_id)::float / 
  (SELECT COUNT(*) FROM art_sessions WHERE pool_status = 'active') > 0.85
ORDER BY pool_coverage_pct DESC;
```

**Alert**: When users exceed 85% pool coverage, prioritize artwork generation

---

## 6. Batch Operation Performance

```sql
-- Recent batch impression operations
SELECT 
  DATE_TRUNC('minute', viewed_at) as minute,
  COUNT(*) as batch_size,
  user_id
FROM user_art_impressions
WHERE viewed_at >= NOW() - INTERVAL '1 hour'
GROUP BY DATE_TRUNC('minute', viewed_at), user_id
HAVING COUNT(*) > 1  -- Only show batches
ORDER BY minute DESC
LIMIT 50;
```

---

## 7. Constraint Validation

```sql
-- Verify unique constraint exists and is enforced
SELECT 
  i.relname as index_name,
  array_agg(a.attname ORDER BY x.ordinality) as columns,
  idx.indisunique as is_unique
FROM pg_index idx
JOIN pg_class i ON i.oid = idx.indexrelid
JOIN pg_class t ON t.oid = idx.indrelid
CROSS JOIN LATERAL unnest(idx.indkey) WITH ORDINALITY AS x(attnum, ordinality)
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
WHERE t.relname = 'user_art_impressions'
  AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND idx.indisunique = true
GROUP BY i.relname, idx.indisunique;
```

**Expected**: `user_art_impressions_unique_user_artwork` on `{user_id, artwork_id}`

---

## Monitoring Dashboard Metrics

### Critical KPIs

1. **Duplicate Rate**: `0%` (enforced by DB constraint)
2. **Freshness Hit Rate**: `>90%` (percentage of unseen artworks available)
3. **Pool Coverage**: Track users approaching `>85%` coverage
4. **Batch Success Rate**: Monitor failed impression recordings
5. **Hourly Recording Rate**: Baseline for anomaly detection

### Alert Thresholds

- 🚨 **Critical**: User freshness <10% → Generate new artworks immediately
- ⚠️ **Warning**: User freshness <25% → Queue artwork generation
- 📊 **Info**: Pool coverage >85% for any user → Proactive generation

---

## Phase 1-2 Enhancement Validation

### Client-Side Metrics (Browser Console)

```javascript
// Check in browser console after user session
// Look for sampled success logs (10% rate):
// [Metrics] client_batch_flush_success=X total=Y chunk=Z
```

### Server-Side Metrics (Application Logs)

```json
// Sample success logs (10% rate):
{
  "event": "batch_impressions_success",
  "userId": "...",
  "attempted": 20,
  "recorded": 18,
  "filtered": 2,
  "latency_ms": 45,
  "timestamp": "2025-11-09T..."
}
```

### Telemetry Validation

- ✅ TextEncoder byte measurement (not string length)
- ✅ 100ms visibility-change debounce
- ✅ pagehide handler for iOS
- ✅ Server-side 10% success sampling
- ✅ Client-side divide-by-zero guard on failure rate

---

## Production Deployment Checklist

Before deploying these enhancements:

1. ✅ Verify unique constraint exists
2. ✅ Run duplicate detection query (should be 0)
3. ✅ Check freshness KPI baseline
4. ✅ Monitor batch performance for 24h
5. ✅ Validate telemetry sampling rates
6. ✅ Test pagehide on iOS devices
7. ✅ Verify debounce prevents double-flush

---

**Last Updated**: November 10, 2025  
**Enhancement Suite**: Phase 1-2 Complete, Architect Approved
