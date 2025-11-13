/**
 * Async Artwork Service - Handles non-blocking artwork generation
 * 
 * This service ensures HTTP requests return immediately (<100ms) by:
 * 1. Returning cached artworks if available
 * 2. Enqueueing generation jobs for background processing
 * 3. Providing polling endpoints for job status
 */

import { db } from '../db';
import { generationJobs, artSessions } from '@shared/schema';
import { eq, desc, and, or, ne } from 'drizzle-orm';
import crypto from 'crypto';
import { generateArtPrompt } from '../openai-service';
import { OpenAIService } from '../openai-service';
import { generationHealthService } from '../generation-health';
import { nanoid } from 'nanoid';
import { storage } from '../storage';

// Initialize OpenAI service with existing health service singleton
const openaiService = new OpenAIService(generationHealthService);

// Job status type
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ArtworkJob {
  id: string;
  sessionId: string;
  userId: string;
  status: JobStatus;
  result?: any;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Get cached artworks for immediate return
 * Returns empty array if no cache available
 */
export async function getCachedArtworks(
  userId: string,
  sessionId: string,
  limit: number = 3
): Promise<any[]> {
  try {
    // Try to get recently generated artworks from this session first
    const recentArtworks = await db
      .select()
      .from(artSessions)
      .where(
        and(
          eq(artSessions.userId, userId),
          eq(artSessions.sessionId, sessionId)
        )
      )
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
    
    if (recentArtworks.length >= 2) {
      // Need at least 2 for morphing
      console.log(`[AsyncArtwork] Returning ${recentArtworks.length} cached artworks from session`);
      return recentArtworks;
    }
    
    // If not enough session artworks, pull from the pre-generated catalog
    console.log(`[AsyncArtwork] Session has ${recentArtworks.length} artworks, fetching from catalog...`);
    
    // Use storage.getUnseenArtworks to access the 1400+ pre-generated artworks
    const catalogArtworks = await storage.getUnseenArtworks(
      userId,
      limit,
      undefined, // orientation
      [], // styleTags
      [], // artistTags
      false // strictMode
    );
    
    if (catalogArtworks.length > 0) {
      console.log(`[AsyncArtwork] Returning ${catalogArtworks.length} artworks from catalog (${catalogArtworks.length} items)`);
      return catalogArtworks;
    }
    
    // Fallback: get any artworks from the database
    const fallbackArtworks = await db
      .select()
      .from(artSessions)
      .orderBy(desc(artSessions.createdAt))
      .limit(limit);
    
    console.log(`[AsyncArtwork] Returning ${fallbackArtworks.length} fallback artworks`);
    return fallbackArtworks;
  } catch (error) {
    console.error('[AsyncArtwork] Error fetching cached artworks:', error);
    return [];
  }
}

/**
 * Create a generation job and return immediately
 */
export async function enqueueArtworkGeneration(
  userId: string,
  sessionId: string,
  params: {
    styles?: string[];
    artists?: string[];
    orientation?: string;
    audioContext?: any;
  }
): Promise<string> {
  const jobId = crypto.randomUUID();
  
  // Store in database for persistence
  await db.insert(generationJobs).values({
    id: jobId,
    sessionId,
    userId,
    status: 'pending',
    priority: 100,
    payload: JSON.stringify({
      ...params,
      timestamp: new Date().toISOString()
    }),
    retryCount: 0,
    maxRetries: 2,
    createdAt: new Date()
  });
  
  // Start processing in background (don't await)
  processJobInBackground(jobId).catch(err => {
    console.error(`[AsyncArtwork] Background processing failed for job ${jobId}:`, err);
  });
  
  console.log(`[AsyncArtwork] Enqueued job ${jobId} for user ${userId} session ${sessionId}`);
  return jobId;
}

/**
 * Process job in background (runs async, doesn't block)
 */
async function processJobInBackground(jobId: string): Promise<void> {
  // Get job from database
  const jobs = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  
  if (jobs.length === 0) {
    console.error(`[AsyncArtwork] Job ${jobId} not found in database`);
    return;
  }
  
  const job = jobs[0];
  const params = job.payload ? JSON.parse(job.payload) : {};
  
  try {
    // Update status to processing
    await db
      .update(generationJobs)
      .set({ 
        status: 'processing',
        startedAt: new Date()
      })
      .where(eq(generationJobs.id, jobId));
    const audioAnalysis = params.audioContext || {
      amplitude: 50,
      tempo: 120,
      mood: 'calm',
      frequencies: {
        bass: 0.3,
        mid: 0.4,
        treble: 0.3
      }
    };
    
    // Generate AI art prompt
    const promptResult = await generateArtPrompt({
      audioAnalysis,
      musicInfo: params.musicInfo,
      styles: params.styles || [],
      artists: params.artists || [],
      dynamicMode: params.dynamicMode || false,
      previousVotes: []
    });
    
    console.log(`[AsyncArtwork] Generated prompt for job ${jobId}: ${promptResult.prompt.substring(0, 100)}...`);
    
    // Generate artwork using DALL-E
    const imageUrl = await openaiService.generateArtImage(promptResult.prompt);
    
    console.log(`[AsyncArtwork] Generated image for job ${jobId}: ${imageUrl}`);
    
    // Store result in database
    const artSession = await db.insert(artSessions).values({
      id: nanoid(),
      sessionId: job.sessionId || '',
      userId: job.userId,
      imageUrl,
      prompt: promptResult.prompt,
      dnaVector: JSON.stringify(promptResult.dnaVector),
      audioFeatures: JSON.stringify(audioAnalysis),
      generationExplanation: promptResult.explanation,
      styles: params.styles || [],
      artists: params.artists || [],
      orientation: params.orientation || 'square',
      poolStatus: 'active',
      qualityScore: 0.8,
      isLibrary: false,
      createdAt: new Date()
    }).returning();
    
    // Mark as completed
    await db
      .update(generationJobs)
      .set({
        status: 'completed',
        result: JSON.stringify(artSession[0]),
        completedAt: new Date()
      })
      .where(eq(generationJobs.id, jobId));
    
    console.log(`[AsyncArtwork] Job ${jobId} completed successfully with real AI generation`);
  } catch (error: any) {
    console.error(`[AsyncArtwork] Job ${jobId} failed:`, error);
    
    // Check if we should retry
    const retryCount = (job.retryCount || 0) + 1;
    const maxRetries = job.maxRetries || 2;
    
    if (retryCount < maxRetries) {
      // Update retry count and re-queue for retry
      await db
        .update(generationJobs)
        .set({
          status: 'pending',
          retryCount: retryCount,
          errorMessage: error.message
        })
        .where(eq(generationJobs.id, jobId));
      
      console.log(`[AsyncArtwork] Retrying job ${jobId} (attempt ${retryCount + 1}/${maxRetries})`);
      
      // Re-queue for processing with exponential backoff
      const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000); // Max 10s
      setTimeout(() => {
        processJobInBackground(jobId).catch(err => {
          console.error(`[AsyncArtwork] Retry failed for job ${jobId}:`, err);
        });
      }, backoffMs);
    } else {
      // Max retries reached, mark as failed
      await db
        .update(generationJobs)
        .set({
          status: 'failed',
          errorMessage: error.message,
          completedAt: new Date()
        })
        .where(eq(generationJobs.id, jobId));
      
      console.error(`[AsyncArtwork] Job ${jobId} permanently failed after ${retryCount} retries`);
      
      // For failed jobs, try to include fallback artworks in the result
      const fallbackArtworks = await getFallbackArtworks(job.userId, 3);
      if (fallbackArtworks.length > 0) {
        // Store fallback artworks in the result so polling can return them
        await db
          .update(generationJobs)
          .set({
            result: JSON.stringify({ fallback: true, artworks: fallbackArtworks })
          })
          .where(eq(generationJobs.id, jobId));
        console.log(`[AsyncArtwork] Stored ${fallbackArtworks.length} fallback artworks for permanently failed job ${jobId}`);
      }
    }
  }
}

/**
 * Get job status for polling (database-only persistence)
 */
export async function getJobStatus(jobId: string): Promise<ArtworkJob | null> {
  // Check database (persistent)
  const dbJobs = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  
  if (dbJobs.length === 0) {
    return null;
  }
  
  const dbJob = dbJobs[0];
  
  // Parse result based on status
  let result = undefined;
  if (dbJob.result) {
    try {
      const parsed = JSON.parse(dbJob.result);
      // Handle both success and fallback formats
      if (parsed.fallback) {
        // Failed job with fallback artworks
        result = parsed.artworks || [];
      } else if (Array.isArray(parsed)) {
        // Legacy format (array of artworks)
        result = parsed;
      } else {
        // Single artwork result
        result = [parsed];
      }
    } catch (e) {
      console.error(`[AsyncArtwork] Failed to parse job result for ${jobId}:`, e);
    }
  }
  
  return {
    id: dbJob.id,
    sessionId: dbJob.sessionId || '',
    userId: dbJob.userId,
    status: dbJob.status as JobStatus,
    result,
    error: dbJob.errorMessage || undefined,
    createdAt: dbJob.createdAt,
    completedAt: dbJob.completedAt || undefined
  };
}

/**
 * Get fallback artworks when generation fails
 */
export async function getFallbackArtworks(
  userId: string,
  limit: number = 3
): Promise<any[]> {
  try {
    // Get from library/pool
    const fallbacks = await db
      .select()
      .from(artSessions)
      .where(
        and(
          eq(artSessions.isLibrary, true),
          eq(artSessions.poolStatus, 'active')
        )
      )
      .orderBy(desc(artSessions.qualityScore))
      .limit(limit);
    
    console.log(`[AsyncArtwork] Returning ${fallbacks.length} fallback artworks`);
    return fallbacks;
  } catch (error) {
    console.error('[AsyncArtwork] Error fetching fallback artworks:', error);
    return [];
  }
}

/**
 * Clean up old completed jobs from database
 */
export async function cleanupOldJobs(): Promise<void> {
  const maxAge = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
  
  try {
    // Delete old completed and failed jobs
    const result = await db
      .delete(generationJobs)
      .where(
        and(
          or(
            eq(generationJobs.status, 'completed'),
            eq(generationJobs.status, 'failed'),
            eq(generationJobs.status, 'cancelled')
          )
        )
      );
    
    console.log(`[AsyncArtwork] Cleaned up old jobs from database`);
  } catch (error) {
    console.error('[AsyncArtwork] Failed to cleanup old jobs:', error);
  }
}

/**
 * Recover orphaned jobs on server restart
 */
export async function recoverOrphanedJobs(): Promise<void> {
  try {
    // Find jobs that were processing when server stopped
    const orphanedJobs = await db
      .select()
      .from(generationJobs)
      .where(
        or(
          eq(generationJobs.status, 'processing'),
          eq(generationJobs.status, 'pending')
        )
      );
    
    console.log(`[AsyncArtwork] Found ${orphanedJobs.length} orphaned jobs to recover`);
    
    for (const job of orphanedJobs) {
      if (job.status === 'processing') {
        // Mark processing jobs as failed (they were interrupted)
        await db
          .update(generationJobs)
          .set({
            status: 'failed',
            errorMessage: 'Server restart - job interrupted',
            completedAt: new Date()
          })
          .where(eq(generationJobs.id, job.id));
        
        console.log(`[AsyncArtwork] Marked interrupted job ${job.id} as failed`);
      } else if (job.status === 'pending') {
        // Re-queue pending jobs with a small delay to avoid overwhelming the system
        console.log(`[AsyncArtwork] Re-queueing pending job ${job.id}`);
        setTimeout(() => {
          processJobInBackground(job.id).catch(err => {
            console.error(`[AsyncArtwork] Failed to re-queue job ${job.id}:`, err);
          });
        }, 1000 * Math.random()); // Random delay up to 1s to spread load
      }
    }
  } catch (error) {
    console.error('[AsyncArtwork] Failed to recover orphaned jobs:', error);
  }
}

// Run cleanup every minute
setInterval(cleanupOldJobs, 60 * 1000);

// Recover orphaned jobs on startup
recoverOrphanedJobs();