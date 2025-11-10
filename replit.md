# Algorhythmic - AI-Powered Audio-Reactive Art Platform

## Overview
Algorhythmic is a revenue-generating web application that transforms sound into real-time, AI-generated artwork. It allows users to select artistic styles and artists, generating audio-reactive visualizations that continuously improve personalization through user voting. The project aims to be a cross-platform web app with future plans for native TV applications and social features, operating on a freemium model.

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
- **Audio Analysis**: Extracts frequency, amplitude, tempo, mood.
- **Music Identification**: ACRCloud identifies songs and integrates context into prompt generation.
- **Prompt Generation**: GPT-4o Vision generates DALL-E prompts based on user preferences, audio mood, music context, and voting history, including a 50-point "DNA vector."
- **Image Generation**: DALL-E 3 creates 1024x1024 artwork.
- **Storage**: Images are stored in Replit Object Storage.
- **Hybrid Gen+Retrieve Pipeline**: Selects best DNA/motif match from a warm-start pool for instant display, then asynchronously generates fresh artwork which seamlessly hot-swaps via WebSocket.
- **DNA Morphing System**: Enables smooth, procedural morphing between frames over 1-minute cycles with audio-reactive modulation using a 50-point DNA vector.
- **Frame Pool Management**: Ensures continuous morphing, smart synchronization of new frames, deduplication, and active frame protection with priority insertion for freshly generated artwork.
- **Rendering Engines (Morpheus)**: Evolves from simple crossfade (0.1) to advanced Ken Burns (0.2, 0.3, 0.5) and intelligent anchor-based zoom with radial crossfade (0.6 "Portal Cut"), with future plans for CV-based feature morphing (0.4).
- **Visual Effects System**: Includes trace extraction, soft bloom/glow, chromatic drift, displacement & flow, enhanced Ken Burns, and beat-triggered particle systems.
- **Audio-Reactive Control System**: Real-time audio analysis maps parameters to visual effects with safety caps and provides a public API.
- **Tiered Rendering**: Adaptive rendering based on device capabilities.

### Maestro - Intelligent Audio-Reactive Orchestration System
- **Core Components**: Advanced audio analysis (AudioProbe), event-driven feature distribution (FeatureBus), central control orchestrator (MaestroLoop), bounded priority command queue (CommandBus), frame-aligned command dispatcher (Scheduler), and declarative parameter metadata (ParameterRegistry).
- **Particle System**: WebGL2 GPGPU particle system with transform feedback, audio-reactive spawning, integrated with Morpheus renderers.
- **Control & Learning**: Manages user preferences (effect multipliers), vision-detected spawn anchor cache, and climax cooldown state. Features a multi-factor musical climax detection.
- **Vision Integration**: GPT-4o Vision for AI-detected particle spawn points (edges, focal areas, contrast) with LRU caching.
- **Intelligent Particle Commands**: Manages particle spawning with weighted random anchor selection and smooth transitions.
- **Telemetry & Learning**: Records user interaction and system events, storing them in a ring buffer for batch POST to a telemetry endpoint. Includes a Trend Engine backend to analyze user behavior and generate parameter recommendations.

### Data Models
- **ArtPreferences**: User artistic selections.
- **ArtVotes**: User upvote/downvote history.
- **ArtSessions**: Shared generated artwork history.
- **Users**: Authentication profiles and subscription tiers.
- **DailyUsage**: Tracks daily generation counts.
- **UserArtImpressions**: Tracks artworks viewed by each user.

### Key Features
- **Art Display**: Real-time AI-generated artwork with Ken Burns morphing, style/artist selection, voting, WebSocket sync, and timed generation.
- **First-Time Setup Wizard**: Onboarding flow for new users to select style preferences before artwork loading.
- **Global Artwork Pool**: All generated artworks are shared across users.
- **Freshness Pipeline**: Ensures users never see the same artwork frames twice via per-user impression tracking and automatic generation triggers.
- **User Gallery Page**: Protected route for managing user artworks.
- **Subscription Page**: Stripe integration for payments, 7-day free trial, and tier comparison.
- **Style Selector**: Visual grid of artistic styles with dynamic AI mode.
- **Debug Overlay**: Toggle-able display for active effects, frame opacities, zoom, shader status, and FPS.
- **Effects Control Menu**: Slide-out menu for adjusting visual effects.
- **Effect History Logging**: Per-frame JSON logs for analysis.
- **Design System**: Purple primary color, Inter font, Shadcn UI, subtle animations, mobile-first, and TV-optimized design.
- **Landing Page**: Hero video background.

## External Dependencies
- **OpenAI API**: GPT-5, DALL-E 3, GPT-4o Vision for AI art generation and analysis.
- **Stripe API**: For payment processing and subscription management.
- **ACRCloud API**: For music identification.
- **Spotify API**: For retrieving album artwork and metadata.
- **Replit Auth**: For user authentication.
- **PostgreSQL**: Primary database.
- **OpenCV.js**: Computer vision library.