# Business Tier Branding Feature - Implementation Proposal

**Date:** November 10, 2025  
**Reviewed by:** Architect Agent (Opus 4.1)  
**Status:** Pending approval from ChatGPT and Grok  

---

## Executive Summary

This proposal outlines a comprehensive business branding system for Algorhythmic that allows business tier customers (business_basic and business_premium) to upload their logo and business context, which will then seed AI artwork generation to create brand-aligned visual experiences.

**Key Benefits:**
- ✅ Business customers get brand-consistent AI artwork
- ✅ Logo colors and business themes automatically influence generation
- ✅ Cached processing prevents repeated expensive Vision API calls
- ✅ Tier-gated feature creates clear value differentiation
- ✅ Blends with existing user style preferences (not a replacement)

---

## Current Issues (Immediate Fixes Required)

### 🔴 CRITICAL: Text Appearing in Artwork
**Problem:** DALL-E 3 frequently generates unwanted text/letters/words in abstract artwork  
**Impact:** Unprofessional appearance, breaks immersive visual experience  
**Solution:** Add universal negative prompt to all DALL-E calls:
```typescript
"absolutely no text, no letters, no words, no typography, no signage, pure abstract visual art"
```
**Implementation:** Update `generateArtImage()` in `server/generation/imageGenerator.ts`  
**Timeline:** Immediate (5-minute fix)

### 🟡 MEDIUM: Repeating Artwork
**Problem:** Users seeing the same artwork multiple times (violates "never repeat" guarantee)  
**Root Cause:** Likely impression tracking edge case or deduplication failure  
**Investigation Needed:** Check `userArtImpressions` table and `/api/artworks/next` deduplication logic  
**Timeline:** Investigate within 48 hours

### 🟡 MEDIUM: Frame Glitches
**Problem:** Visual glitching during frame transitions  
**Root Cause:** Unknown - possibly Ken Burns morphing, WebGL shader issues, or React state updates  
**Investigation Needed:** Check Morpheus rendering engine, particle system GPU usage  
**Timeline:** Investigate within 48 hours

---

## Proposed Architecture

### 1. Database Schema (Option B: Normalized Approach)

**New Table: `business_branding`**
```typescript
export const businessBranding = pgTable("business_branding", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Business metadata
  businessName: varchar("business_name", { length: 255 }).notNull(),
  businessDescription: text("business_description").notNull(), // "Italian pizza restaurant in downtown"
  industry: varchar("industry", { length: 100 }), // "food", "beverage", "retail", "hospitality"
  
  // Logo storage
  logoObjectKey: text("logo_object_key"), // Object storage path: /private-objects/{userId}/logo.png
  
  // Processed AI data (cached to avoid repeated Vision API calls)
  processedPalette: text("processed_palette"), // JSON: ['#FF6B35', '#004E89', '#F7B32B']
  extractedKeywords: text("extracted_keywords").array().default(sql`'{}'::text[]`), // ['pizza', 'italian', 'warm', 'family-friendly']
  
  // Processing state
  processingStatus: varchar("processing_status").notNull().default("pending"), // pending, processing, completed, failed
  processedAt: timestamp("processed_at"),
  processingError: text("processing_error"), // Error message if processing failed
  
  // Feature toggle
  brandingEnabled: boolean("branding_enabled").notNull().default(false), // User can disable without deleting
  
  // Audit
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: uniqueIndex("business_branding_user_id_unique").on(table.userId), // One branding profile per user
  processingStatusIdx: index("business_branding_processing_status_idx").on(table.processingStatus),
}));
```

**Why This Approach?**
- ✅ Clean separation of concerns (branding ≠ user auth data)
- ✅ Easy to extend with future features (multiple logos, brand guidelines, custom palettes)
- ✅ One JOIN to fetch branding context (acceptable performance cost)
- ✅ Can be disabled without deleting data (brandingEnabled toggle)

---

### 2. Logo Upload & Processing Flow

**Step 1: Upload (Synchronous)**
```
POST /api/branding/upload
Auth: Business tier required (business_basic | business_premium)
Body: multipart/form-data
  - logo: File (PNG/JPG, max 5MB)
  - businessName: string
  - businessDescription: string
  - industry: string (enum)

Response: { brandingId, status: "processing", logoUrl }
```

**Validation:**
- Subscription tier check: `['business_basic', 'business_premium'].includes(user.subscriptionTier)`
- File size limit: 5MB max
- File type: PNG, JPG, JPEG only
- Image dimensions: 100x100 to 2000x2000 px

**Step 2: Store Logo in Object Storage**
```typescript
const objectStorageService = new ObjectStorageService();
const logoPath = await objectStorageService.storeImage(
  logoFile,
  `${userId}/branding/logo_${Date.now()}.png`,
  'private' // Private storage - only accessible to business owner
);
```

**Step 3: Enqueue Async Processing**
```typescript
await storage.createBusinessBranding({
  userId,
  businessName,
  businessDescription,
  industry,
  logoObjectKey: logoPath,
  processingStatus: 'processing',
  brandingEnabled: true,
});

// Trigger background job (existing async worker pattern)
await enqueueJob('PROCESS_BRANDING', { userId, logoPath });
```

**Step 4: Background Processing (Async Worker)**
```typescript
async function processBrandingJob(userId: string, logoPath: string) {
  try {
    // 1. Extract color palette using GPT-4o Vision
    const visionAnalysis = await analyzeLogoWithVision(logoPath);
    const palette = visionAnalysis.dominantColors; // ['#FF6B35', '#004E89']
    
    // 2. Extract keywords from business description using GPT-4o
    const branding = await storage.getBusinessBranding(userId);
    const keywords = await extractBrandKeywords(branding.businessDescription, branding.industry);
    
    // 3. Cache results in database
    await storage.updateBusinessBranding(userId, {
      processedPalette: JSON.stringify(palette),
      extractedKeywords: keywords,
      processingStatus: 'completed',
      processedAt: new Date(),
    });
    
    console.log(`[Branding] Processed for user ${userId}: ${keywords.join(', ')}`);
  } catch (error) {
    await storage.updateBusinessBranding(userId, {
      processingStatus: 'failed',
      processingError: error.message,
    });
  }
}
```

**Caching Strategy:**
- Vision analysis results cached in `processedPalette` and `extractedKeywords`
- Only reprocess if logo changes (detect via logoObjectKey change)
- Cache invalidation: User updates logo → set processingStatus = 'processing' → reprocess

---

### 3. Prompt Integration (Blending Strategy)

**Current Prompt Flow:**
```
User Preferences (styles, artists) 
  → Audio Analysis (mood, frequency) 
  → Music Context (genre, artist) 
  → GPT-4o generates prompt 
  → DALL-E 3 generates image
```

**New Prompt Flow (with Branding):**
```
User Preferences + Business Branding 
  → Audio Analysis 
  → Music Context 
  → GPT-4o generates brand-influenced prompt 
  → DALL-E 3 generates image
```

**Prompt Builder Enhancement:**
```typescript
interface BrandingContext {
  businessName: string;
  industry: string;
  palette: string[]; // ['#FF6B35', '#004E89']
  keywords: string[]; // ['pizza', 'italian', 'warm']
  strength: number; // 0.0 to 1.0 (default 0.6)
}

function buildContextualPrompt(
  context: GenerationContext,
  resolvedStyles: string[],
  branding?: BrandingContext
): string {
  let prompt = basePrompt;
  
  // 1. User styles (always included)
  prompt += ` Artistic styles: ${resolvedStyles.join(', ')}.`;
  
  // 2. Business branding (if enabled)
  if (branding && branding.strength > 0) {
    // Inject industry themes
    prompt += ` Incorporate subtle themes related to ${branding.industry}`;
    
    // Inject keywords (weighted by strength)
    const keywordCount = Math.ceil(branding.keywords.length * branding.strength);
    const selectedKeywords = branding.keywords.slice(0, keywordCount);
    prompt += ` with visual elements suggesting: ${selectedKeywords.join(', ')}.`;
    
    // Inject color palette
    prompt += ` Use a color palette inspired by: ${branding.palette.join(', ')}.`;
    
    // CRITICAL: Prevent literal text/signage
    prompt += ` Abstract visual representation only - no text, no logos, no literal signage.`;
  }
  
  // 3. Audio mood
  prompt += ` Match the audio mood: ${context.audioAnalysis.mood}.`;
  
  // 4. Universal negative prompt (CRITICAL FIX)
  prompt += ` IMPORTANT: absolutely no text, no letters, no words, no typography, pure abstract visual art.`;
  
  return prompt;
}
```

**Blending Strategy:**
- **brandStrength = 0.6 (default)**: 60% business influence, 40% user preference
- **brandStrength = 0.0**: Branding disabled (pure user preferences)
- **brandStrength = 1.0**: Maximum branding (still respects user styles)
- Users can adjust via slider in Business Branding settings

**Example Prompts:**

**Without Branding:**
```
Create abstract digital art in sci-fi and cyberpunk styles.
Match the audio mood: energetic.
IMPORTANT: absolutely no text, no letters, no words.
```

**With Branding (Pizza Restaurant, strength=0.6):**
```
Create abstract digital art in sci-fi and cyberpunk styles.
Incorporate subtle themes related to food with visual elements suggesting: 
pizza, italian, warm, family-friendly.
Use a color palette inspired by: #FF6B35, #C1292E, #F7B32B.
Abstract visual representation only - no text, no logos, no literal signage.
Match the audio mood: energetic.
IMPORTANT: absolutely no text, no letters, no words.
```

---

### 4. API Endpoints

**Upload Logo & Create Branding Profile**
```
POST /api/branding
Auth: Required (business tier)
Content-Type: multipart/form-data

Request:
{
  logo: File,
  businessName: "Joe's Pizza",
  businessDescription: "Family-owned Italian pizza restaurant serving authentic Neapolitan pizzas",
  industry: "food"
}

Response: 201 Created
{
  id: "branding_123",
  userId: "user_456",
  businessName: "Joe's Pizza",
  status: "processing",
  logoUrl: "/private-objects/user_456/branding/logo.png",
  brandingEnabled: true
}
```

**Get Branding Profile**
```
GET /api/branding
Auth: Required (business tier)

Response: 200 OK
{
  id: "branding_123",
  businessName: "Joe's Pizza",
  businessDescription: "...",
  industry: "food",
  logoUrl: "/private-objects/...",
  palette: ["#FF6B35", "#C1292E", "#F7B32B"],
  keywords: ["pizza", "italian", "warm", "family-friendly"],
  status: "completed",
  brandingEnabled: true,
  processedAt: "2025-11-10T12:00:00Z"
}
```

**Update Branding Settings**
```
PATCH /api/branding
Auth: Required (business tier)

Request:
{
  brandingEnabled: false,  // Disable without deleting
  brandStrength: 0.8       // Adjust blending intensity
}

Response: 200 OK
{
  id: "branding_123",
  brandingEnabled: false,
  brandStrength: 0.8
}
```

**Delete Branding Profile**
```
DELETE /api/branding
Auth: Required (business tier)

Response: 204 No Content
```

---

### 5. UI/UX Design

**Business Branding Settings Page**
- **Route:** `/settings/branding` (protected)
- **Access Control:** Only visible for business_basic and business_premium tiers
- **Components:**

1. **Tier Gate** (if not business tier)
   ```
   🔒 Business Branding
   
   Unlock brand-aligned AI artwork with Business tier.
   Upload your logo and business info to influence art generation.
   
   [Upgrade to Business] button
   ```

2. **Logo Upload Section**
   ```
   📸 Business Logo
   
   [Drag & drop or click to upload]
   PNG or JPG, max 5MB
   
   Current Logo: [preview thumbnail]
   Status: ✅ Processed | ⏳ Processing | ❌ Failed
   Last updated: Nov 10, 2025
   ```

3. **Business Info Form**
   ```
   Business Name: [Joe's Pizza                    ]
   
   Description: [Family-owned Italian pizza...     ]
                [                                    ]
   
   Industry: [Food & Beverage ▼]
             (dropdown: Food, Beverage, Retail, 
              Hospitality, Entertainment, etc.)
   ```

4. **Extracted Palette Preview**
   ```
   Color Palette (extracted from logo):
   [#FF6B35] [#C1292E] [#F7B32B] [#004E89]
   
   Brand Keywords:
   pizza • italian • warm • family-friendly • authentic
   ```

5. **Branding Controls**
   ```
   Enable Branding: [Toggle ON/OFF]
   
   Brand Influence: [====••••••] 60%
                    Subtle ←→ Dominant
   
   When enabled, your artwork will incorporate your 
   business colors and themes while maintaining your 
   selected artistic style preferences.
   ```

6. **Preview Section**
   ```
   🎨 Preview
   
   See how branding affects your artwork:
   [Generate Preview] button
   
   [Side-by-side comparison grid]
   Without Branding | With Branding
   ```

**Mobile Responsive:**
- Stacked layout on mobile
- Touch-friendly upload area
- Simplified controls (hide preview section on small screens)

---

### 6. Performance & Cost Considerations

**Vision API Costs:**
- GPT-4o Vision: ~$0.01 per logo analysis
- Cached results prevent repeated calls
- Only triggered on: logo upload, logo update, manual reprocess
- Expected frequency: 1-2 calls per business customer per month

**Object Storage:**
- Logo storage: ~100KB-500KB per logo
- Private storage (not public CDN)
- Business tier customers: estimate 1,000 customers × 300KB = 300MB total

**Database Impact:**
- One row in business_branding per business customer
- One JOIN in /api/artworks/next (minimal overhead)
- Indexed on userId for fast lookups

**Generation Latency:**
- No additional latency (branding context fetched once per session)
- Cached palette/keywords loaded from database
- Prompt assembly adds ~5ms (negligible)

---

### 7. Security & Access Control

**Tier Validation:**
```typescript
function requireBusinessTier(req, res, next) {
  const tier = req.user.subscriptionTier;
  if (!['business_basic', 'business_premium'].includes(tier)) {
    return res.status(403).json({ 
      error: 'Business tier required',
      upgradeUrl: '/pricing'
    });
  }
  next();
}
```

**Logo Privacy:**
- Logos stored in private object storage (`/private-objects/{userId}/`)
- Only accessible to authenticated user who owns the logo
- Not exposed via public CDN

**Data Validation:**
- Logo file type whitelist (PNG, JPG only)
- File size limit (5MB max)
- Business name max length (255 chars)
- Description max length (2000 chars)
- Industry enum validation

---

### 8. Migration Path

**Phase 1: Database Setup** (Day 1)
1. Create business_branding table via Drizzle schema
2. Run `npm run db:push` to apply migration
3. Add insert/select schemas to shared/schema.ts
4. Extend IStorage interface with branding CRUD methods

**Phase 2: Backend Implementation** (Day 2-3)
1. Implement /api/branding endpoints (POST, GET, PATCH, DELETE)
2. Add object storage upload handler
3. Create async processing job for Vision extraction
4. Update prompt builder to accept branding context
5. Add tier gate middleware

**Phase 3: Frontend UI** (Day 4-5)
1. Create /settings/branding page
2. Build logo upload component with preview
3. Add business info form with validation
4. Implement branding toggle and strength slider
5. Add tier gate splash screen for non-business users

**Phase 4: Testing & Rollout** (Day 6-7)
1. End-to-end testing with test business accounts
2. Vision extraction validation
3. Prompt blending verification
4. Performance testing (database JOINs, API latency)
5. Beta rollout to 10 business customers
6. Production deployment

---

### 9. Success Metrics

**Adoption Metrics:**
- % of business tier customers who upload branding
- Average time from signup to first branding upload
- Branding enabled rate (on vs. off)

**Engagement Metrics:**
- Brand strength slider usage (are users adjusting it?)
- Branding toggle frequency (are users turning it on/off?)
- Artwork generation volume (business vs. non-business)

**Quality Metrics:**
- Vision extraction accuracy (manual review of palettes/keywords)
- User satisfaction with brand-aligned artwork (survey)
- Text-in-artwork incidents (should drop to near-zero with negative prompt)

**Technical Metrics:**
- Vision API call volume and costs
- Processing queue latency (upload → completed)
- Database query performance (branding JOIN overhead)

---

## Implementation Timeline

**Week 1:**
- ✅ Immediate fix: Add "no text" negative prompt to DALL-E calls
- Day 1-2: Database schema and backend endpoints
- Day 3-4: Vision extraction and prompt integration
- Day 5-7: Frontend UI and tier gating

**Week 2:**
- Day 1-3: Testing and bug fixes
- Day 4-5: Beta rollout to 10 business customers
- Day 6-7: Production deployment and monitoring

**Total:** 2 weeks to full production

---

## Open Questions for Review

1. **Brand Strength Default:** Is 60% the right balance, or should it be higher/lower?
2. **Industry Taxonomy:** Should we use a fixed dropdown or allow freeform text?
3. **Multiple Logos:** Should we support multiple logos per business (future feature)?
4. **Branding Override:** Should branding completely override user style preferences at 100% strength, or always blend?
5. **Preview Feature:** Should we offer real-time preview before enabling branding, or trust the slider?
6. **Catalogue Integration:** Should pre-generated catalogue images also support business branding?
7. **Cost Pass-Through:** Should we charge extra for branding processing (Vision API costs), or absorb in business tier pricing?

---

## Conclusion

This proposal delivers a comprehensive business branding system that:
- ✅ Creates clear value differentiation for business tiers
- ✅ Integrates seamlessly with existing AI generation pipeline
- ✅ Provides cached, performant processing with minimal latency
- ✅ Offers intuitive UI/UX for logo upload and branding control
- ✅ Fixes critical "text in artwork" issue with universal negative prompts
- ✅ Scales efficiently with minimal database overhead

**Recommended Next Steps:**
1. Review and approve this proposal (ChatGPT + Grok)
2. Immediate deployment: "no text" negative prompt fix
3. Begin Phase 1 implementation (database schema)
4. Iterate on UI mockups with design feedback

---

**Document Version:** 1.0  
**Last Updated:** November 10, 2025  
**Author:** Replit Agent (Claude 4.5 Sonnet)  
**Architect Review:** Approved (Opus 4.1)
