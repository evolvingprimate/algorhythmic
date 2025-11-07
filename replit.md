# Algorhythmic - AI-Powered Audio-Reactive Art Platform

## Overview
Algorhythmic is a revenue-generating web application that transforms sound into stunning AI-generated artwork. Users select artistic styles and artists, and the AI creates real-time, audio-reactive visualizations. The system learns from user preferences through voting to continuously improve personalization. The project aims to be a cross-platform web app, with future plans for native TV applications and social features, operating on a freemium model.

## User Preferences
- Theme: Light mode default with dark mode toggle
- Platform targets: Smart TVs, tablets, smartphones

## System Architecture

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **Styling**: Tailwind CSS + Shadcn UI components
- **State Management**: TanStack Query (React Query)
- **Real-time**: WebSocket client
- **Audio Processing**: Web Audio API for microphone access and analysis

### Backend
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Replit Auth with OpenID Connect (Passport.js)
- **Real-time**: WebSocket Server (ws package)
- **AI Integration**: OpenAI API (GPT-5 for prompts, DALL-E 3 for images, GPT-4o Vision for album art analysis)

### Data Models
- **ArtPreferences**: User-selected styles and artists per session
- **ArtVotes**: Upvote/downvote history
- **ArtSessions**: Generated artwork history
- **Users**: Auth profile data, subscription tier
- **Sessions**: Passport session storage
- **AudioAnalysis**: Real-time audio characteristics

### Key Features
- **Landing Page**: Hero section, "How It Works," style showcase, pricing tiers, user-generated art gallery, responsive design, login/logout.
- **Art Display**: Fullscreen canvas, real-time audio capture and analysis with frequency meter (bass/mids/highs visualization), audio-reactive visual effects, auto-hiding controls, style/artist selection, voting system, WebSocket for multi-device sync, timed generation.
- **User Gallery Page**: Protected route, display saved artworks, save/unsave, delete, download, sorted by date.
- **Subscription Page**: Stripe payment integration, 7-day free trial, secure payment form, feature comparison.
- **Style Selector Component**: Visual grid of 71 artistic styles organized into 8 master groups with matching AI-generated thumbnails, multi-select, tab navigation, dynamic AI mode.

### AI Art Generation Flow
1.  **Audio Capture & Analysis**: Microphone captures sound; AudioAnalyzer extracts frequency, amplitude, tempo, mood.
2.  **Music Identification**: ACRCloud identifies the playing song.
3.  **Album Artwork Fetch**: Spotify API retrieves album cover.
4.  **Prompt Generation**: GPT-4o Vision (with album art) or GPT-5 (text-only) creates DALL-E prompt considering user preferences, audio mood, identified music (artist intent, lyrical themes, visual metaphors), and voting history. Genre-specific visual culture is applied. **Generates 50-point DNA vector alongside prompt.**
5.  **Image Generation**: DALL-E 3 creates 1024x1024 artwork.
6.  **Permanent Storage**: Image downloaded from DALL-E temporary URL and stored permanently in Replit Object Storage (DALL-E URLs expire after 2 hours).
7.  **Display**: Image shown with DNA-driven morphing (see DNA Morphing System below).
8.  **Feedback**: User votes to train preferences.

### Image Storage System
**Problem**: DALL-E image URLs expire after 2 hours, causing blank screens for historical artworks.

**Solution**: Replit Object Storage integration for permanent image hosting.

**Implementation:**
- `server/objectStorage.ts`: Service for downloading DALL-E images and uploading to Replit Object Storage
- Images stored in public directory: `/public-objects/artwork-{uuid}.png`
- Serving route: `GET /public-objects/:filePath` streams images with 1-hour cache
- Database stores permanent URLs instead of temporary DALL-E URLs
- Environment variables: `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`

**Benefits:**
- Images never expire
- Faster load times (served from Replit's CDN)
- Support for gallery, sharing, and historical viewing
- 1-year browser cache for optimal performance

### DNA Morphing System
**GAN-Like Interpolation**: Each artwork has a 50-point "DNA vector" (0-3 range) enabling smooth, procedural morphing between frames over 5-minute cycles.

**50-Point DNA Structure:**
- **Points 1-12**: Color & Palette (hue, saturation, brightness, temperature, contrast, etc.)
- **Points 13-24**: Texture & Style (smoothness, fractal depth, grain, impasto, detail level, etc.)
- **Points 25-34**: Composition (focal point, symmetry, layering, depth, perspective, etc.)
- **Points 35-44**: Mood & Semantics (emotional valence, abstraction, atmosphere, narrative, surreal factor, etc.)
- **Points 45-50**: Morph Controls (audio-reactive: warp elasticity, particle density, dissolve speed, echo trail, boundary fuzz, reactivity gain)

**Morphing Timeline (5-Minute Hero Cycle):**
1. **0:00-1:00 (Hold Phase)**: Display current artwork ("Hero 1") completely static - no effects, pristine AI render with Ken Burns zoom only
2. **1:00-1:30 (Ramp Phase)**: Gradually activate audio-reactive effects from 0 to 100% intensity
3. **1:30-5:00 (Full Morph Phase)**: DNA interpolation from Hero 1 → Hero 2 with full audio reactivity, particle bursts, displacement effects
4. **5:00**: Advance to next hero, restart cycle

**Critical Timing Fix (Nov 2025)**: Frame advancement now occurs when elapsed >= TOTAL_CYCLE BEFORE modulo operation, preventing premature A→B revert bug.

**Visual Effects System (Nov 2025 Enhancements):**

**Displacement & Flow:**
- **Curl Noise**: Divergence-free organic flow for ferrofluid-like, water-surface aesthetics
- **Low-Frequency Movement**: Reduced frequency (0.3x scale, 0.5x speed) for gentle, soft displacement
- **Smoothstep Falloff**: Edge softness based on distance from center, eliminating harsh boundaries
- **Luminance Weighting**: Darker areas receive more displacement (watercolor pigment pooling effect)
- **Soft Anomaly Modulation**: Optional chaotic regions with smoothstep thresholds (not step-like)

**Ken Burns Effect:**
- **Enhanced Zoom**: 1.0x → 1.3x scale over morph phase (2x more visible than original 1.15x)
- **Parallax Translation**: Subtle depth illusion via coordinated movement
- **Eased Transitions**: easeInOutCubic for smooth, non-linear zoom progression

**Particle System (Beat-Triggered Bursts):**
- **Bass Peak Detection**: Emits only when bassLevel > 0.6 AND delta > 0.1 (no constant trickle)
- **Randomized Cooldown**: 1-3 second gaps between bursts (60-180 normalized frames)
- **Edge-Weighted Emission**: Sobel gradient detection (threshold 0.3) for shape tracing, not uniform spray
- **Short Lifetimes**: 0.5-1.0 second randomized decay (proper dt/60 timing)
- **Burst Impact**: 20 particles per bass pop for visible effect
- **Foreground→Background Tracing**: Particles sample both images at same UV, interpolate colors by morphProgress

**Tiered Rendering (Device-Adaptive):**
- **Tier 1** (≤4GB RAM, no WebGL2): CSS transforms + Canvas2D for basic warp/blur/dissolve
- **Tier 2** (4-8GB, WebGL): WebGL shaders for particle systems and advanced effects
- **Tier 3** (8-16GB, WebGL2): High-fidelity effects with post-processing
- **Tier 4** (≥16GB, WebGPU): Compute shaders for fluid dynamics and advanced morphing

**Implementation:**
- `client/src/lib/dna.ts`: DNA utility functions (interpolation, audio reactivity, clamping)
- `client/src/lib/morphEngine.ts`: MorphEngine class managing 5-min cycles
- `client/src/lib/deviceDetection.ts`: Auto-detects device tier based on RAM/GPU
- `client/src/lib/tier1Renderer.ts`: Canvas2D renderer for low-end devices
- `server/openai-service.ts`: GPT generates DNA alongside prompts, with fallback DNA generation
- `shared/schema.ts`: Database stores `dnaVector` (JSON) with each artwork

**Validation & Safety:**
- All DNA values clamped to 0-3 range at generation, parsing, and modulation
- Fallback DNA generation based on audio characteristics if GPT fails
- Audio-reactive modulation prevents overflow via clampDNAValue() function

### Design System
- **Colors**: Purple primary with full light/dark mode support.
- **Typography**: Inter font family.
- **Spacing**: Consistent scale.
- **Components**: Shadcn UI with custom elevations.
- **Interactions**: Subtle animations, auto-hiding UI, smooth transitions.
- **Responsive**: Mobile-first, optimized for TV (10-foot UI).

### Art Style Library (71 Total Styles)
**8 Master Groups:**
1. **CLASSIC MASTERS** (8): Surrealism, Impressionism, Cubism, Van Gogh Style, Color Field, Renaissance, Baroque, Pointillism
2. **MODERN DIGITAL** (8): Abstract, Digital/Cyber, 8-Bit Pixel Art, Anime, Claymation, Vector Art, Low-Poly, Glitch Art
3. **DREAM & MIND** (8): Psychedelic, Italian Brain Rot, Cartoon, Expressionism, Op Art, Fantasy, Optical Illusions, Minimalist
4. **REALISM & NATURE** (8): Realism, Photorealism, Landscape, Portrait, Wildlife, Still Life, Hyperrealism, Botanical
5. **DARK & MOODY** (8): Horror, Gothic, Noir, Dark Fantasy, Vaporwave, Steampunk Shadows, Dystopian, Macabre
6. **SCI-FI & FUTURE** (8): Sci-Fi, Cyberpunk, Retro-Futurism, Space Opera, Neon Noir, Biotech, Holographic, Apocalyptic
7. **SEASONAL & HOLIDAYS** (20): Halloween, Christmas, New Year's Day, MLK Jr Day, Washington's Birthday, Memorial Day, Juneteenth, Independence Day, Labor Day, Indigenous Peoples' Day, Veterans Day, Thanksgiving, Ramadan, Eid al-Fitr, Eid al-Adha, Diwali, Lunar New Year, Vesak, Holi, Easter
8. **MEME CULTURE** (8): Nyan Cat, Distracted Boyfriend, This Is Fine, Expanding Brain, Doge, Pepe the Frog, Wojak, Rickroll

## External Dependencies
- **OpenAI API**: For GPT-5, DALL-E 3, and GPT-4o Vision for AI art generation and prompt analysis.
- **Stripe API**: For payment processing and subscription management.
- **ACRCloud API**: For music identification from audio.
- **Spotify API**: For retrieving album artwork and associated metadata.
- **Replit Auth**: For user authentication.
- **PostgreSQL**: Database for persistent storage.

## Subscription Management

### 6 Pricing Tiers
1. **Free**: $0/month, 3 generations/day
2. **Premium**: $14.99/month, 10 generations/day
3. **Ultimate**: $19.99/month, 20 generations/day
4. **Enthusiast**: $49.99/month, 50 generations/day
5. **Business Basic**: $199.99/month, 100 generations/day
6. **Business Premium**: $499/month, 300 generations/day

### Daily Usage Tracking
- Implemented in `dailyUsage` table
- Tracks userId, date (YYYY-MM-DD), generationCount
- Automatic daily reset via date comparison
- API routes: `/api/usage/check`, `/api/usage/stats`

### Manual Tier Upgrades (MVP Admin Workflow)

**Important**: This process requires Replit workspace admin access. The person fulfilling upgrades must be able to access the Replit project's Database pane.

**Step-by-Step Process**:

1. **User Requests Upgrade**
   - User clicks "Request Upgrade" button on /subscribe page
   - Pre-filled email opens addressed to support@algorhythmic.art
   - Email contains: user's request, tier name, and pricing

2. **Admin Receives Request**
   - Check user's email and verify their account exists in database
   - To find user ID: Open Replit Database pane → Query: `SELECT id, email, subscription_tier FROM users WHERE email = 'user@example.com';`

3. **Admin Sends Payment Link**
   - Create Stripe payment link for the requested tier amount
   - Send payment link to user via email
   - Wait for payment confirmation from Stripe

4. **Admin Updates Tier** (AFTER payment confirmed)
   - Open Replit project
   - Click "Database" tab in left sidebar (or Tools → Database)
   - In the SQL query editor, run:
   ```sql
   UPDATE users 
   SET subscription_tier = 'premium'  -- or ultimate, enthusiast, business_basic, business_premium
   WHERE id = 'user-id-from-step-2';
   ```
   - Click "Run" to execute
   - Verify success message

5. **Verify Upgrade**
   - User's new daily limit takes effect immediately (no restart needed)
   - User can verify by logging in and checking usage indicator
   - To confirm in database: `SELECT id, email, subscription_tier FROM users WHERE id = 'user-id';`

**Alternative: Using psql CLI**
```bash
# Connect to database
psql $DATABASE_URL

# Update tier
UPDATE users SET subscription_tier = 'premium' WHERE id = 'user-id-here';

# Verify
SELECT id, email, subscription_tier FROM users WHERE id = 'user-id-here';
```

### Valid Tier Values
- `free` (3 generations/day)
- `premium` (10 generations/day)
- `ultimate` (20 generations/day)
- `enthusiast` (50 generations/day)
- `business_basic` (100 generations/day)
- `business_premium` (300 generations/day)

### Future Enhancements
- Automated Stripe Checkout integration
- Self-service subscription management portal
- Webhook handling for automatic tier updates