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
4.  **Prompt Generation**: GPT-4o Vision (with album art) or GPT-5 (text-only) creates DALL-E prompt considering user preferences, audio mood, identified music (artist intent, lyrical themes, visual metaphors), and voting history. Genre-specific visual culture is applied.
5.  **Image Generation**: DALL-E 3 creates 1024x1024 artwork.
6.  **Display**: Image shown with crossfade.
7.  **Feedback**: User votes to train preferences.

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