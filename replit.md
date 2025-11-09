# Algorhythmic - AI-Powered Audio-Reactive Art Platform

## Overview
Algorhythmic is a revenue-generating web application that transforms sound into real-time AI-generated artwork. Users can select artistic styles and artists, and the AI creates audio-reactive visualizations. The system continuously improves personalization through user voting. The project aims to be a cross-platform web app with future plans for native TV applications and social features, operating on a freemium model.

## User Preferences
- Theme: Light mode default with dark mode toggle
- Platform targets: Smart TVs, tablets, smartphones

## System Architecture

### Frontend
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS + Shadcn UI components
- **State Management**: TanStack Query (React Query)
- **Audio Processing**: Web Audio API
- **UI/UX**: Fullscreen canvas, auto-hiding controls, responsive design, 10-foot UI for TV optimization, Ken Burns effect with enhanced zoom and parallax translation.

### Backend
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Replit Auth with OpenID Connect (Passport.js)
- **Real-time**: WebSocket Server (ws package)

### AI Art Generation & Morphing
- **Audio Capture & Analysis**: Extracts frequency, amplitude, tempo, mood.
- **Music Identification**: ACRCloud identifies playing songs.
- **Prompt Generation**: GPT-4o Vision or GPT-5 generates DALL-E prompts based on user preferences, audio mood, music identity, and voting history, including a 50-point "DNA vector".
- **Image Generation**: DALL-E 3 creates 1024x1024 artwork.
- **Permanent Storage**: Images are downloaded and stored in Replit Object Storage with a robust verification and retry pipeline.
- **DNA Morphing System**: Each artwork's 50-point DNA vector enables smooth, procedural morphing between frames over 1-minute cycles, with audio-reactive modulation.
- **Frame Pool Management**: Ensures continuous morphing, smart synchronization of new frames, stable deduplication, hard cap enforcement (max 20 frames), and active frame protection. Features **priority insertion** via `insertFrameAfterCurrent()` - freshly generated artwork appears immediately instead of waiting ~20 minutes in FIFO queue. Provides a first-run experience with placeholder frames.
- **Rendering Engines (Morpheus)**:
    - **Morpheus 0.1**: Simple crossfade renderer with clean opacity blending between images. No zoom, no pan, no effects - pure image transitions.
    - **Morpheus 0.2**: Bidirectional Ken Burns system ("ships passing in the night") with mirrored-progress handoff and inverted pan for seamless motion.
    - **Morpheus 0.3**: Single-direction zoom toward camera with an opacity curve and subtle DNA-based, beat-reactive pan for cinematic slideshows.
    - **Morpheus 0.4**: Feature-based intelligent morphing using computer vision (OpenCV.js) for multi-stage transitions (currently falls back to crossfade as core implementation details for control point extraction and GL buffer creation are pending).
    - **Morpheus 0.5**: Pure Ken Burns morphing renderer with all Maestro visual effects disabled per user request. Features clean image-to-image transitions with DNA-driven zoom and pan. All audio-reactive enhancements (particles, warp distortion, color mixer, motion blur) are currently neutralized to 0/identity values, preserving only smooth morphing animations.
    - **Morpheus 0.6 "Portal Cut"** (Default - Phase 1: v0.6.0-alpha - November 2025): Intelligent anchor-based zoom renderer (standalone, no Maestro). Uses computer vision (saliency map + edge detection) to find visually interesting regions, then smoothly zooms toward that focal point with radial crossfade. Ease-in-out-quad blend curve with 1.03x baseline zoom and 1.12x peak zoom for dramatic contrast. 40% camera movement strength with smart pan bounds clamping (maxSafeTranslate = 1 - 1/zoom) to eliminate black edges. Includes AnchorDetector module with BFS clustering, mirror-border sampling, and confidence thresholding. Priority frame insertion via state-machine-consistent `pendingJumpIndex` ensures fresh artwork appears immediately. Future phases planned: v0.6.1-beta (warp + stylize), v0.6.2-final (feedback blur + portal reveal).
- **Visual Effects System**: Includes trace extraction, soft bloom/glow, chromatic drift, displacement & flow (curl noise), enhanced Ken Burns, and beat-triggered particle systems.
- **Audio-Reactive Control System**: Real-time audio analysis (FFT, RMS, spectral centroid, beat detection, BPM estimation) intelligently maps parameters to visual effects with safety caps and provides a public API for engine integration.
- **Tiered Rendering**: Adaptive rendering based on device capabilities for optimal performance.

### Maestro - Intelligent Audio-Reactive Orchestration System
**Phase 1 Complete (November 2025)** - AI-Powered Particle Control System operational at /maestro route:
**Phase 2 Complete (November 2025)** - Telemetry & Learning Infrastructure deployed:
- **AudioProbe**: Advanced audio analysis with onset detection (energy flux + adaptive threshold), tempo estimation (90s autocorrelation), and phase tracking (PLL + Kalman filter)
- **FeatureBus**: Event-driven pub/sub system for decoupled audio feature distribution
- **MaestroLoop**: Central control orchestrator connecting audio analysis to command generation
- **CommandBus**: Bounded priority queue (120 capacity) with back-pressure handling
- **Scheduler**: Frame-aligned command dispatcher with 2ms/frame budget tracking
- **ParameterRegistry**: Declarative parameter metadata (12 parameters) with range/unit/curve definitions
- **RendererManager Integration**: Lifecycle-independent parameter store with functional command execution (SET/RAMP/PULSE) supporting scalar and array interpolation, exposed via RenderContext.parameters
- **ParticlesNode (Milestone E)**: WebGL2 GPGPU particle system with transform feedback (INTERLEAVED_ATTRIBS), ping-pong buffers, audio-reactive spawning, integrated with Morpheus03Renderer
- **Browser Compatibility**: Custom EventEmitter implementation (client/src/lib/utils/EventEmitter.ts) replaces Node.js events module for AudioProbe, MaestroLoop, and FeatureBus
- **MaestroControlStore**: Policy layer managing user preferences (effect multipliers), vision-detected spawn anchor cache (10-min TTL), and climax cooldown state (24-bar minimum)
- **ClimaxDetector**: Multi-factor musical moment detection (sustained RMS >0.8 for 4s+, onset density, beat confidence spikes) with automatic reset
- **VisionFeatureService**: GPT-4o Vision integration for AI-detected spawn points (edges, focal areas, contrast), LRU caching, 45s throttling, golden ratio fallback
- **Intelligent Particle Commands**: PARTICLE_SPAWN_FIELD (loads anchor arrays into GPU uniforms), PARTICLE_BURST (triggers intense emission with duration/multiplier)
- **Smart Spawn Logic**: Weighted random anchor selection with jitter radius, graceful fallback to random when no anchors, 0.5s lerp transitions between anchor sets
- **End-to-End Flow**: Audio climax → ClimaxDetector → Vision API → Anchor cache → CommandBus → RendererManager → ParticlesNode GPU shader → Intelligent emission at AI-detected visual focal points
- **TelemetryService**: Ring buffer (1000 events), 5s debounce, batch POST to /api/telemetry/events, event types (session_start, session_end, artwork_impression, user_action, control_adjustment, climax_detected, vision_analyzed)
- **Database Schema**: 6 RAI tables (raiSessions, telemetryEvents, dnaGenomes, trendWeights, engagementRollups, userDnaProfiles) with proper indexes and foreign keys
- **Telemetry Integration**: MaestroLoop tracks climax/vision events, EffectsControlMenu tracks all parameter adjustments (9 controls: particles, warp, mixer, trace)
- **Trend Engine Backend**: /api/trends/analyze endpoint for aggregating user behavior patterns (Phase 2 MVP returns baseline, Phase 3 implements full ML analysis)
- **MaestroBrain Service**: Polls trend API every 2 minutes, generates parameter recommendations based on aggregate user preferences, respects manual overrides

### Data Models
- **ArtPreferences**: User-selected styles and artists.
- **ArtVotes**: Upvote/downvote history.
- **ArtSessions**: Globally shared generated artwork history.
- **Users**: Auth profile data, subscription tier.
- **DailyUsage**: Tracks daily generation count.
- **UserArtImpressions**: Per-user artwork view tracking for freshness pipeline (unique constraint on userId + artworkId).

### Key Features
- **Art Display**: Real-time AI-generated artwork with clean Ken Burns morphing, style/artist selection, voting system, WebSocket for multi-device sync, and timed generation.
- **Global Artwork Pool**: All generated artworks are shared across users for instant discovery.
- **Freshness Pipeline** (November 2025): Guarantees users NEVER see the same artwork frames twice via per-user impression tracking. Features: `/api/artworks/next` endpoint filtering unseen artworks, automatic impression recording on frame load, React Query cache invalidation after each view, HTTP no-cache headers to prevent stale responses, auto-generation trigger when unseen pool < 5 artworks. Implementation uses `user_art_impressions` table with unique(userId, artworkId) constraint and ON CONFLICT DO NOTHING for thread-safe deduplication.
- **User Gallery Page**: Protected route for managing user artworks.
- **Subscription Page**: Stripe payment integration with a 7-day free trial and tier comparison.
- **Style Selector**: Visual grid of 71 artistic styles across 8 master groups, with dynamic AI mode.
- **Debug Overlay**: Toggle-able verbose mode showing active effects, frame opacities, zoom levels, shader status, and FPS.
- **Effects Control Menu**: Slide-out menu with checkboxes and sliders to adjust visual effects (currently disabled for pure morphing mode).
- **Effect History Logging**: Per-frame JSON logs for debugging and analysis.
- **Design System**: Purple primary color, Inter font, Shadcn UI components, subtle animations, mobile-first and TV-optimized responsive design.
- **Landing Page**: Hero video background using "Surreal_flowing_abstract_art_video_2_1762650434281.mp4" at native playback speed.

## External Dependencies
- **OpenAI API**: GPT-5, DALL-E 3, GPT-4o Vision for AI art generation and analysis.
- **Stripe API**: For payment processing and subscription management.
- **ACRCloud API**: For music identification.
- **Spotify API**: For retrieving album artwork and metadata.
- **Replit Auth**: For user authentication.
- **PostgreSQL**: Primary database.
- **OpenCV.js**: Computer vision library, locally hosted for performance and reliability, with a fallback mechanism if loading fails.