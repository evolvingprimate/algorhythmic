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
- **DNA Morphing System**: Each artwork's 50-point DNA vector enables smooth, procedural morphing between frames over 5-minute cycles, with audio-reactive modulation.
- **Frame Pool Management**: Ensures continuous morphing, smart synchronization of new frames, stable deduplication, hard cap enforcement (max 20 frames), and active frame protection. Provides a first-run experience with placeholder frames.
- **Rendering Engines (Morpheus)**:
    - **Morpheus 0.1**: Simple cross-fade.
    - **Morpheus 0.2**: Bidirectional Ken Burns system ("ships passing in the night") with mirrored-progress handoff and inverted pan for seamless motion.
    - **Morpheus 0.3**: Single-direction zoom toward camera with an opacity curve and subtle DNA-based, beat-reactive pan for cinematic slideshows.
    - **Morpheus 0.4**: Feature-based intelligent morphing using computer vision (OpenCV.js) for multi-stage transitions (currently falls back to crossfade as core implementation details for control point extraction and GL buffer creation are pending).
    - **Morpheus 0.5** (Default): Fully Maestro-controlled renderer with all visual parameters driven by Maestro commands. Features modular rendering pipeline (Ken Burns, Particles, Warp, Mixer) with audio-reactive effects. Parameters include mixer controls (saturation, brightness, contrast), warp distortion (elasticity, radius), and particle system integration. Standalone compatible with fallback defaults when Maestro inactive.
- **Visual Effects System**: Includes trace extraction, soft bloom/glow, chromatic drift, displacement & flow (curl noise), enhanced Ken Burns, and beat-triggered particle systems.
- **Audio-Reactive Control System**: Real-time audio analysis (FFT, RMS, spectral centroid, beat detection, BPM estimation) intelligently maps parameters to visual effects with safety caps and provides a public API for engine integration.
- **Tiered Rendering**: Adaptive rendering based on device capabilities for optimal performance.

### Maestro - Intelligent Audio-Reactive Orchestration System
**Phase 1 Complete** - Core data pipeline operational at /maestro route:
- **AudioProbe**: Advanced audio analysis with onset detection (energy flux + adaptive threshold), tempo estimation (90s autocorrelation), and phase tracking (PLL + Kalman filter)
- **FeatureBus**: Event-driven pub/sub system for decoupled audio feature distribution
- **MaestroLoop**: Central control orchestrator connecting audio analysis to command generation
- **CommandBus**: Bounded priority queue (120 capacity) with back-pressure handling
- **Scheduler**: Frame-aligned command dispatcher with 2ms/frame budget tracking
- **ParameterRegistry**: Declarative parameter metadata (12 parameters) with range/unit/curve definitions
- **RendererManager Integration**: Lifecycle-independent parameter store with functional command execution (SET/RAMP/PULSE) supporting scalar and array interpolation, exposed via RenderContext.parameters
- **ParticlesNode (Milestone E)**: WebGL2 GPGPU particle system with transform feedback (INTERLEAVED_ATTRIBS), ping-pong buffers, audio-reactive spawning, integrated with Morpheus03Renderer
- **Browser Compatibility**: Custom EventEmitter implementation (client/src/lib/utils/EventEmitter.ts) replaces Node.js events module for AudioProbe, MaestroLoop, and FeatureBus

### Data Models
- **ArtPreferences**: User-selected styles and artists.
- **ArtVotes**: Upvote/downvote history.
- **ArtSessions**: Globally shared generated artwork history.
- **Users**: Auth profile data, subscription tier.
- **DailyUsage**: Tracks daily generation count.

### Key Features
- **Art Display**: Real-time audio-reactive visualizations, style/artist selection, voting system, WebSocket for multi-device sync, and timed generation.
- **Global Artwork Pool**: All generated artworks are shared across users for instant discovery.
- **User Gallery Page**: Protected route for managing user artworks.
- **Subscription Page**: Stripe payment integration with a 7-day free trial and tier comparison.
- **Style Selector**: Visual grid of 71 artistic styles across 8 master groups, with dynamic AI mode.
- **Debug Overlay**: Toggle-able verbose mode showing active effects, frame opacities, zoom levels, shader status, and FPS.
- **Effects Control Menu**: Slide-out menu with checkboxes and sliders to adjust visual effects.
- **Effect History Logging**: Per-frame JSON logs for debugging and analysis.
- **Design System**: Purple primary color, Inter font, Shadcn UI components, subtle animations, mobile-first and TV-optimized responsive design.

## External Dependencies
- **OpenAI API**: GPT-5, DALL-E 3, GPT-4o Vision for AI art generation and analysis.
- **Stripe API**: For payment processing and subscription management.
- **ACRCloud API**: For music identification.
- **Spotify API**: For retrieving album artwork and metadata.
- **Replit Auth**: For user authentication.
- **PostgreSQL**: Primary database.
- **OpenCV.js**: Computer vision library, locally hosted for performance and reliability, with a fallback mechanism if loading fails.