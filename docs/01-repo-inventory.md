# Repository Inventory

## Directory Structure Overview

```
algorhythmic/
├── client/              # Frontend React application
├── server/              # Backend Node.js/Express server
├── shared/              # Shared TypeScript types and schemas
├── docs/                # Documentation
├── diagrams/            # Architecture diagrams
├── scripts/             # Utility scripts
├── tests/               # Test suites
├── attached_assets/     # Static assets and generated images
└── public/              # Public static files
```

## Detailed File and Folder Inventory

### Root Files

| File | Purpose | Critical |
|------|---------|----------|
| `package.json` | Project dependencies and scripts | ✅ |
| `tsconfig.json` | TypeScript configuration | ✅ |
| `vite.config.ts` | Vite bundler configuration | ✅ |
| `drizzle.config.ts` | Database ORM configuration | ✅ |
| `tailwind.config.ts` | Tailwind CSS configuration | ✅ |
| `playwright.config.ts` | E2E test configuration | |
| `postcss.config.js` | PostCSS configuration | |
| `components.json` | Shadcn UI component config | |
| `replit.md` | Project overview and preferences | ✅ |
| `design_guidelines.md` | UI/UX design specifications | |

### `/client` - Frontend Application

#### `/client/src`

| Path | Purpose |
|------|---------|
| `App.tsx` | Main application component with routing |
| `main.tsx` | Application entry point |
| `index.css` | Global styles and theme variables |

#### `/client/src/pages`

| File | Purpose | Route |
|------|---------|-------|
| `landing.tsx` | Home page with feature showcase | `/` |
| `display.tsx` | Main art display interface | `/display` |
| `maestro.tsx` | Advanced control interface | `/maestro` |
| `gallery.tsx` | Art gallery view | `/gallery` |
| `subscribe.tsx` | Subscription management | `/subscribe` |
| `webgl-test.tsx` | WebGL capability testing | `/webgl-test` |
| `telemetry.tsx` | Admin telemetry dashboard | `/admin/telemetry` |
| `breaker-test.tsx` | Circuit breaker testing | `/breaker-test` |
| `not-found.tsx` | 404 page | `*` |

#### `/client/src/components`

| Component | Purpose |
|-----------|---------|
| `animated-background.tsx` | Animated UI backgrounds |
| `audio-source-selector.tsx` | Audio input selection |
| `AudioDebugOverlay.tsx` | Audio debugging UI |
| `debug-overlay.tsx` | Debug information overlay |
| `DynamicModeController.tsx` | Dynamic mode controls |
| `effects-control-menu.tsx` | Visual effects controls |
| `style-selector.tsx` | Art style selection UI |
| `theme-provider.tsx` | Theme context provider |
| `theme-toggle.tsx` | Light/dark mode toggle |
| `PlaceholderFrame.tsx` | Loading placeholder |

#### `/client/src/lib`

##### Core Libraries

| File | Purpose |
|------|---------|
| `morphEngine.ts` | Core morphing engine |
| `RendererManager.ts` | WebGL/Canvas renderer management |
| `websocket-client.ts` | WebSocket client implementation |
| `audio-analyzer.ts` | Audio processing utilities |
| `client-telemetry.ts` | Client-side metrics collection |
| `deviceDetection.ts` | Device capability detection |
| `dna.ts` | DNA vector processing |
| `FrameBuffer.ts` | Frame buffering system |
| `FrameValidator.ts` | Frame validation utilities |
| `tier1Renderer.ts` | Canvas2D fallback renderer |

##### `/client/src/lib/audio`

| File | Purpose |
|------|---------|
| `AudioAnalyzer.ts` | Advanced audio analysis |
| `AudioProbe.ts` | Audio probing utilities |
| `AudioReactiveController.ts` | Audio-reactive control system |
| `AudioReactiveMapper.ts` | Audio to visual mapping |

##### `/client/src/lib/maestro`

| Folder/File | Purpose |
|-------------|---------|
| `brain/MaestroBrain.ts` | Central control logic |
| `climax/ClimaxDetector.ts` | Music climax detection |
| `control/CommandBus.ts` | Command pattern implementation |
| `control/FeatureBus.ts` | Feature flag management |
| `control/MaestroControlStore.ts` | State management |
| `control/MaestroLoop.ts` | Main control loop |
| `telemetry/TelemetryService.ts` | Telemetry collection |
| `vision/VisionFeatureService.ts` | Vision API integration |

##### `/client/src/lib/renderers`

| File | Purpose | Status |
|------|---------|---------|
| `Morpheus01Renderer.ts` | Basic morphing | Active |
| `Morpheus02Renderer.ts` | Enhanced morphing | Active |
| `Morpheus03Renderer.ts` | Advanced effects | Active |
| `Morpheus04Renderer.ts` | Flow-based morphing | Active |
| `Morpheus05Renderer.ts` | Particle systems | Active |
| `Morpheus06Renderer.ts` | Anchor detection | Active |
| `EngineRegistry.ts` | Renderer registration | Core |

### `/server` - Backend Application

#### Core Server Files

| File | Purpose |
|------|---------|
| `index.ts` | Server entry point |
| `routes.ts` | API route definitions |
| `storage.ts` | Database abstraction layer |
| `bootstrap.ts` | Service initialization |
| `db-bootstrap.ts` | Database initialization |
| `vite.ts` | Vite middleware setup |
| `replitAuth.ts` | Authentication setup |
| `websocket-sequence.ts` | WebSocket sequencing |

#### Service Files

| File | Purpose |
|------|---------|
| `openai-service.ts` | DALL-E integration |
| `music-service.ts` | ACRCloud integration |
| `spotify-service.ts` | Spotify integration |
| `telemetry-service.ts` | Telemetry collection |
| `objectStorage.ts` | Object storage management |
| `fallback-service.ts` | Fallback cascade logic |

#### Generation Pipeline

| File | Purpose |
|------|---------|
| `generation-health.ts` | Circuit breaker implementation |
| `queue-controller.ts` | Queue state management |
| `recovery-manager.ts` | Service recovery logic |
| `dead-letter-queue.ts` | Failed job tracking |
| `recently-served-cache.ts` | Deduplication cache |

#### `/server/generation`

| File | Purpose |
|------|---------|
| `audioAnalyzer.ts` | Audio feature extraction |
| `catalogMatcher.ts` | Catalog matching logic |
| `catalogueIntegration.ts` | Catalog system integration |
| `creditController.ts` | Credit management |
| `fallbackOrchestrator.ts` | Fallback orchestration |

#### `/server/services`

| File | Purpose |
|------|---------|
| `catalogue-manager.ts` | Artwork catalog management |
| `fal-ai-provider.ts` | Fal.ai integration |
| `generation-provider.ts` | Generation abstraction |
| `imagePool.ts` | Image pool management |
| `palette-extractor.ts` | Color palette extraction |
| `vision-analyzer.ts` | GPT-4 Vision integration |

### `/shared` - Shared Types and Schemas

| File | Purpose |
|------|---------|
| `schema.ts` | Database schema definitions |
| `maestroTypes.ts` | Maestro system types |
| `style-relations.ts` | Style relationship mappings |

### `/scripts` - Utility Scripts

| File | Purpose |
|------|---------|
| `catalogue-seed.ts` | Seed catalog data |
| `catalogue-enrich.ts` | Enrich catalog metadata |
| `catalogue-config.ts` | Catalog configuration |
| `prompt-generator.ts` | Generate art prompts |
| `reset-circuit-breaker.ts` | Reset circuit breaker |
| `validate-style-relations.ts` | Validate style relationships |

### `/tests` - Test Suites

| Path | Purpose |
|------|---------|
| `e2e/art-generation.test.ts` | E2E art generation tests |
| `helpers/canvas-analysis.ts` | Canvas testing utilities |
| `test-recently-served-cache.ts` | Cache unit tests |
| `README.md` | Test documentation |

### `/docs` - Documentation

| File | Purpose |
|------|---------|
| `00-system-overview.md` | System architecture overview |
| `01-repo-inventory.md` | This file |
| `02-services-and-interfaces.md` | API documentation |
| `03-data-and-storage.md` | Database schemas |
| `04-runtime-and-pipelines.md` | Runtime behavior |
| `05-build-test-deploy.md` | Build and deployment |
| `06-security-and-compliance.md` | Security documentation |
| `07-ops-runbook.md` | Operations manual |
| `08-gaps-issues-roadmap.md` | Technical debt |
| `*.md` | Various technical reports |

### `/diagrams` - Architecture Diagrams

| File | Purpose |
|------|---------|
| `architecture.mmd` | System architecture |
| `module-deps.mmd` | Module dependencies |
| `data-flow.mmd` | Data flow diagram |
| `request-lifecycle.mmd` | Request flow |

## Key Configuration Files

### Environment Variables Required

```bash
# Core
PORT=5000
NODE_ENV=development|production
DATABASE_URL=postgresql://...

# Authentication
REPL_ID=<replit_id>

# External Services
OPENAI_API_KEY=<key>
STRIPE_SECRET_KEY=<key>
ACRCLOUD_ACCESS_KEY=<key>
ACRCLOUD_ACCESS_SECRET=<key>

# Storage
PUBLIC_OBJECT_SEARCH_PATHS=<paths>
PRIVATE_OBJECT_DIR=<path>

# Feature Flags
GEN_BREAKER_ENABLED=true
TEST_SERVICE_TOKEN=<token>
```

## File Statistics

- **Total Files**: ~250+
- **Lines of Code**: ~25,000+
- **TypeScript**: 90%
- **JavaScript**: 5%
- **CSS/Styles**: 5%

## Critical Paths

1. **Generation Flow**: `routes.ts` → `openai-service.ts` → `generation-health.ts`
2. **Fallback Cascade**: `fallback-service.ts` → `storage.ts` → `recently-served-cache.ts`
3. **Rendering Pipeline**: `display.tsx` → `RendererManager.ts` → `Morpheus*Renderer.ts`
4. **Credit System**: `creditController.ts` → `storage.ts` → PostgreSQL

## Cross-References

- [System Overview](00-system-overview.md)
- [API Documentation](02-services-and-interfaces.md)
- [Database Schema](03-data-and-storage.md)