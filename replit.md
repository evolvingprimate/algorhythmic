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

### AI Art Generation & Morphing
- **Audio Capture & Analysis**: Extracts frequency, amplitude, tempo, mood.
- **Music Identification**: ACRCloud identifies the playing song.
- **Prompt Generation**: GPT-4o Vision (with album art) or GPT-5 generates DALL-E prompts based on user preferences, audio mood, music identity, and voting history. A 50-point "DNA vector" is generated alongside the prompt.
- **Image Generation**: DALL-E 3 creates 1024x1024 artwork.
- **Permanent Storage**: Images are downloaded from DALL-E and stored permanently in Replit Object Storage with a comprehensive triple verification and retry pipeline to ensure persistence and integrity.
- **DNA Morphing System**: Each artwork has a 50-point DNA vector enabling smooth, procedural morphing between frames over 5-minute cycles, with audio-reactive modulation.
- **Visual Effects System**: Includes displacement and flow effects (curl noise, luminance weighting), enhanced Ken Burns effect, and a beat-triggered particle system (bass peak detection, edge-weighted emission).
- **Tiered Rendering**: Adaptive rendering based on device capabilities (RAM, GPU, WebGL/WebGPU support) for optimal performance across various devices.

### Data Models
- **ArtPreferences**: User-selected styles and artists.
- **ArtVotes**: Upvote/downvote history.
- **ArtSessions**: Generated artwork history.
- **Users**: Auth profile data, subscription tier.
- **DailyUsage**: Tracks daily generation count for users.

### Key Features
- **Art Display**: Real-time audio-reactive visualizations, style/artist selection, voting system, WebSocket for multi-device sync, timed generation.
- **User Gallery Page**: Protected route to display, save, delete, and download user artworks.
- **Subscription Page**: Stripe payment integration, 7-day free trial, feature comparison across tiers.
- **Style Selector**: Visual grid of 71 artistic styles across 8 master groups, with dynamic AI mode.
- **Design System**: Purple primary color, Inter font, Shadcn UI components, subtle animations, mobile-first and TV-optimized responsive design.

## External Dependencies
- **OpenAI API**: GPT-5, DALL-E 3, GPT-4o Vision for AI art generation and analysis.
- **Stripe API**: For payment processing and subscription management.
- **ACRCloud API**: For music identification.
- **Spotify API**: For retrieving album artwork and metadata.
- **Replit Auth**: For user authentication.
- **PostgreSQL**: Primary database.