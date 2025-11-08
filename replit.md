# Algorhythmic - AI-Powered Audio-Reactive Art Platform

## Overview
Algorhythmic is a revenue-generating web application that transforms sound into stunning AI-generated artwork in real-time. Users select artistic styles and artists, and the AI creates audio-reactive visualizations. The system learns from user preferences through voting to continuously improve personalization. The project aims to be a cross-platform web app, with future plans for native TV applications and social features, operating on a freemium model.

## User Preferences
- Theme: Light mode default with dark mode toggle
- Platform targets: Smart TVs, tablets, smartphones

## System Architecture

### Frontend
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS + Shadcn UI components
- **State Management**: TanStack Query (React Query)
- **Audio Processing**: Web Audio API for microphone access and analysis
- **UI/UX**: Fullscreen canvas, auto-hiding controls, responsive design, 10-foot UI for TV optimization, Ken Burns effect with enhanced zoom and parallax translation.

### Backend
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Replit Auth with OpenID Connect (Passport.js)
- **Real-time**: WebSocket Server (ws package)
- **Artwork Discovery**: Global artwork pool shared across all users, enabling instant display and organic discovery

### AI Art Generation & Morphing
- **Audio Capture & Analysis**: Extracts frequency, amplitude, tempo, mood.
- **Music Identification**: ACRCloud identifies the playing song.
- **Prompt Generation**: GPT-4o Vision (with album art) or GPT-5 generates DALL-E prompts based on user preferences, audio mood, music identity, and voting history. A 50-point "DNA vector" is generated alongside the prompt.
- **Image Generation**: DALL-E 3 creates 1024x1024 artwork.
- **Permanent Storage**: Images are downloaded from DALL-E and stored permanently in Replit Object Storage with a comprehensive triple verification and retry pipeline to ensure persistence and integrity.
- **DNA Morphing System**: Each artwork has a 50-point DNA vector enabling smooth, procedural morphing between frames over 5-minute cycles, with audio-reactive modulation.
- **Frame Pool Management**: 
  - **Smart Sync**: Watches `/api/recent-artworks` query and automatically adds only NEW frames to MorphEngine without resetting playback
  - **Stable Deduplication**: Uses `hasImageUrl()` method to prevent duplicate frames (handles null IDs and placeholder frames)
  - **Hard Cap Enforcement**: After adding new frames, prunes oldest frames to maintain exactly 20 frames max
  - **Active Frame Protection**: Resets phase timing if currently playing frame is pruned, preventing mid-morph jump cuts
  - **First-Run Experience**: Brand new users get placeholder frames + automatic generation trigger (no black screen)
  - **Timed Generation**: Triggers artwork creation every 5 minutes → smart sync automatically adds result → pruning maintains cap
  - **Architecture**: No `morphEngine.reset()` calls except on first-run empty check → ensures continuous morphing without jump cuts
  - **Bidirectional Ken Burns System**: Frames zoom in opposite directions like "ships passing in the night" (∞ infinity symbol)
    - **Frame A (foreground)**: ALWAYS zooms OUT (expanding) while fading IN (0%→100% opacity)
    - **Frame B (background)**: ALWAYS zooms IN (contracting) while fading OUT (100%→0% opacity)
    - **Role-Based Direction Control**: Direction assigned by role (A='out', B='in'), NOT wall-clock time
    - **Mirrored-Progress Handoff**: When frame changes roles, progress mirrors (1 - currentProgress) instead of resetting to 0
      - Example: Frame at 70% 'in' becomes 30% 'out' → seamless zoom/pan continuity
      - cycleStart back-computed to preserve timing: `cycleStart = now - (mirroredProgress * KEN_BURNS_CYCLE)`
      - Prevents visual jumps by maintaining equivalent position on opposite zoom curve
    - **Inverted Pan**: Pan progress inverted for 'out' direction (`1 - panProgress`) to reverse smoothly
      - 'in' direction: pan 0→1 (center→edge) as zooming in
      - 'out' direction: pan 1→0 (edge→center) as zooming out
      - Creates smooth reversal instead of snap-back to center
    - **Smooth Crossover**: Frames meet at midpoint opacity, creating continuous bidirectional motion
    - **Imperceptible Swap**: When Frame B reaches 0% opacity (fully zoomed in), new frame loaded → invisible to viewer
    - **Per-Frame Progress Tracking**: Map-based tracker keyed by imageUrl with cycleStart, progress, zoomDirection fields
    - **Audio Synchronization**: Audio reactivity applied to BOTH currentDNA and nextDNA for identical zoom modulation
    - **viewProgressA/B**: Independent 0-1 progress values exposed in MorphState for per-frame zoom curves
    - Trackers cleaned up on frame prune and full reset to prevent stale state
- **Visual Effects System**: 
  - **Trace Extraction**: Three-pass rendering with Frame B alpha/luminance extraction, Sobel edge detection, 5×5 Gaussian blur, and temporal accumulation (0.85-0.95 decay) creates ethereal trailing ribbons. Multiply blend composite makes Frame B appear to "birth" from behind Frame A with DNA-controlled strength and parallax offset.
  - **Soft Bloom/Glow**: Single-pass Kawase bloom on downsampled (1/4 resolution) framebuffer extracts bright regions with DNA[48]-controlled intensity, modulated by burnIntensity for dreamy halos around bright areas during transitions.
  - **Chromatic Drift**: Post-process RGB channel separation (<1.5px) applied to final composited framebuffer, controlled by DNA[47] and morphProgress. Horizontal-only offset creates subtle hallucinatory out-of-focus feel during morphs while preserving morph fidelity.
  - **Displacement & Flow**: Curl noise flow fields with luminance weighting
  - **Ken Burns Effect**: Enhanced zoom and parallax translation
  - **Particle System**: Beat-triggered particles with bass peak detection and edge-weighted emission
- **Tiered Rendering**: Adaptive rendering based on device capabilities (RAM, GPU, WebGL/WebGPU support) for optimal performance across various devices.

### Data Models
- **ArtPreferences**: User-selected styles and artists.
- **ArtVotes**: Upvote/downvote history.
- **ArtSessions**: Generated artwork history (globally shared across all users).
- **ArtFavorites**: User favorites for weighted rotation (future feature).
- **Users**: Auth profile data, subscription tier.
- **DailyUsage**: Tracks daily generation count for users.

### Key Features
- **Art Display**: Real-time audio-reactive visualizations, style/artist selection, voting system, WebSocket for multi-device sync, timed generation.
- **Global Artwork Pool**: All generated artworks are shared across users for discovery. New users instantly see community art (no black screen). Future: weighted rotation based on user favorites.
- **User Gallery Page**: Protected route to display, save, delete, and download user artworks.
- **Subscription Page**: Stripe payment integration, 7-day free trial, feature comparison across tiers.
- **Style Selector**: Visual grid of 71 artistic styles across 8 master groups, with dynamic AI mode.
- **Debug Overlay**: Toggle-able verbose mode (Bug icon button + D key) showing active effects, frame opacities, zoom levels, shader status, and FPS in real-time.
- **Effects Control Menu**: Sphere icon with color ramp opens slide-out menu with checkboxes and sliders to toggle/adjust Trace, Bloom, Chromatic Drift, Particles, and Ken Burns effects individually.
- **Effect History Logging**: Per-frame JSON logs capturing zoom, active effects, DNA vectors, audio analysis, and timing data for debugging and analysis. Downloadable via debug menu.
- **Design System**: Purple primary color, Inter font, Shadcn UI components, subtle animations, mobile-first and TV-optimized responsive design.

## External Dependencies
- **OpenAI API**: GPT-5, DALL-E 3, GPT-4o Vision for AI art generation and analysis.
- **Stripe API**: For payment processing and subscription management.
- **ACRCloud API**: For music identification.
- **Spotify API**: For retrieving album artwork and metadata.
- **Replit Auth**: For user authentication.
- **PostgreSQL**: Primary database.