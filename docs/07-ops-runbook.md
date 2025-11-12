# Operations Runbook

## System Overview for Operations

Algorhythmic is a real-time AI art generation platform that requires careful monitoring and maintenance. This runbook provides procedures for common operational tasks and incident response.

### Critical Components

| Component | Purpose | SLA | Priority |
|-----------|---------|-----|----------|
| DALL-E Generation | Core art generation | 99.5% | P0 |
| WebSocket Server | Real-time updates | 99.9% | P1 |
| PostgreSQL Database | Data persistence | 99.9% | P0 |
| Circuit Breaker | Failure protection | 99.99% | P0 |
| Credit System | Usage management | 99.9% | P1 |

## Monitoring & Alerts

### Health Check Endpoints

```bash
# Basic health check
curl https://your-domain/api/health
# Expected: {"status":"ok"}

# Detailed resilience status
curl -H "Authorization: Bearer $TOKEN" \
  https://your-domain/api/monitoring/resilience

# Telemetry dashboard
curl -H "Authorization: Bearer $TOKEN" \
  https://your-domain/api/telemetry/dashboard
```

### Key Metrics to Monitor

| Metric | Normal Range | Warning | Critical | Action |
|--------|-------------|---------|----------|--------|
| Circuit Breaker State | closed | half_open | open > 5min | Check DALL-E, force reset if needed |
| Generation P95 Latency | 45-60s | >70s | >90s | Check OpenAI status |
| Queue Depth | 2-4 | 5-8 | >10 | Increase generation rate |
| Error Rate | <0.1% | 0.1-1% | >1% | Check logs, possible rollback |
| Credit Failures | <1% | 1-5% | >5% | Check credit system |
| WebSocket Connections | 50-500 | >500 | >1000 | Scale horizontally |

### Alert Configuration

```javascript
// Example alert rules (Prometheus format)
alert: CircuitBreakerOpen
expr: circuit_breaker_state == 2  # 2 = open
for: 5m
annotations:
  summary: "Circuit breaker has been open for 5 minutes"
  action: "Check DALL-E API status, consider manual reset"

alert: HighErrorRate
expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.01
annotations:
  summary: "Error rate exceeds 1%"
  action: "Check error logs, identify root cause"

alert: QueueBacklog
expr: generation_queue_depth > 10
for: 10m
annotations:
  summary: "Generation queue backlog detected"
  action: "Check generation health, increase batch size"
```

## Common Operations

### 1. Circuit Breaker Management

#### Check Circuit Breaker Status
```bash
# Via API
curl https://your-domain/api/admin/circuit-breaker-status

# Expected output:
{
  "state": "closed",  # closed|open|half_open
  "tokens": 0,
  "successRate": 0.95,
  "p95Latency": 55000
}
```

#### Force Reset Circuit Breaker
```bash
# Reset to closed state
curl -X POST https://your-domain/api/admin/reset-circuit-breaker \
  -H "Authorization: Bearer $TOKEN"

# Or run script
npm run script:reset-circuit-breaker
```

#### Force Open for Testing
```bash
# Force open for 5 minutes (dev only)
curl -X POST https://your-domain/api/test/force-breaker-open \
  -H "Content-Type: application/json" \
  -d '{"durationMs": 300000}'
```

### 2. Database Operations

#### Check Database Connection
```sql
-- Check connection
SELECT 1;

-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Check table sizes
SELECT 
  schemaname AS table_schema,
  tablename AS table_name,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Clean Up Old Data
```sql
-- Clean old telemetry (>30 days)
DELETE FROM telemetry_events 
WHERE timestamp < NOW() - INTERVAL '30 days';

-- Clean unused art sessions (>90 days)
DELETE FROM art_sessions 
WHERE last_used_at < NOW() - INTERVAL '90 days'
  AND is_saved = false;

-- Vacuum to reclaim space
VACUUM ANALYZE;
```

#### Emergency Backup
```bash
# Create manual backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
psql $DATABASE_URL < backup_20240115_120000.sql
```

### 3. Credit System Management

#### Check User Credits
```sql
-- Check specific user balance
SELECT 
  u.email,
  u.subscription_tier,
  uc.balance,
  uc.base_quota,
  uc.billing_cycle_end
FROM users u
JOIN user_credits uc ON u.id = uc.user_id
WHERE u.email = 'user@example.com';
```

#### Grant Emergency Credits
```sql
-- Grant credits to user
INSERT INTO credit_ledger (
  user_id,
  event_type,
  amount,
  balance_after,
  description
) VALUES (
  'user-id-here',
  'admin_adjustment',
  100,
  (SELECT balance FROM user_credits WHERE user_id = 'user-id-here') + 100,
  'Emergency credit grant'
);

-- Update balance
UPDATE user_credits 
SET balance = balance + 100
WHERE user_id = 'user-id-here';
```

#### Fix Credit Discrepancies
```sql
-- Recalculate balance from ledger
WITH calculated AS (
  SELECT 
    user_id,
    SUM(amount) as total
  FROM credit_ledger
  WHERE user_id = 'user-id-here'
  GROUP BY user_id
)
UPDATE user_credits uc
SET balance = c.total
FROM calculated c
WHERE uc.user_id = c.user_id;
```

### 4. Generation Queue Management

#### Check Queue Status
```bash
# Via monitoring endpoint
curl https://your-domain/api/monitoring/resilience | jq '.queueController'

# Check database queue
psql -c "SELECT COUNT(*), status FROM generation_jobs 
         WHERE status IN ('pending', 'generating') 
         GROUP BY status;"
```

#### Clear Stuck Jobs
```sql
-- Mark stuck jobs as failed (>10 min old)
UPDATE generation_jobs 
SET 
  status = 'failed',
  error_message = 'Stuck job cleared by admin',
  completed_at = NOW()
WHERE 
  status IN ('pending', 'generating')
  AND created_at < NOW() - INTERVAL '10 minutes';
```

#### Force Generation
```bash
# Bypass queue and generate immediately (dev)
curl -X POST https://your-domain/api/test/generate \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session",
    "preferences": {
      "styles": ["Abstract"],
      "artists": []
    }
  }'
```

### 5. Cache Management

#### Clear Recently Served Cache
```typescript
// Via code (requires restart)
recentlyServedCache.clear();

// Or wait for TTL expiry (1 hour)
```

#### View Cache Statistics
```bash
# Get cache stats
curl https://your-domain/api/admin/cache-stats

# Response:
{
  "totalUsers": 45,
  "totalArtworks": 450,
  "oldestEntry": "2024-01-15T10:00:00Z"
}
```

## Incident Response Procedures

### P0: Complete Service Outage

**Symptoms**: All requests failing, site unreachable

**Response**:
1. **Check Replit Status**: https://status.replit.com
2. **Check Application Logs**:
   ```bash
   tail -f /tmp/logs/server_*.log
   tail -f /tmp/logs/error_*.log
   ```
3. **Restart Application**:
   ```bash
   # Via Replit console
   kill 1  # Kills main process, auto-restarts
   ```
4. **Check Database Connection**:
   ```bash
   psql $DATABASE_URL -c "SELECT 1;"
   ```
5. **Emergency Rollback** (if recent deployment):
   ```bash
   git revert HEAD
   git push origin main
   ```

### P1: Circuit Breaker Stuck Open

**Symptoms**: No new images generating, fallback only

**Response**:
1. **Verify DALL-E Status**:
   ```bash
   curl https://status.openai.com/api/v2/status.json
   ```
2. **Check Circuit Breaker**:
   ```bash
   curl https://your-domain/api/admin/circuit-breaker-status
   ```
3. **Review Recent Failures**:
   ```sql
   SELECT * FROM generation_jobs 
   WHERE status = 'failed' 
   AND created_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at DESC 
   LIMIT 10;
   ```
4. **Manual Reset** (if DALL-E healthy):
   ```bash
   curl -X POST https://your-domain/api/admin/reset-circuit-breaker
   ```
5. **Monitor Recovery**:
   ```bash
   watch -n 5 "curl -s https://your-domain/api/admin/circuit-breaker-status | jq '.state'"
   ```

### P1: High Error Rate

**Symptoms**: >1% requests failing

**Response**:
1. **Identify Error Pattern**:
   ```bash
   # Check error logs
   grep ERROR /tmp/logs/server_*.log | tail -50
   
   # Check by endpoint
   grep "500 in" /tmp/logs/server_*.log | cut -d' ' -f2 | sort | uniq -c
   ```
2. **Check External Services**:
   - OpenAI API status
   - ACRCloud status
   - Stripe status
3. **Database Health**:
   ```sql
   -- Check slow queries
   SELECT * FROM pg_stat_statements 
   WHERE mean_exec_time > 1000 
   ORDER BY mean_exec_time DESC;
   ```
4. **Resource Limits**:
   ```bash
   # Check memory
   free -h
   
   # Check disk
   df -h
   
   # Check connections
   ss -tan | grep :5000 | wc -l
   ```

### P2: Credit System Issues

**Symptoms**: Users can't generate, wrong balances

**Response**:
1. **Audit Recent Transactions**:
   ```sql
   SELECT * FROM credit_ledger 
   WHERE created_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at DESC;
   ```
2. **Check for Duplicates**:
   ```sql
   SELECT idempotency_key, COUNT(*) 
   FROM credit_ledger 
   GROUP BY idempotency_key 
   HAVING COUNT(*) > 1;
   ```
3. **Recalculate Balances**:
   ```sql
   -- For affected user
   CALL recalculate_user_credits('user-id');
   ```
4. **Emergency Credit Grant** (temporary fix):
   ```sql
   UPDATE user_credits 
   SET balance = base_quota 
   WHERE balance < 0;
   ```

### P2: WebSocket Disconnections

**Symptoms**: Real-time updates not working

**Response**:
1. **Check WebSocket Server**:
   ```bash
   # Count connections
   ss -tan | grep :5000 | grep ESTABLISHED | wc -l
   ```
2. **Review WebSocket Logs**:
   ```bash
   grep "WebSocket" /tmp/logs/server_*.log | tail -50
   ```
3. **Test Connection**:
   ```javascript
   // In browser console
   const ws = new WebSocket('wss://your-domain/ws');
   ws.onopen = () => console.log('Connected');
   ws.onerror = (e) => console.error('Error:', e);
   ```
4. **Restart WebSocket Server** (last resort):
   ```bash
   # Restart entire application
   kill 1
   ```

## Maintenance Procedures

### Daily Tasks
- [ ] Check circuit breaker status
- [ ] Review error rates
- [ ] Monitor credit usage patterns
- [ ] Check disk space

### Weekly Tasks
- [ ] Clean up old telemetry data
- [ ] Review slow query log
- [ ] Audit failed generation jobs
- [ ] Update dependency vulnerabilities

### Monthly Tasks
- [ ] Full database backup
- [ ] Credit system audit
- [ ] Performance review
- [ ] Security patch updates
- [ ] API key rotation

## Disaster Recovery

### Backup Strategy
```bash
# Automated daily backups
0 3 * * * pg_dump $DATABASE_URL | gzip > /backups/db_$(date +\%Y\%m\%d).sql.gz

# Keep 30 days of backups
find /backups -name "*.sql.gz" -mtime +30 -delete
```

### Recovery Procedures

#### Database Recovery
```bash
# 1. Stop application
kill 1

# 2. Restore database
gunzip < /backups/db_20240115.sql.gz | psql $DATABASE_URL

# 3. Verify restoration
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"

# 4. Restart application
npm run start
```

#### Object Storage Recovery
```bash
# List recent backups
gsutil ls gs://backup-bucket/

# Restore specific date
gsutil -m cp -r gs://backup-bucket/20240115/* gs://production-bucket/
```

## Performance Tuning

### Database Optimization
```sql
-- Update statistics
ANALYZE;

-- Rebuild indexes
REINDEX DATABASE algorhythmic;

-- Find missing indexes
SELECT schemaname, tablename, attname, n_distinct, correlation
FROM pg_stats
WHERE schemaname = 'public'
AND n_distinct > 100
AND correlation < 0.1
ORDER BY n_distinct DESC;
```

### Application Optimization
```javascript
// Increase connection pool
const pool = new Pool({
  max: 30,  // Increase from 20
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Adjust circuit breaker
REFILL_MS = 30000;  // Faster recovery
OPEN_TOKENS = 3;    // More sensitive
```

## Contact Information

### Escalation Path

1. **On-Call Engineer**: Check rotation schedule
2. **Team Lead**: For P0/P1 incidents
3. **Platform Team**: For infrastructure issues
4. **External Vendors**:
   - OpenAI Support: For DALL-E issues
   - Neon Support: For database issues
   - Replit Support: For platform issues

### Useful Resources

- [System Overview](00-system-overview.md)
- [API Documentation](02-services-and-interfaces.md)
- [Security Procedures](06-security-and-compliance.md)
- [Monitoring Dashboard](https://your-domain/admin/telemetry)
- [Replit Status](https://status.replit.com)
- [OpenAI Status](https://status.openai.com)

## Appendix: Quick Commands

```bash
# Check all services
./scripts/health-check.sh

# Reset everything
./scripts/emergency-reset.sh

# Backup everything
./scripts/full-backup.sh

# Monitor in real-time
./scripts/live-monitor.sh
```