# Services and Interfaces Documentation

## API Overview

The Algorhythmic platform exposes a comprehensive REST API with WebSocket support for real-time features. All API endpoints are prefixed with `/api` and return JSON responses.

### Base URL
```
Development: http://localhost:5000
Production: https://[your-domain]
```

### Authentication
Most endpoints require authentication via Replit Auth (OIDC). Authenticated requests include JWT tokens in the session.

## API Endpoints Reference

### Authentication & User Management

#### GET `/api/auth/user`
**Purpose**: Retrieve authenticated user information  
**Auth Required**: Yes  
**Response Schema**:
```typescript
{
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  subscriptionTier: string; // free|premium|ultimate|enthusiast|business_basic|business_premium
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  isActive: boolean;
  preferredOrientation?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

#### GET `/api/login`
**Purpose**: Initiate OAuth login flow  
**Auth Required**: No  
**Redirects to**: Replit Auth provider

#### GET `/api/logout`
**Purpose**: Logout and clear session  
**Auth Required**: Yes  
**Redirects to**: Home page

### Usage & Credits

#### GET `/api/usage/check`
**Purpose**: Check user's daily generation limit  
**Auth Required**: Yes  
**Response Schema**:
```typescript
{
  withinLimit: boolean;
  generationCount: number;
  dailyLimit: number;
  remaining: number;
}
```

#### GET `/api/usage/stats`
**Purpose**: Get detailed usage statistics  
**Auth Required**: Yes  
**Response Schema**:
```typescript
{
  count: number;
  limit: number;
  remaining: number;
  date: string; // YYYY-MM-DD
}
```

### Art Generation

#### POST `/api/generate-art`
**Purpose**: Generate new AI artwork  
**Auth Required**: Yes  
**Request Schema**:
```typescript
{
  sessionId: string;
  audioAnalysis?: {
    frequency: number;
    amplitude: number;
    bassLevel: number;
    trebleLevel: number;
    tempo: number;
    mood: string;
    confidence: number;
  };
  preferences?: {
    styles?: string[];
    artists?: string[];
    dynamicMode?: boolean;
  };
}
```
**Response Schema**:
```typescript
{
  imageUrl: string;
  prompt: string;
  dnaVector: number[]; // 50-point array
  sessionId: string;
  userId: string;
}
```

#### POST `/api/catalogue-bridge`
**Purpose**: Get instant artwork from library  
**Auth Required**: Yes  
**Request Schema**:
```typescript
{
  sessionId: string;
  styleTags?: string[];
  artistTags?: string[];
  orientation?: string; // portrait|landscape|square
  limit?: number; // default: 2
}
```
**Response Schema**:
```typescript
{
  artworks: ArtSession[];
  tier: 'exact' | 'related' | 'global' | 'procedural';
  latencyMs: number;
  bridgeMode?: 'combo' | 'proxy' | 'decoupled';
}
```

#### POST `/api/style-transition`
**Purpose**: Handle style transitions with catalog fallback  
**Auth Required**: Yes  
**Request Schema**:
```typescript
{
  sessionId: string;
  fromStyle?: string;
  toStyle: string;
  artistTags?: string[];
  orientation?: string;
}
```

#### GET `/api/artworks/next`
**Purpose**: Get next artworks with fallback cascade  
**Auth Required**: Yes  
**Query Parameters**:
- `sessionId`: string
- `limit`: number (default: 2)
- `orientation`: portrait|landscape|square

#### POST `/api/artworks/next`
**Purpose**: Hybrid generation and retrieval  
**Auth Required**: Yes  
**Request Schema**:
```typescript
{
  sessionId: string;
  audioAnalysis?: AudioAnalysis;
  musicInfo?: MusicIdentification;
  preferences?: ArtPreference;
  orientation?: string;
}
```

#### POST `/api/artworks/:artworkId/viewed`
**Purpose**: Record artwork impression  
**Auth Required**: Yes  
**URL Parameters**:
- `artworkId`: string

#### POST `/api/artworks/batch-impressions`
**Purpose**: Record multiple impressions  
**Auth Required**: Yes  
**Request Schema**:
```typescript
{
  impressions: Array<{
    artworkId: string;
    timestamp: Date;
    viewDuration?: number;
    tier?: string;
  }>;
}
```

### Music & Audio

#### POST `/api/identify-music`
**Purpose**: Identify music via ACRCloud  
**Auth Required**: Yes  
**Request**: Multipart form with audio blob  
**Response Schema**:
```typescript
{
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  releaseDate?: string;
  confidence: number;
}
```

### Preferences & Voting

#### GET `/api/preferences/:sessionId`
**Purpose**: Get session preferences  
**Auth Required**: No  
**Response Schema**:
```typescript
{
  styles: string[];
  artists: string[];
  dynamicMode: boolean;
}
```

#### POST `/api/preferences`
**Purpose**: Save preferences  
**Auth Required**: No  
**Request Schema**:
```typescript
{
  sessionId: string;
  styles?: string[];
  artists?: string[];
  dynamicMode?: boolean;
}
```

#### POST `/api/vote`
**Purpose**: Vote on artwork  
**Auth Required**: No  
**Request Schema**:
```typescript
{
  sessionId: string;
  artPrompt: string;
  vote: number; // 1 or -1
  audioCharacteristics?: object;
}
```

### Monitoring & Health

#### GET `/api/health`
**Purpose**: Health check  
**Auth Required**: No  
**Response**: `{ status: "ok" }`

#### GET `/api/monitoring/resilience`
**Purpose**: Comprehensive resilience dashboard  
**Auth Required**: Yes  
**Response Schema**:
```typescript
{
  circuitBreaker: {
    state: 'closed' | 'open' | 'half_open';
    tokens: number;
    timeoutMs: number;
    metrics: HealthMetrics;
  };
  queueController: {
    state: 'HUNGRY' | 'SATISFIED' | 'OVERFULL';
    decision: GenerationDecision;
  };
  recoveryManager: {
    isRecovering: boolean;
    recoveryQueue: number;
  };
  fallbackCascade: {
    catalogHits: number;
    proceduralHits: number;
  };
  recentGenerations: GenerationHistory[];
}
```

### Telemetry

#### POST `/api/telemetry/session/start`
**Purpose**: Start RAI session  
**Auth Required**: Yes  
**Request Schema**:
```typescript
{
  clientSessionId: string;
  platform: string;
  screenSize?: string;
}
```

#### POST `/api/telemetry/events`
**Purpose**: Batch insert telemetry events  
**Auth Required**: Yes  
**Request Schema**:
```typescript
{
  events: TelemetryEvent[];
}
```

#### GET `/api/telemetry/dashboard`
**Purpose**: Admin telemetry dashboard  
**Auth Required**: Yes  
**Response**: Complex dashboard data

#### GET `/api/telemetry/metrics`
**Purpose**: Prometheus metrics export  
**Auth Required**: No  
**Response**: Prometheus text format

### Payment

#### POST `/api/create-payment-intent`
**Purpose**: Create Stripe payment intent  
**Auth Required**: Yes  
**Request Schema**:
```typescript
{
  tier: string; // premium|ultimate|enthusiast|business_basic|business_premium
}
```
**Response Schema**:
```typescript
{
  clientSecret: string;
  amount: number;
  currency: string;
}
```

### Admin & Testing

#### POST `/api/admin/update-tier`
**Purpose**: Update user subscription tier (placeholder)  
**Auth Required**: Yes  
**Note**: Returns instructions for manual DB update

#### POST `/api/test/force-breaker-open`
**Purpose**: Force circuit breaker open  
**Auth Required**: No (Dev only)  
**Request Schema**:
```typescript
{
  durationMs?: number; // default: 300000
}
```

#### POST `/api/test/generate`
**Purpose**: Test generation without auth  
**Auth Required**: No (Dev only)  
**Request Schema**: Same as `/api/generate-art`

## WebSocket Interface

### Connection
```javascript
const ws = new WebSocket('ws://localhost:5000/ws');
```

### Message Types

#### Client → Server

**AUDIO_FRAME**
```typescript
{
  type: 'AUDIO_FRAME';
  seq?: number;
  data: {
    frequency: number;
    amplitude: number;
    bassLevel: number;
    trebleLevel: number;
    tempo: number;
    mood: string;
  };
}
```

**ACK**
```typescript
{
  type: 'ACK';
  seq: number;
  clientId: string;
}
```

**RESYNC_REQUEST**
```typescript
{
  type: 'RESYNC_REQUEST';
  clientId: string;
  lastKnownSeq: number;
}
```

#### Server → Client

**ARTWORK_UPDATE**
```typescript
{
  type: 'ARTWORK_UPDATE';
  seq: number;
  data: {
    imageUrl: string;
    prompt: string;
    dnaVector: number[];
  };
}
```

**RENDER_ACK**
```typescript
{
  type: 'RENDER_ACK';
  seq: number;
  data: {
    artworkId: string;
    rendered: boolean;
  };
}
```

## Service Interfaces

### IStorage Interface

Core database abstraction layer providing all data operations:

```typescript
interface IStorage {
  // Art Preferences
  getPreferencesBySession(sessionId: string): Promise<ArtPreference | undefined>;
  createOrUpdatePreferences(sessionId: string, styles: string[], artists: string[], dynamicMode?: boolean): Promise<ArtPreference>;
  
  // Art Sessions
  createArtSession(session: InsertArtSession): Promise<ArtSession>;
  getSessionHistory(sessionId: string, limit?: number): Promise<ArtSession[]>;
  getFreshArtworks(sessionId: string, userId: string, limit: number): Promise<ArtSession[]>;
  
  // Credit System
  deductCredits(userId: string, amount: number, reason: string): Promise<CreditTransaction>;
  grantCredits(userId: string, amount: number, reason: string): Promise<CreditTransaction>;
  getCreditsBalance(userId: string): Promise<number>;
  
  // Telemetry
  createTelemetryEvents(events: InsertTelemetryEvent[]): Promise<void>;
  getRecentTelemetry(limit: number): Promise<TelemetryEvent[]>;
  
  // And 50+ more methods...
}
```

### GenerationHealthPort Interface

Circuit breaker for DALL-E generation:

```typescript
interface GenerationHealthPort {
  shouldAttemptGeneration(): boolean;
  registerJob(jobId: string, isProbe: boolean): void;
  recordSuccess(jobId: string, latency: number): void;
  recordFailure(jobId: string, reason: string): void;
  getTimeout(): number; // Adaptive timeout 45-90s
  getDetailedStatus(): HealthStatus;
  forceOpen(durationMs?: number): string;
  forceClosed(): void;
}
```

### RecoveryPort Interface

Service recovery management:

```typescript
interface RecoveryPort {
  getRecoveryBatchSize(): number;
  attemptRecoveryProbe(): Promise<boolean>;
  getStatus(): RecoveryStatus;
  reset(): void;
}
```

## Error Responses

All errors follow this schema:

```typescript
{
  message: string;
  error?: string;
  code?: string;
  status: number;
}
```

### Common Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_REQUEST` | Missing or invalid parameters |
| 401 | `UNAUTHORIZED` | Authentication required |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |
| 503 | `SERVICE_UNAVAILABLE` | Circuit breaker open |

## Rate Limiting

- **OpenAI Vision**: 60 requests/minute
- **ACRCloud**: 100 requests/minute
- **Generation**: Credit-based (not time-based)
- **WebSocket**: No hard limit, managed by sequence

## Cross-References

- [System Overview](00-system-overview.md)
- [Database Schema](03-data-and-storage.md)
- [Security Model](06-security-and-compliance.md)
- [Request Lifecycle](../diagrams/request-lifecycle.mmd)