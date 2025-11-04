# Algorhythmic - AI-Powered Audio-Reactive Art Platform

## Overview
Algorhythmic is a revenue-generating web application that transforms sound into stunning AI-generated artwork. Users select their favorite artistic styles and artists (like choosing stations on Pandora), and the AI creates dreamlike visualizations that react to audio in real-time. The system learns from user preferences through an upvote/downvote mechanism to continuously improve personalization.

## Current State
- **Version**: MVP (Minimum Viable Product)
- **Status**: Fully functional with all core features implemented
- **Last Updated**: January 2025

## Tech Stack

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **Styling**: Tailwind CSS + Shadcn UI components
- **State Management**: TanStack Query (React Query)
- **Real-time**: WebSocket client for multi-device sync
- **Audio Processing**: Web Audio API for microphone access and analysis

### Backend
- **Runtime**: Node.js with Express
- **Real-time**: WebSocket Server (ws package)
- **AI Integration**: OpenAI API (GPT-5 for prompts, DALL-E 3 for images)
- **Payments**: Stripe API for subscription management
- **Storage**: In-memory storage (MemStorage) for MVP

### Key Libraries
- OpenAI SDK for AI art generation
- Stripe SDK for payment processing
- WebSocket (ws) for real-time communication
- Drizzle ORM schemas (prepared for future database migration)

## Project Architecture

### Data Models
Located in `shared/schema.ts`:
- **ArtPreferences**: User-selected styles and artists per session
- **ArtVotes**: Upvote/downvote history for preference learning
- **ArtSessions**: Generated artwork history with prompts
- **Users**: Subscription tier and Stripe customer data
- **AudioAnalysis**: Real-time audio characteristics (frequency, amplitude, tempo, mood)

### Key Features

#### 1. Landing Page (`/`)
- Hero section with animated art showcase
- "How It Works" feature section (3-step process)
- Art style showcase (Surrealism, Impressionism, Cubism, Digital Abstract)
- Pricing tiers (Free, Premium $9.99, Ultimate $19.99)
- User-generated art gallery
- Full responsive design with dark mode support

#### 2. Art Display (`/display`)
- Fullscreen canvas for AI-generated artwork
- Real-time audio capture and analysis
- Audio-reactive visual effects (glow/pulse based on bass)
- Auto-hiding controls (fade after 3 seconds)
- Style/artist selection modal
- Upvote/downvote voting system
- WebSocket integration for multi-device sync
- Generation every 12 seconds when audio is active

#### 3. Subscription Page (`/subscribe`)
- Stripe payment integration
- 7-day free trial for Premium tier
- Secure payment form with Stripe Elements
- Feature comparison and plan details

#### 4. Style Selector Component
- Visual grid of artistic styles with example images
- Artist selection (Van Gogh, Picasso, Dali, etc.)
- Multi-select interface
- Tab navigation between styles and artists
- Saves preferences to backend

### API Endpoints

#### Preferences
- `GET /api/preferences/:sessionId` - Fetch user preferences
- `POST /api/preferences` - Save style/artist selections

#### Art Generation
- `POST /api/generate-art` - Generate artwork from audio analysis
  - Uses GPT-5 to create prompts based on audio mood, user preferences, and voting history
  - Generates images with DALL-E 3 (1024x1024)
  - Returns image URL and prompt

#### Voting
- `POST /api/vote` - Submit upvote/downvote
- `GET /api/votes/:sessionId` - Get voting history

#### Sessions
- `GET /api/sessions/:sessionId` - Get artwork generation history

#### Payments
- `POST /api/create-payment-intent` - Create Stripe payment intent

#### Health
- `GET /api/health` - Server health check

### WebSocket Events
- `audio-analysis` - Client sends audio data for multi-device sync
- `audio-update` - Server broadcasts to connected clients
- `connected` - Welcome message on connection

## Audio Analysis System

The `AudioAnalyzer` class (`client/src/lib/audio-analyzer.ts`) performs:
- Real-time microphone capture via Web Audio API
- Frequency analysis using FFT (Fast Fourier Transform)
- Amplitude, bass level, treble level calculation
- Tempo estimation from amplitude variations
- Mood classification (energetic, calm, dramatic, playful, melancholic)

Analysis triggers art generation every 12 seconds with current audio characteristics.

## AI Art Generation Flow

1. **Audio Capture**: Microphone captures ambient sound
2. **Analysis**: AudioAnalyzer extracts frequency, amplitude, tempo, mood
3. **Prompt Generation**: GPT-5 creates detailed DALL-E prompt considering:
   - User-selected styles (cubism, impressionism, etc.)
   - User-selected artists (Van Gogh, Dali, etc.)
   - Current audio mood and energy
   - Previous voting history (liked/disliked prompts)
4. **Image Generation**: DALL-E 3 creates 1024x1024 artwork
5. **Display**: Image shown with crossfade transition
6. **Feedback**: User votes to train preferences

## User Preferences & Learning

The system learns user taste through:
- **Style Selection**: Direct input of preferred art movements
- **Artist Selection**: Specific artist influences
- **Voting History**: Upvotes/downvotes influence future prompts
- **Session Continuity**: Preferences persist across the session
- **Adaptive Prompts**: GPT-5 analyzes voting patterns to refine generation

## Environment Variables

Required secrets (configured in Replit Secrets):
- `OPENAI_API_KEY` - OpenAI API key for GPT-5 and DALL-E 3
- `STRIPE_SECRET_KEY` - Stripe secret key for backend
- `VITE_STRIPE_PUBLIC_KEY` - Stripe publishable key for frontend
- `SESSION_SECRET` - Express session secret (auto-configured)

## Design System

Following `design_guidelines.md`:
- **Colors**: Purple primary (#8A50FF), with full light/dark mode support
- **Typography**: Inter font family, clear hierarchy
- **Spacing**: Consistent 4/8/12/16/24px scale
- **Components**: Shadcn UI with custom hover/active elevations
- **Interactions**: Subtle animations, auto-hiding UI, smooth transitions
- **Responsive**: Mobile-first, optimized for TV (10-foot UI)

## Deployment Considerations

### Current Setup (MVP)
- In-memory storage (data lost on restart)
- Session-based preferences (no user accounts)
- Single server instance

### Future Enhancements
1. **PostgreSQL Migration**: Schema already defined in `shared/schema.ts`
2. **User Authentication**: Replit Auth for persistent accounts
3. **Multi-device Sync**: WebSocket infrastructure ready
4. **Stripe Subscriptions**: Full subscription flow with webhooks
5. **Image CDN**: Cache generated artwork
6. **Rate Limiting**: Protect API endpoints
7. **Analytics**: Track generation patterns

## Development Workflow

### Running Locally
```bash
npm run dev
```
- Backend: Express server on port 5000
- Frontend: Vite dev server (proxied through Express)
- WebSocket: Available at `/ws`

### Testing
- Manual testing via browser
- Playwright e2e tests can be added for critical flows
- Test Stripe payments using test mode keys

## Recent Changes
- January 2025: Initial MVP implementation with all core features
- Full frontend with landing, display, and subscription pages
- Backend with OpenAI integration and Stripe payments
- WebSocket server for real-time audio coordination
- Audio analysis and preference learning system

## User Preferences
- Theme: Light mode default with dark mode toggle
- Platform targets: Smart TVs, tablets, smartphones
- Revenue model: Freemium with Premium ($9.99/mo) and Ultimate ($19.99/mo) tiers

## Project Goals
- Revenue-generating MVP prioritized
- Cross-platform web app (TV, mobile, tablet browsers)
- Future: Native Apple TV/Fire TV apps, AI model improvements, social features
