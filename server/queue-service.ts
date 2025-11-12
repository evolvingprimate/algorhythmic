/**
 * PostgreSQL-backed Queue Service for Async DALL-E Processing
 * 
 * Implements:
 * - Job enqueueing with priority support
 * - Worker loop with concurrent processing
 * - Circuit breaker integration
 * - Credit system integration
 * - Exponential backoff for retries
 * - Dead letter queue for failed jobs
 * - WebSocket notifications
 */

import { sql } from "drizzle-orm";
import { generationJobs } from "@shared/schema";
import type { IStorage } from "./storage";
import type { GenerationHealthPort } from "./types/generation-ports";
import type { CreditController } from "./generation/creditController";
import { telemetryService } from "./telemetry-service";
import { generateArtPrompt, generateArtImage } from "./openai-service";
import { wsSequence } from "./websocket-sequence";

// Job status enum
export const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter'
} as const;

export type JobStatus = typeof JOB_STATUS[keyof typeof JOB_STATUS];

// Job payload interface
export interface JobPayload {
  sessionId: string;
  audioAnalysis: any; // AudioAnalysis type
  musicInfo?: any; // MusicIdentification type
  styles: string[];
  artists: string[];
  dynamicMode?: boolean;
  previousVotes?: Array<{ prompt: string; vote: number }>;
  orientation?: 'portrait' | 'landscape' | 'square';
  isPreGeneration?: boolean; // Flag for pre-generated frames
  preGenerationReason?: string; // Reason for pre-generation
}

// Job result interface
export interface JobResult {
  artworkId: string;
  imageUrl: string;
  prompt: string;
  dnaVector: number[];
  explanation: string;
}

// Worker configuration
const WORKER_CONFIG = {
  POLLING_INTERVAL: 5000, // 5 seconds
  MAX_CONCURRENT_JOBS: 3,
  INITIAL_BACKOFF: 1000, // 1 second
  MAX_BACKOFF: 32000, // 32 seconds
  BACKOFF_MULTIPLIER: 2,
  LOCK_TIMEOUT: 60000, // 60 seconds to process a job
  BATCH_SIZE: 5, // Number of jobs to fetch per poll
};

export class QueueService {
  private isRunning = false;
  private activeJobs = new Map<string, Promise<void>>();
  private pollInterval: NodeJS.Timeout | null = null;
  private backoffDelay = WORKER_CONFIG.INITIAL_BACKOFF;

  constructor(
    private storage: IStorage,
    private generationHealth: GenerationHealthPort,
    private creditController: CreditController
  ) {}

  /**
   * Enqueue a new generation job
   */
  async enqueueJob(
    userId: string,
    payload: JobPayload,
    priority: number = 0
  ): Promise<string> {
    try {
      // Create job record
      const job = await this.storage.createGenerationJob({
        userId,
        status: JOB_STATUS.PENDING,
        priority,
        payload: JSON.stringify(payload),
        retryCount: 0,
        maxRetries: 3,
      });

      telemetryService.recordEvent({
        event: 'job_enqueued',
        category: 'queue',
        severity: 'info',
        metrics: {
          jobId: job.id,
          userId,
          priority,
        }
      });

      // Notify via WebSocket that job is queued
      wsSequence.broadcast({
        type: 'job_queued',
        payload: {
          jobId: job.id,
          userId,
          status: JOB_STATUS.PENDING,
        }
      });

      return job.id;
    } catch (error) {
      console.error('[QueueService] Failed to enqueue job:', error);
      telemetryService.recordEvent({
        event: 'job_enqueue_failed',
        category: 'queue',
        severity: 'error',
        metrics: {
          error: error.message,
          userId,
        }
      });
      throw error;
    }
  }

  /**
   * Enqueue a pre-generation job with lower priority
   */
  async enqueuePreGenerationJob(
    userId: string,
    sessionId: string,
    styles: string[],
    count: number = 1,
    reason: string = 'Pool coverage threshold'
  ): Promise<string[]> {
    const jobIds: string[] = [];
    
    try {
      // Create default audio analysis for pre-generation
      const defaultAudioAnalysis = {
        tempo: 120,
        amplitude: 0.5,
        frequency: 440,
        bassLevel: 50,
        trebleLevel: 50,
        rhythmComplexity: 0.5,
        mood: 'calm' as const,
        genre: 'ambient'
      };
      
      // Enqueue multiple jobs for the requested count
      for (let i = 0; i < count; i++) {
        // Rotate through styles to ensure diversity
        const selectedStyles = [styles[i % styles.length]];
        
        const payload: JobPayload = {
          sessionId,
          audioAnalysis: defaultAudioAnalysis,
          styles: selectedStyles,
          artists: [],
          dynamicMode: false,
          orientation: 'landscape',
          isPreGeneration: true,
          preGenerationReason: reason
        };
        
        // Use lower priority for pre-generation
        const jobId = await this.enqueueJob(userId, payload, -10);
        jobIds.push(jobId);
      }
      
      telemetryService.recordEvent({
        event: 'pre_generation_jobs_enqueued',
        category: 'queue',
        severity: 'info',
        metrics: {
          count,
          userId,
          sessionId,
          reason
        }
      });
      
      return jobIds;
    } catch (error) {
      console.error('[QueueService] Failed to enqueue pre-generation jobs:', error);
      telemetryService.recordEvent({
        event: 'pre_generation_enqueue_failed',
        category: 'queue',
        severity: 'error',
        metrics: {
          error: error.message,
          userId,
          sessionId
        }
      });
      throw error;
    }
  }

  /**
   * Start the worker loop
   */
  startWorker(): void {
    if (this.isRunning) {
      console.log('[QueueService] Worker already running');
      return;
    }

    this.isRunning = true;
    this.backoffDelay = WORKER_CONFIG.INITIAL_BACKOFF;
    
    console.log('[QueueService] Starting worker loop');
    telemetryService.recordEvent({
      event: 'worker_started',
      category: 'queue',
      severity: 'info',
    });

    this.scheduleNextPoll();
  }

  /**
   * Stop the worker loop
   */
  async stopWorker(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[QueueService] Stopping worker loop');
    this.isRunning = false;

    // Clear polling interval
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      this.pollInterval = null;
    }

    // Wait for active jobs to complete
    if (this.activeJobs.size > 0) {
      console.log(`[QueueService] Waiting for ${this.activeJobs.size} active jobs to complete`);
      await Promise.all(this.activeJobs.values());
    }

    telemetryService.recordEvent({
      event: 'worker_stopped',
      category: 'queue',
      severity: 'info',
    });
  }

  /**
   * Schedule the next poll
   */
  private scheduleNextPoll(): void {
    if (!this.isRunning) {
      return;
    }

    this.pollInterval = setTimeout(() => {
      this.pollAndProcess().finally(() => {
        if (this.isRunning) {
          this.scheduleNextPoll();
        }
      });
    }, WORKER_CONFIG.POLLING_INTERVAL);
  }

  /**
   * Poll for jobs and process them
   */
  private async pollAndProcess(): Promise<void> {
    try {
      // Check circuit breaker state
      if (!this.generationHealth.shouldAttemptGeneration()) {
        const breakerState = this.generationHealth.getCurrentState();
        
        if (breakerState === 'open') {
          console.log('[QueueService] Circuit breaker is open, pausing worker');
          telemetryService.recordEvent({
            event: 'worker_paused_breaker_open',
            category: 'queue',
            severity: 'warning',
          });
          
          // Increase backoff delay
          this.backoffDelay = Math.min(
            this.backoffDelay * WORKER_CONFIG.BACKOFF_MULTIPLIER,
            WORKER_CONFIG.MAX_BACKOFF
          );
          
          // Wait before next poll
          await this.sleep(this.backoffDelay);
          return;
        }
        
        // Half-open state - proceed with caution
        console.log('[QueueService] Circuit breaker is half-open, processing with reduced capacity');
      } else {
        // Reset backoff on successful health check
        this.backoffDelay = WORKER_CONFIG.INITIAL_BACKOFF;
      }

      // Check available slots
      const availableSlots = WORKER_CONFIG.MAX_CONCURRENT_JOBS - this.activeJobs.size;
      if (availableSlots <= 0) {
        console.log('[QueueService] No available slots, skipping poll');
        return;
      }

      // Fetch pending jobs
      const jobs = await this.storage.getPendingJobs(Math.min(availableSlots, WORKER_CONFIG.BATCH_SIZE));
      
      if (jobs.length === 0) {
        // No jobs to process
        return;
      }

      console.log(`[QueueService] Found ${jobs.length} pending jobs`);
      
      // Process jobs concurrently
      for (const job of jobs) {
        if (this.activeJobs.size >= WORKER_CONFIG.MAX_CONCURRENT_JOBS) {
          break; // Max concurrency reached
        }

        // Start processing job
        const processingPromise = this.processJob(job)
          .finally(() => {
            this.activeJobs.delete(job.id);
          });

        this.activeJobs.set(job.id, processingPromise);
      }
    } catch (error) {
      console.error('[QueueService] Poll and process error:', error);
      telemetryService.recordEvent({
        event: 'worker_poll_error',
        category: 'queue',
        severity: 'error',
        metrics: {
          error: error.message,
        }
      });
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: any): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`[QueueService] Processing job ${job.id}`);
      
      // Atomically update job status to processing
      const acquired = await this.storage.acquireJobLock(job.id, job.version);
      if (!acquired) {
        console.log(`[QueueService] Failed to acquire lock for job ${job.id}`);
        return; // Another worker got this job
      }

      const payload: JobPayload = JSON.parse(job.payload);

      // Check user credits
      const creditsCheck = await this.storage.getCreditsContext(job.userId);
      if (!creditsCheck || creditsCheck.balance <= 0) {
        throw new Error('Insufficient credits');
      }

      // Deduct credit (with idempotency)
      const deductResult = await this.storage.deductCredit(
        job.userId,
        1,
        {
          jobId: job.id,
          reason: 'generation_job',
        }
      );

      if (!deductResult.success) {
        throw new Error('Failed to deduct credit');
      }

      try {
        // Generate art prompt
        const promptResult = await generateArtPrompt({
          audioAnalysis: payload.audioAnalysis,
          musicInfo: payload.musicInfo,
          styles: payload.styles,
          artists: payload.artists,
          dynamicMode: payload.dynamicMode,
          previousVotes: payload.previousVotes,
        });

        // Register job with health service
        const jobHandle = this.generationHealth.registerJob(job.id, false);

        try {
          // Generate image
          const imageUrl = await generateArtImage(promptResult.prompt);
          
          // Mark job as successful
          this.generationHealth.recordJobSuccess(jobHandle);

          // Store result
          const artSession = await this.storage.createArtSession({
            sessionId: payload.sessionId,
            userId: job.userId,
            imageUrl,
            prompt: promptResult.prompt,
            dnaVector: JSON.stringify(promptResult.dnaVector),
            audioFeatures: JSON.stringify(payload.audioAnalysis),
            musicTrack: payload.musicInfo?.title,
            musicArtist: payload.musicInfo?.artist,
            musicGenre: payload.musicInfo?.genre,
            generationExplanation: promptResult.explanation,
            styles: payload.styles,
            artists: payload.artists,
            orientation: payload.orientation || 'square',
          });

          // Update job as completed
          const result: JobResult = {
            artworkId: artSession.id,
            imageUrl,
            prompt: promptResult.prompt,
            dnaVector: promptResult.dnaVector,
            explanation: promptResult.explanation,
          };

          await this.storage.updateJobStatus(
            job.id,
            JOB_STATUS.COMPLETED,
            { result: JSON.stringify(result) }
          );

          // Notify via WebSocket
          wsSequence.broadcast({
            type: 'job_completed',
            payload: {
              jobId: job.id,
              userId: job.userId,
              result,
            }
          });

          const duration = Date.now() - startTime;
          telemetryService.recordEvent({
            event: 'job_completed',
            category: 'queue',
            severity: 'info',
            metrics: {
              jobId: job.id,
              userId: job.userId,
              duration,
            }
          });

        } catch (generationError) {
          // Mark job as failed with health service
          this.generationHealth.recordJobFailure(jobHandle, generationError);
          throw generationError;
        }

      } catch (processingError) {
        // Refund credit on failure
        await this.storage.refundCredit(
          job.userId,
          1,
          'Generation failed',
          {
            jobId: job.id,
            error: processingError.message,
          }
        );

        throw processingError;
      }

    } catch (error) {
      console.error(`[QueueService] Job ${job.id} failed:`, error);
      
      // Handle retry logic
      await this.handleJobFailure(job, error);
    }
  }

  /**
   * Handle job failure with retry logic
   */
  private async handleJobFailure(job: any, error: any): Promise<void> {
    const newRetryCount = job.retryCount + 1;
    
    if (newRetryCount >= job.maxRetries) {
      // Move to dead letter queue
      console.log(`[QueueService] Moving job ${job.id} to dead letter queue`);
      
      await this.storage.updateJobStatus(
        job.id,
        JOB_STATUS.DEAD_LETTER,
        {
          errorMessage: error.message,
          retryCount: newRetryCount,
        }
      );

      // Notify via WebSocket
      wsSequence.broadcast({
        type: 'job_failed',
        payload: {
          jobId: job.id,
          userId: job.userId,
          error: error.message,
          movedToDeadLetter: true,
        }
      });

      telemetryService.recordEvent({
        event: 'job_dead_letter',
        category: 'queue',
        severity: 'error',
        metrics: {
          jobId: job.id,
          userId: job.userId,
          retryCount: newRetryCount,
          error: error.message,
        }
      });
    } else {
      // Schedule retry with exponential backoff
      const backoffDelay = this.calculateBackoff(newRetryCount);
      
      console.log(`[QueueService] Scheduling retry ${newRetryCount} for job ${job.id} in ${backoffDelay}ms`);
      
      await this.storage.updateJobStatus(
        job.id,
        JOB_STATUS.PENDING,
        {
          retryCount: newRetryCount,
          errorMessage: error.message,
          // Update priority to push retries later
          priority: job.priority - newRetryCount,
        }
      );

      telemetryService.recordEvent({
        event: 'job_retry_scheduled',
        category: 'queue',
        severity: 'warning',
        metrics: {
          jobId: job.id,
          userId: job.userId,
          retryCount: newRetryCount,
          backoffDelay,
        }
      });

      // Wait before making job available again
      setTimeout(() => {
        // Job will be picked up in next poll
      }, backoffDelay);
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(retryCount: number): number {
    return Math.min(
      WORKER_CONFIG.INITIAL_BACKOFF * Math.pow(WORKER_CONFIG.BACKOFF_MULTIPLIER, retryCount - 1),
      WORKER_CONFIG.MAX_BACKOFF
    );
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<any> {
    return this.storage.getGenerationJob(jobId);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get worker metrics
   */
  getMetrics(): {
    isRunning: boolean;
    activeJobs: number;
    maxConcurrent: number;
    backoffDelay: number;
  } {
    return {
      isRunning: this.isRunning,
      activeJobs: this.activeJobs.size,
      maxConcurrent: WORKER_CONFIG.MAX_CONCURRENT_JOBS,
      backoffDelay: this.backoffDelay,
    };
  }

  /**
   * Process dead letter queue (manual intervention)
   */
  async processDeadLetterQueue(limit: number = 10): Promise<void> {
    console.log('[QueueService] Processing dead letter queue');
    
    const deadJobs = await this.storage.getDeadLetterJobs(limit);
    
    for (const job of deadJobs) {
      console.log(`[QueueService] Reprocessing dead letter job ${job.id}`);
      
      // Reset job to pending
      await this.storage.updateJobStatus(
        job.id,
        JOB_STATUS.PENDING,
        {
          retryCount: 0, // Reset retry count
          errorMessage: null,
          priority: 10, // High priority for manual reprocessing
        }
      );

      telemetryService.recordEvent({
        event: 'dead_letter_reprocessed',
        category: 'queue',
        severity: 'info',
        metrics: {
          jobId: job.id,
          userId: job.userId,
        }
      });
    }
  }
}

// Export singleton instance (will be properly initialized in bootstrap)
export let queueService: QueueService;