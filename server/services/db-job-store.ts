import { db } from '../db';
import { generationJobs } from '@shared/schema';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { JobStore, GenerationJob as QueueJob, JobStatus } from './job-queue';

// Database-backed job store implementation
export class DatabaseJobStore implements JobStore {
  async save(job: QueueJob): Promise<void> {
    await db.insert(generationJobs).values({
      id: job.id,
      sessionId: job.sessionId || null,
      userId: job.userId,
      status: job.status as any,
      priority: job.priority,
      payload: JSON.stringify({
        sessionId: job.sessionId,
        userId: job.userId,
      }),
      retryCount: job.retries,
      maxRetries: job.maxRetries,
      result: job.result ? JSON.stringify(job.result) : null,
      errorMessage: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
  }

  async get(jobId: string): Promise<QueueJob | null> {
    const results = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .limit(1);
    
    if (results.length === 0) return null;
    
    const dbJob = results[0];
    return this.mapToQueueJob(dbJob);
  }

  async update(jobId: string, updates: Partial<QueueJob>): Promise<void> {
    const updateData: any = {};
    
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.startedAt !== undefined) updateData.startedAt = updates.startedAt;
    if (updates.completedAt !== undefined) updateData.completedAt = updates.completedAt;
    if (updates.result !== undefined) updateData.result = JSON.stringify(updates.result);
    if (updates.error !== undefined) updateData.errorMessage = updates.error;
    if (updates.retries !== undefined) updateData.retryCount = updates.retries;
    
    await db
      .update(generationJobs)
      .set(updateData)
      .where(eq(generationJobs.id, jobId));
  }

  async delete(jobId: string): Promise<void> {
    await db
      .delete(generationJobs)
      .where(eq(generationJobs.id, jobId));
  }

  async getByStatus(status: JobStatus): Promise<QueueJob[]> {
    const results = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.status, status as any))
      .orderBy(desc(generationJobs.priority), asc(generationJobs.createdAt));
    
    return results.map(dbJob => this.mapToQueueJob(dbJob));
  }

  async getByUserId(userId: string): Promise<QueueJob[]> {
    const results = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.userId, userId))
      .orderBy(desc(generationJobs.createdAt));
    
    return results.map(dbJob => this.mapToQueueJob(dbJob));
  }

  private mapToQueueJob(dbJob: any): QueueJob {
    return {
      id: dbJob.id,
      sessionId: dbJob.sessionId || '',
      userId: dbJob.userId,
      status: dbJob.status as JobStatus,
      priority: dbJob.priority,
      createdAt: dbJob.createdAt,
      startedAt: dbJob.startedAt || undefined,
      completedAt: dbJob.completedAt || undefined,
      result: dbJob.result ? JSON.parse(dbJob.result) : undefined,
      error: dbJob.errorMessage || undefined,
      retries: dbJob.retryCount,
      maxRetries: dbJob.maxRetries,
    };
  }
}