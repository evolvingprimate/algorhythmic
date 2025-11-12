# Data and Storage Documentation

## Database Overview

Algorhythmic uses PostgreSQL (Neon-hosted) as its primary database with Drizzle ORM for type-safe database operations. The schema is designed for high performance, data integrity, and scalability.

### Database Configuration

```typescript
// Connection String Format
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

// Drizzle Configuration
{
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  out: "./migrations"
}
```

## Database Schema

### Core Tables

#### `users` - User accounts and preferences
```sql
CREATE TABLE users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR UNIQUE,
  first_name VARCHAR,
  last_name VARCHAR,
  profile_image_url VARCHAR,
  subscription_tier TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  is_active BOOLEAN DEFAULT true,
  preferred_orientation VARCHAR, -- portrait|landscape|both
  controller_state TEXT, -- JSON: credit controller state
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `users_email_idx` (UNIQUE)

**Subscription Tiers**:
| Tier | Monthly Credits | Price |
|------|----------------|-------|
| `free` | 100 | $0 |
| `premium` | 1000 | $10 |
| `ultimate` | 3000 | $30 |
| `enthusiast` | 10000 | $50 |
| `business_basic` | 5000 | $100 |
| `business_premium` | 20000 | $300 |

#### `art_sessions` - Generated artwork records
```sql
CREATE TABLE art_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR NOT NULL,
  user_id VARCHAR REFERENCES users(id),
  image_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  dna_vector TEXT, -- JSON: 50-point morphing vector
  audio_features TEXT, -- JSON: audio analysis
  music_track TEXT,
  music_artist TEXT,
  music_genre TEXT,
  music_album TEXT,
  generation_explanation TEXT,
  is_saved BOOLEAN DEFAULT false,
  
  -- ImagePool metadata
  motifs TEXT[] DEFAULT '{}',
  quality_score INTEGER DEFAULT 50,
  perceptual_hash VARCHAR,
  pool_status VARCHAR DEFAULT 'active',
  last_used_at TIMESTAMP,
  
  -- Preference tags
  styles TEXT[] DEFAULT '{}',
  artists TEXT[] DEFAULT '{}',
  
  -- Catalogue metadata
  is_library BOOLEAN DEFAULT false,
  orientation VARCHAR,
  aspect_ratio VARCHAR,
  catalogue_tier VARCHAR,
  width INTEGER,
  height INTEGER,
  safe_area TEXT, -- JSON: {x,y,w,h}
  focal_points TEXT, -- JSON: [{x,y,confidence}]
  sidefill_palette TEXT, -- JSON: ['#color1','#color2']
  
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `art_sessions_session_id_idx`
- `art_sessions_user_id_idx`
- `art_sessions_quality_score_idx`
- `art_sessions_is_library_idx`
- `art_sessions_orientation_idx`
- `art_sessions_styles_idx` (GIN)

#### `art_preferences` - User style preferences
```sql
CREATE TABLE art_preferences (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR NOT NULL,
  styles TEXT[] DEFAULT '{}',
  artists TEXT[] DEFAULT '{}',
  dynamic_mode BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `art_preferences_session_id_idx`

#### `art_votes` - Voting history
```sql
CREATE TABLE art_votes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR NOT NULL,
  art_prompt TEXT NOT NULL,
  vote INTEGER NOT NULL, -- 1 or -1
  audio_characteristics TEXT, -- JSON
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `art_votes_session_id_idx`

### Credit System Tables

#### `credit_ledger` - Immutable transaction log
```sql
CREATE TABLE credit_ledger (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR NOT NULL, -- grant|deduct|refund|rollover|decay|admin_adjustment
  amount INTEGER NOT NULL, -- positive for credits, negative for debits
  balance_after INTEGER NOT NULL,
  description TEXT,
  metadata TEXT, -- JSON
  idempotency_key VARCHAR UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `credit_ledger_user_id_idx`
- `credit_ledger_created_at_idx`
- `credit_ledger_event_type_idx`
- `credit_ledger_idempotency_idx` (UNIQUE)
- `credit_ledger_user_created_idx` (composite)

#### `user_credits` - Materialized balance view
```sql
CREATE TABLE user_credits (
  user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER DEFAULT 0,
  rollover_balance INTEGER DEFAULT 0,
  base_quota INTEGER DEFAULT 100,
  billing_cycle_start TIMESTAMP NOT NULL,
  billing_cycle_end TIMESTAMP NOT NULL,
  timezone VARCHAR DEFAULT 'UTC',
  last_updated TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `user_credits_billing_cycle_end_idx`

### Telemetry Tables

#### `rai_sessions` - Real-time Aesthetic Intelligence sessions
```sql
CREATE TABLE rai_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id),
  client_session_id VARCHAR NOT NULL,
  platform VARCHAR,
  screen_size VARCHAR,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  total_frames_displayed INTEGER DEFAULT 0,
  total_interactions INTEGER DEFAULT 0
);
```

**Indexes**:
- `rai_sessions_user_id_idx`
- `rai_sessions_client_session_id_idx`

#### `telemetry_events` - Event log
```sql
CREATE TABLE telemetry_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR REFERENCES rai_sessions(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL, -- JSON payload
  audio_features TEXT, -- JSON snapshot
  visual_state TEXT, -- JSON snapshot
  timestamp TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `telemetry_events_session_id_idx`
- `telemetry_events_event_type_idx`
- `telemetry_events_timestamp_idx`
- `telemetry_events_user_id_idx`

### Generation Pipeline Tables

#### `generation_jobs` - Active generation tracking
```sql
CREATE TABLE generation_jobs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id),
  session_id VARCHAR,
  prompt TEXT NOT NULL,
  status VARCHAR DEFAULT 'pending', -- pending|generating|completed|failed|timeout
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  idempotency_key VARCHAR UNIQUE,
  metadata TEXT, -- JSON
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Indexes**:
- `generation_jobs_user_id_idx`
- `generation_jobs_session_id_idx`
- `generation_jobs_status_idx`
- `generation_jobs_idempotency_idx` (UNIQUE)

#### `dna_genomes` - Evolutionary DNA tracking
```sql
CREATE TABLE dna_genomes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id VARCHAR REFERENCES art_sessions(id) ON DELETE CASCADE,
  parent_genome_ids TEXT[],
  generation INTEGER DEFAULT 0,
  dna_vector TEXT NOT NULL, -- JSON: 50 points
  visual_traits TEXT NOT NULL, -- JSON
  audio_reactivity TEXT, -- JSON
  fitness_score INTEGER,
  impression_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  skip_count INTEGER DEFAULT 0,
  avg_view_duration INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  last_evaluated TIMESTAMP
);
```

**Indexes**:
- `dna_genomes_artwork_id_idx`
- `dna_genomes_generation_idx`
- `dna_genomes_fitness_score_idx`

## Object Storage

### Configuration
```bash
PUBLIC_OBJECT_SEARCH_PATHS=public/
PRIVATE_OBJECT_DIR=.private/
```

### Storage Structure
```
bucket/
├── public/           # Public artwork
│   ├── generated/    # AI-generated images
│   ├── library/      # Pre-generated catalog
│   └── thumbnails/   # Preview images
└── .private/         # User uploads
    ├── logos/        # Business logos
    └── uploads/      # User content
```

### Access Patterns
- **Public**: Direct URL access via CDN
- **Private**: Server-mediated access with auth
- **Temporary**: Pre-signed URLs (1 hour expiry)

## Caching Strategies

### Recently Served Cache

In-memory LRU cache preventing duplicate artwork:

```typescript
class RecentlyServedCache {
  maxPerUser: 100 artworks
  ttl: 1 hour
  key: `${userId}:${sessionId}:${endpoint}`
  eviction: LRU + TTL
}
```

### Session State Cache

PostgreSQL JSON columns for session state:
- `users.controller_state` - Credit controller state
- `art_sessions.metadata` - Generation metadata

## Data Relationships

```mermaid
erDiagram
    users ||--o{ art_sessions : creates
    users ||--o| user_credits : has
    users ||--o{ credit_ledger : transactions
    users ||--o{ art_votes : votes
    users ||--o{ rai_sessions : has
    
    art_sessions ||--o{ dna_genomes : has
    art_sessions ||--o{ user_art_impressions : viewed
    
    rai_sessions ||--o{ telemetry_events : contains
    
    art_preferences }o--|| sessions : belongs_to
```

## Data Retention Policies

| Data Type | Retention | Cleanup |
|-----------|-----------|---------|
| User Data | Indefinite | On account deletion |
| Art Sessions | 90 days unused | Batch cleanup |
| Telemetry Events | 30 days | Rolling window |
| Generation Jobs | 7 days | Auto-cleanup |
| Credit Ledger | Indefinite | Immutable |
| Cache Entries | 1 hour | TTL eviction |

## Migration Strategy

### Schema Migrations
```bash
# Generate migration
npm run db:generate

# Apply migration
npm run db:push

# Rollback
npm run db:rollback
```

### Migration Best Practices
1. Always backup before migrations
2. Test migrations in dev environment
3. Use transactions for data migrations
4. Maintain backward compatibility
5. Document breaking changes

## Performance Optimizations

### Index Strategy
- B-tree indexes for exact lookups
- GIN indexes for array containment
- Composite indexes for common queries
- Partial indexes for filtered queries

### Query Optimization
```sql
-- Example: Get fresh artworks with preference matching
SELECT * FROM art_sessions
WHERE user_id = $1
  AND session_id != $2
  AND created_at > NOW() - INTERVAL '24 hours'
  AND styles && $3  -- Array overlap
  AND is_library = false
ORDER BY quality_score DESC, created_at DESC
LIMIT 10;
```

### Connection Pooling
```javascript
{
  max: 20,          // Maximum connections
  idleTimeout: 30,  // Seconds before idle disconnect
  connectionTimeout: 2  // Seconds to wait for connection
}
```

## Backup and Recovery

### Backup Strategy
- **Frequency**: Daily automated backups
- **Retention**: 30 days rolling
- **Type**: Full + incremental
- **Location**: Separate region

### Recovery Procedures
1. Point-in-time recovery (PITR)
2. Logical backup restoration
3. Read replica promotion
4. Manual data reconstruction

## Data Security

### Encryption
- **At Rest**: AES-256 encryption
- **In Transit**: TLS 1.3
- **Secrets**: Environment variables only

### Access Control
- Row-level security (RLS) policies
- User isolation via `user_id` filtering
- Service account with minimal permissions

### PII Handling
- Email addresses: Hashed for lookups
- Payment data: Stored in Stripe only
- Sessions: Server-side only

## Cross-References

- [System Overview](00-system-overview.md)
- [API Documentation](02-services-and-interfaces.md)
- [Security Model](06-security-and-compliance.md)
- [Data Flow Diagram](../diagrams/data-flow.mmd)