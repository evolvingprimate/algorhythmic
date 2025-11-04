# Algorhythmic Design Guidelines

## Design Approach

**Reference-Based Approach**: Drawing inspiration from Spotify (audio + preferences), Pinterest (visual discovery), and Apple TV+ (premium streaming experience). The design prioritizes immersive, fullscreen art viewing with minimal UI interference, allowing AI-generated artwork to be the star while keeping controls intuitive and accessible.

## Core Design Principles

1. **Art-First Experience**: Generated artwork dominates the viewport with controls fading into the background
2. **Ambient Intelligence**: UI appears contextually, disappearing when not needed
3. **Cross-Device Harmony**: Consistent visual language across TV, tablet, and mobile with appropriate adaptations
4. **Fluid Transitions**: Smooth morphing between art pieces reflecting audio changes

## Typography

**Font Stack**:
- **Primary (Headings)**: Inter - Clean, modern, excellent at all sizes
- **Secondary (Body/UI)**: SF Pro Display (fallback: system-ui) - Optimal for UI elements and readability

**Type Scale**:
- Hero/Display: text-6xl to text-8xl (60-96px) - For landing page headlines
- Section Headers: text-4xl to text-5xl (36-48px) - For feature sections
- Card Titles: text-2xl to text-3xl (24-30px) - Artist/style names
- Body Text: text-base to text-lg (16-18px) - Descriptions
- UI Labels: text-sm (14px) - Controls and metadata
- Micro Copy: text-xs (12px) - Timestamps, credits

**Weights**: Regular (400), Medium (500), Semibold (600), Bold (700)

## Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 8, 12, 16, 24 consistently
- Micro spacing: p-2, m-2, gap-2 (8px) - Tight UI elements
- Standard spacing: p-4, m-4, gap-4 (16px) - Default component padding
- Section spacing: p-8, py-12, py-16 (32-64px) - Between major sections
- Large gaps: p-24, py-32 (96-128px) - Landing page section breathing room

**Grid Systems**:
- **TV/Desktop**: 12-column grid, max-w-7xl containers
- **Tablet**: 8-column grid, max-w-4xl
- **Mobile**: 4-column grid, max-w-lg with full-width art display

**Viewport Strategy**:
- Art Display: Full viewport (100vh/100vw) - Immersive viewing
- Landing sections: Natural height (py-20 to py-32) - No forced viewport heights
- Controls overlay: Fixed positioning with backdrop blur

## Component Library

### Navigation
**Top Bar (Overlay on Art Display)**:
- Translucent background (backdrop-blur-xl with subtle dark overlay)
- Logo (top-left), navigation links (center), user profile + subscription status (top-right)
- Sticky positioning, slides up when idle (3 seconds), reappears on mouse movement
- Height: h-16 (64px) on desktop, h-14 (56px) on mobile

**Bottom Control Bar (Art Display)**:
- Similar translucent treatment to top bar
- Play/pause audio analysis, volume control, style indicator, like/dislike buttons
- Fixed bottom positioning
- Auto-hide behavior matching top bar

### Art Display Canvas
**Fullscreen Container**:
- 100vh × 100vw with object-fit: cover for generated images
- Smooth crossfade transitions (1-2 seconds) between art pieces
- Real-time audio waveform overlay (optional, subtle, top or bottom 10% of screen)
- Pulsing glow effects around edges responding to bass frequencies

**Metadata Overlay** (bottom-left):
- Artist/style inspiration (text-sm, semi-transparent pill background)
- Generation timestamp
- Fade in on mouse movement/touch, auto-hide after 2 seconds

### Style/Artist Selection Interface

**Discovery Grid**:
- Masonry/Pinterest-style layout for browsing art styles/artists
- Cards: 300-400px width, auto height, gap-4
- Each card shows example artwork + style/artist name
- Hover state: Subtle scale (scale-105) + shadow elevation
- "Start Station" button appears on hover (blurred background)

**Station Creation Modal**:
- Centered modal, max-w-2xl
- Multi-select interface for combining styles/artists
- Visual chips showing selections with remove (×) option
- "Create My Station" primary CTA at bottom

### Voting Interface

**Floating Vote Buttons** (visible during art display):
- Positioned bottom-right corner
- Two circular buttons: thumbs-up (👍) and thumbs-down (👎)
- Size: 56px diameter each, gap-3 between them
- Translucent background with backdrop blur
- Active state: Brief pulse animation + color shift
- Voting triggers subtle UI feedback showing preference recorded

### Landing Page Components

**Hero Section** (h-screen):
- Full-viewport dramatic showcase with animated art preview
- Central headline: "Your Soundtrack, Visualized" (text-7xl, bold)
- Subheadline: "AI-generated art that dances to your world" (text-2xl)
- Dual CTA: "Start Free Trial" (primary) + "See How It Works" (secondary with blurred background if over image)
- Background: Looping 10-second video/animation of art transforming to audio

**How It Works** (3-column grid on desktop, stack on mobile):
- Icon + title + description cards
- Icons: Large (h-16 w-16), distinctive for each step
- Flow: "Choose Your Style" → "Let Music Flow" → "Discover & Refine"

**Style Showcase** (2-column alternating layout):
- Left: Large art sample (600×800px)
- Right: Style description, example artists, "Try This Style" CTA
- Alternates: Right image / Left text for visual rhythm
- Styles featured: Surrealism, Impressionism, Cubism, Abstract, Digital Art

**Pricing Tiers** (3-column cards):
- Free tier, Premium tier, Ultimate tier
- Card elevation on hover
- Feature comparison checkmarks
- Primary CTA on Premium tier (most popular badge)

**Social Proof**:
- User-generated art gallery (4×3 grid)
- Testimonials from artists/music lovers (2-column)
- Stats: "50,000+ artworks generated daily"

**Footer**:
- Multi-column: About, Features, Support, Legal, Social
- Newsletter signup with inline form
- Trust badges: Payment security, data privacy

## Responsive Breakpoints

- Mobile: < 640px - Single column, simplified controls
- Tablet: 640px - 1024px - 2-column layouts, touch-optimized controls
- Desktop: 1024px - 1536px - Full grid layouts, hover interactions
- TV/Large: > 1536px - Optimized for 10-foot UI, larger touch targets (min 60px)

## Images

**Required Images**:
1. **Hero Background**: Full-bleed animated art visualization (1920×1080+), looping 10-15 second video showing art morphing to music
2. **Style Showcases**: High-quality example images for each art style (600×800px portrait orientation), 6-8 styles minimum
3. **User Gallery**: 12+ diverse AI-generated artworks showing platform capability (square format, 400×400px)
4. **Logo**: Algorhythmic wordmark + icon variations (light/dark modes)

**Image Treatment**:
- Hero: Full-screen with subtle gradient overlay for text readability
- All buttons over images: Backdrop blur (backdrop-blur-lg) with semi-transparent backgrounds
- Gallery images: Lazy-loaded, progressive blur placeholder

## Interactions & Animations

**Critical Animations** (use sparingly):
- Art transitions: Smooth crossfade (800ms ease-in-out)
- Audio reactivity: Subtle pulse/glow on canvas edges (real-time)
- Modal entry/exit: Scale + fade (200ms)
- Button feedback: Brief scale (100ms) on interaction

**Prohibited**: Excessive scroll-triggered animations, distracting particle effects, auto-playing music on landing page

## Accessibility

- WCAG AA contrast ratios for all text over images
- Keyboard navigation for all controls
- Screen reader labels for voting buttons and style selection
- Reduced motion support: Disable crossfades for users with prefers-reduced-motion
- Focus indicators: Visible 2px outline on all interactive elements