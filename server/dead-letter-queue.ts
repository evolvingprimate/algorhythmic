import { telemetryService } from './telemetry-service';
import { GenerationFailure } from './openai-service';

/**
 * Dead Letter Queue for handling repeatedly failed generation jobs
 * Based on Grok/ChatGPT recommendations for preventing job loss
 */

export interface DeadLetterJob {
  id: string;
  prompt: string;
  userId: string;
  sessionId: string | null;
  attemptCount: number;
  maxAttempts: number;
  firstFailureTime: number;
  lastFailureTime: number;
  errors: Array<{
    timestamp: number;
    reason: string;
    error?: any;
  }>;
  metadata?: any;
}

class DeadLetterQueue {
  private deadJobs = new Map<string, DeadLetterJob>();
  private readonly MAX_DLQ_SIZE = 1000;
  private readonly MAX_ATTEMPTS = 3;
  private readonly JOB_EXPIRY_MS = 3600000; // 1 hour
  
  /**
   * Add a failed job to the DLQ
   */
  addFailedJob(
    jobId: string,
    prompt: string,
    userId: string,
    sessionId: string | null,
    failure: GenerationFailure,
    attemptCount: number = 1
  ): void {
    const existingJob = this.deadJobs.get(jobId);
    
    if (existingJob) {
      // Update existing job
      existingJob.attemptCount = attemptCount;
      existingJob.lastFailureTime = Date.now();
      existingJob.errors.push({
        timestamp: Date.now(),
        reason: failure.reason,
        error: failure.details.error
      });
      
      console.log(`[DLQ] Updated job ${jobId}, attempts: ${attemptCount}`);
    } else {
      // Add new job
      const deadJob: DeadLetterJob = {
        id: jobId,
        prompt,
        userId,
        sessionId,
        attemptCount,
        maxAttempts: this.MAX_ATTEMPTS,
        firstFailureTime: Date.now(),
        lastFailureTime: Date.now(),
        errors: [{
          timestamp: Date.now(),
          reason: failure.reason,
          error: failure.details.error
        }]
      };
      
      // Enforce size limit
      if (this.deadJobs.size >= this.MAX_DLQ_SIZE) {
        // Remove oldest job
        const oldestJob = this.getOldestJob();
        if (oldestJob) {
          this.deadJobs.delete(oldestJob.id);
          console.warn(`[DLQ] Size limit reached, removed oldest job: ${oldestJob.id}`);
        }
      }
      
      this.deadJobs.set(jobId, deadJob);
      console.log(`[DLQ] Added new job ${jobId} to dead letter queue`);
    }
    
    // Check if job should be surfaced for ops
    if (attemptCount >= this.MAX_ATTEMPTS) {
      this.surfaceToOps(jobId);
    }
    
    // Track telemetry
    telemetryService.recordEvent({
      event: 'dlq_job_added',
      category: 'system',
      severity: attemptCount >= this.MAX_ATTEMPTS ? 'error' : 'warning',
      metrics: {
        job_id: jobId,
        attempt_count: attemptCount,
        failure_reason: failure.reason,
        dlq_size: this.deadJobs.size,
        user_id: userId
      },
      userId,
      sessionId: sessionId || undefined
    });
  }
  
  /**
   * Check if a job should be retried
   */
  shouldRetryJob(jobId: string): boolean {
    const job = this.deadJobs.get(jobId);
    if (!job) return true; // Not in DLQ, can retry
    
    return job.attemptCount < this.MAX_ATTEMPTS;
  }
  
  /**
   * Get attempt count for a job
   */
  getAttemptCount(jobId: string): number {
    const job = this.deadJobs.get(jobId);
    return job ? job.attemptCount : 0;
  }
  
  /**
   * Surface job to ops UI/monitoring
   */
  private surfaceToOps(jobId: string): void {
    const job = this.deadJobs.get(jobId);
    if (!job) return;
    
    console.error(`[DLQ] CRITICAL: Job ${jobId} exceeded max attempts`, {
      userId: job.userId,
      sessionId: job.sessionId,
      attempts: job.attemptCount,
      errors: job.errors
    });
    
    // Track critical telemetry
    telemetryService.recordEvent({
      event: 'dlq_job_max_attempts',
      category: 'system',
      severity: 'critical',
      metrics: {
        job_id: jobId,
        user_id: job.userId,
        session_id: job.sessionId || 'none',
        attempt_count: job.attemptCount,
        first_failure_age_ms: Date.now() - job.firstFailureTime,
        error_reasons: job.errors.map(e => e.reason).join(',')
      }
    });
    
    // TODO: Send to ops dashboard, PagerDuty, etc.
  }
  
  /**
   * Get oldest job in queue
   */
  private getOldestJob(): DeadLetterJob | null {
    let oldest: DeadLetterJob | null = null;
    
    for (const job of this.deadJobs.values()) {
      if (!oldest || job.firstFailureTime < oldest.firstFailureTime) {
        oldest = job;
      }
    }
    
    return oldest;
  }
  
  /**
   * Clean up expired jobs
   */
  cleanupExpired(): void {
    const now = Date.now();
    const expired: string[] = [];
    
    for (const [jobId, job] of this.deadJobs.entries()) {
      if (now - job.lastFailureTime > this.JOB_EXPIRY_MS) {
        expired.push(jobId);
      }
    }
    
    for (const jobId of expired) {
      this.deadJobs.delete(jobId);
    }
    
    if (expired.length > 0) {
      console.log(`[DLQ] Cleaned up ${expired.length} expired jobs`);
      
      telemetryService.recordEvent({
        event: 'dlq_cleanup',
        category: 'system',
        severity: 'info',
        metrics: {
          expired_count: expired.length,
          remaining_count: this.deadJobs.size
        }
      });
    }
  }
  
  /**
   * Get DLQ statistics
   */
  getStats(): {
    totalJobs: number;
    criticalJobs: number;
    oldestJobAge: number | null;
    avgAttempts: number;
  } {
    const now = Date.now();
    let criticalCount = 0;
    let totalAttempts = 0;
    let oldestAge: number | null = null;
    
    for (const job of this.deadJobs.values()) {
      if (job.attemptCount >= this.MAX_ATTEMPTS) {
        criticalCount++;
      }
      totalAttempts += job.attemptCount;
      
      const age = now - job.firstFailureTime;
      if (oldestAge === null || age > oldestAge) {
        oldestAge = age;
      }
    }
    
    return {
      totalJobs: this.deadJobs.size,
      criticalJobs: criticalCount,
      oldestJobAge: oldestAge,
      avgAttempts: this.deadJobs.size > 0 ? totalAttempts / this.deadJobs.size : 0
    };
  }
  
  /**
   * Get jobs for ops dashboard
   */
  getJobsForOps(limit = 10): DeadLetterJob[] {
    const jobs = Array.from(this.deadJobs.values());
    
    // Sort by criticality (attempt count) and age
    jobs.sort((a, b) => {
      // Critical jobs first
      if (a.attemptCount >= this.MAX_ATTEMPTS && b.attemptCount < this.MAX_ATTEMPTS) return -1;
      if (b.attemptCount >= this.MAX_ATTEMPTS && a.attemptCount < this.MAX_ATTEMPTS) return 1;
      
      // Then by attempt count
      if (a.attemptCount !== b.attemptCount) {
        return b.attemptCount - a.attemptCount;
      }
      
      // Then by age
      return a.firstFailureTime - b.firstFailureTime;
    });
    
    return jobs.slice(0, limit);
  }
}

// Singleton instance
export const deadLetterQueue = new DeadLetterQueue();

// Run cleanup every 5 minutes
setInterval(() => {
  deadLetterQueue.cleanupExpired();
}, 300000);