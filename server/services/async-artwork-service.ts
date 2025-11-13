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

// Simple in-memory job tracking (MVP)
// In production, this would be Redis or similar
const activeJobs = new Map<string, any>();

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
    // Try to get recently generated artworks from this session
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
      console.log(`[AsyncArtwork] Returning ${recentArtworks.length} cached artworks for immediate display`);
      return recentArtworks;
    }
    
    // If not enough recent ones, get from library
    const libraryArtworks = await db
      .select()
      .from(artSessions)
      .where(
        and(
          eq(artSessions.isLibrary, true),
          or(
            eq(artSessions.userId, userId),
            eq(artSessions.poolStatus, 'active')
          )
        )
      )
      .orderBy(desc(artSessions.qualityScore))
      .limit(limit);
    
    console.log(`[AsyncArtwork] Returning ${libraryArtworks.length} library artworks for immediate display`);
    return libraryArtworks;
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
  
  // Store in memory for fast access
  activeJobs.set(jobId, {
    id: jobId,
    sessionId,
    userId,
    status: 'pending',
    params,
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
  const job = activeJobs.get(jobId);
  if (!job) {
    console.error(`[AsyncArtwork] Job ${jobId} not found in active jobs`);
    return;
  }
  
  try {
    // Update status to processing
    job.status = 'processing';
    await db
      .update(generationJobs)
      .set({ 
        status: 'processing',
        startedAt: new Date()
      })
      .where(eq(generationJobs.id, jobId));
    
    // Simulate generation (in real app, this would call OpenAI)
    // For now, just wait and return mock data
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate 2s generation
    
    // Mock result (in real app, this would be actual artwork)
    const mockArtwork = {
      id: crypto.randomUUID(),
      imageUrl: '/public-objects/default-artwork.png',
      prompt: 'Generated artwork',
      sessionId: job.sessionId,
      userId: job.userId,
      createdAt: new Date()
    };
    
    // Mark as completed
    job.status = 'completed';
    job.result = mockArtwork;
    job.completedAt = new Date();
    
    await db
      .update(generationJobs)
      .set({
        status: 'completed',
        result: JSON.stringify(mockArtwork),
        completedAt: new Date()
      })
      .where(eq(generationJobs.id, jobId));
    
    console.log(`[AsyncArtwork] Job ${jobId} completed successfully`);
  } catch (error: any) {
    // Mark as failed
    job.status = 'failed';
    job.error = error.message;
    
    await db
      .update(generationJobs)
      .set({
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date()
      })
      .where(eq(generationJobs.id, jobId));
    
    console.error(`[AsyncArtwork] Job ${jobId} failed:`, error);
  }
}

/**
 * Get job status for polling
 */
export async function getJobStatus(jobId: string): Promise<ArtworkJob | null> {
  // Check memory first (fast)
  const memoryJob = activeJobs.get(jobId);
  if (memoryJob) {
    return memoryJob;
  }
  
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
  return {
    id: dbJob.id,
    sessionId: dbJob.sessionId || '',
    userId: dbJob.userId,
    status: dbJob.status as JobStatus,
    result: dbJob.result ? JSON.parse(dbJob.result) : undefined,
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
 * Clean up old completed jobs from memory
 */
export function cleanupOldJobs(): void {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes
  
  for (const [jobId, job] of activeJobs.entries()) {
    if (job.status === 'completed' || job.status === 'failed') {
      const age = now - job.createdAt.getTime();
      if (age > maxAge) {
        activeJobs.delete(jobId);
        console.log(`[AsyncArtwork] Cleaned up old job ${jobId}`);
      }
    }
  }
}

// Run cleanup every minute
setInterval(cleanupOldJobs, 60 * 1000);