import crypto from 'crypto';

// Job status enum
export enum JobStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// Job interface
export interface GenerationJob {
  id: string;
  sessionId: string;
  userId: string;
  status: JobStatus;
  priority: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: any;
  error?: string;
  retries: number;
  maxRetries: number;
}

// Job result type
export interface JobResult {
  ok: boolean;
  durationMs: number;
  data?: any;
  error?: Error;
}

// JobStore interface for future Redis/DB swap
export interface JobStore {
  save(job: GenerationJob): Promise<void>;
  get(jobId: string): Promise<GenerationJob | null>;
  update(jobId: string, updates: Partial<GenerationJob>): Promise<void>;
  delete(jobId: string): Promise<void>;
  getByStatus(status: JobStatus): Promise<GenerationJob[]>;
  getByUserId(userId: string): Promise<GenerationJob[]>;
}

// In-memory implementation for MVP
export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, GenerationJob>();

  async save(job: GenerationJob): Promise<void> {
    this.jobs.set(job.id, job);
  }

  async get(jobId: string): Promise<GenerationJob | null> {
    return this.jobs.get(jobId) || null;
  }

  async update(jobId: string, updates: Partial<GenerationJob>): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      this.jobs.set(jobId, job);
    }
  }

  async delete(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  async getByStatus(status: JobStatus): Promise<GenerationJob[]> {
    return Array.from(this.jobs.values()).filter(job => job.status === status);
  }

  async getByUserId(userId: string): Promise<GenerationJob[]> {
    return Array.from(this.jobs.values()).filter(job => job.userId === userId);
  }
}

// Job queue with concurrency control
export class GenerationQueue {
  private queue: GenerationJob[] = [];
  private processing = new Map<string, GenerationJob>();
  private store: JobStore;
  
  // Concurrency limits
  private maxConcurrentGlobal = 10;
  private maxConcurrentPerUser = 2;
  
  // Metrics for adaptive throttling
  private successRate = 1.0;
  private avgDuration = 0;
  private totalJobs = 0;
  private successfulJobs = 0;
  
  // Job processor function
  private processor: ((job: GenerationJob) => Promise<any>) | null = null;
  
  // WebSocket notifier (optional)
  private notifier: ((job: GenerationJob) => void) | null = null;

  constructor(store?: JobStore) {
    this.store = store || new InMemoryJobStore();
    // Resume any orphaned jobs on startup
    this.resumeOrphanedJobs();
  }

  // Set the job processor function
  setProcessor(processor: (job: GenerationJob) => Promise<any>) {
    this.processor = processor;
  }

  // Set the WebSocket notifier
  setNotifier(notifier: (job: GenerationJob) => void) {
    this.notifier = notifier;
  }

  // Enqueue a new job
  async enqueue(
    sessionId: string,
    userId: string,
    options: Partial<GenerationJob> = {}
  ): Promise<string> {
    // Check per-user concurrency limit
    const userJobs = await this.getUserActiveJobs(userId);
    if (userJobs >= this.maxConcurrentPerUser) {
      throw new Error(`User ${userId} has reached concurrent job limit`);
    }

    const jobId = crypto.randomUUID();
    const job: GenerationJob = {
      id: jobId,
      sessionId,
      userId,
      status: JobStatus.QUEUED,
      priority: this.calculatePriority(options),
      createdAt: new Date(),
      retries: 0,
      maxRetries: 2,
      ...options
    };

    // Save to store
    await this.store.save(job);
    
    // Add to queue
    this.queue.push(job);
    this.queue.sort((a, b) => b.priority - a.priority);
    
    // Start processing (don't await)
    this.processNext();
    
    return jobId;
  }

  // Process next job in queue
  private async processNext() {
    // Check global concurrency limit
    if (this.processing.size >= this.maxConcurrentGlobal) {
      return;
    }

    // Get next job
    const job = this.queue.shift();
    if (!job || !this.processor) {
      return;
    }

    // Check user concurrency again
    const userJobs = await this.getUserActiveJobs(job.userId);
    if (userJobs >= this.maxConcurrentPerUser) {
      // Put it back at the front
      this.queue.unshift(job);
      return;
    }

    // Mark as processing
    this.processing.set(job.id, job);
    job.status = JobStatus.PROCESSING;
    job.startedAt = new Date();
    await this.store.update(job.id, { status: job.status, startedAt: job.startedAt });

    try {
      // Process with timeout wrapper (60 seconds)
      const startTime = Date.now();
      const result = await this.withTimeout(this.processor(job), 60000);
      const duration = Date.now() - startTime;
      
      // Update job
      job.status = JobStatus.COMPLETED;
      job.completedAt = new Date();
      job.result = result;
      await this.store.update(job.id, {
        status: job.status,
        completedAt: job.completedAt,
        result: job.result
      });

      // Update metrics
      this.updateMetrics(true, duration);
      
      // Notify via WebSocket if available
      if (this.notifier) {
        this.notifier(job);
      }
    } catch (error: any) {
      console.error(`Job ${job.id} failed:`, error);
      
      job.error = error.message;
      job.retries++;

      if (job.retries < job.maxRetries) {
        // Retry
        job.status = JobStatus.QUEUED;
        this.queue.unshift(job); // Put at front for retry
      } else {
        // Final failure
        job.status = JobStatus.FAILED;
        job.completedAt = new Date();
      }

      await this.store.update(job.id, {
        status: job.status,
        error: job.error,
        retries: job.retries,
        completedAt: job.completedAt
      });

      // Update metrics
      this.updateMetrics(false, Date.now() - job.startedAt!.getTime());
    } finally {
      // Remove from processing
      this.processing.delete(job.id);
      
      // Process next job
      setImmediate(() => this.processNext());
    }
  }

  // Get job status
  async getJob(jobId: string): Promise<GenerationJob | null> {
    return this.store.get(jobId);
  }

  // Cancel a job
  async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.store.get(jobId);
    if (!job) return false;

    if (job.status === JobStatus.QUEUED) {
      // Remove from queue
      const index = this.queue.findIndex(j => j.id === jobId);
      if (index >= 0) {
        this.queue.splice(index, 1);
      }
    }

    // Mark as cancelled
    job.status = JobStatus.CANCELLED;
    await this.store.update(jobId, { status: JobStatus.CANCELLED });
    
    return true;
  }

  // Get metrics
  getMetrics() {
    return {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
      maxConcurrentGlobal: this.maxConcurrentGlobal,
      maxConcurrentPerUser: this.maxConcurrentPerUser,
      successRate: this.successRate,
      avgDuration: this.avgDuration,
      totalJobs: this.totalJobs,
      successfulJobs: this.successfulJobs
    };
  }

  // Private helper methods
  
  private calculatePriority(options: Partial<GenerationJob>): number {
    let priority = 100;
    
    // Boost priority for first frame
    if (options.priority) {
      priority = options.priority;
    }
    
    return priority;
  }

  private async getUserActiveJobs(userId: string): Promise<number> {
    const userJobs = await this.store.getByUserId(userId);
    return userJobs.filter(job => 
      job.status === JobStatus.PROCESSING || 
      job.status === JobStatus.QUEUED
    ).length;
  }

  private updateMetrics(success: boolean, duration: number) {
    this.totalJobs++;
    if (success) this.successfulJobs++;
    
    // Exponential moving average
    const alpha = 0.2;
    const beta = 0.1;
    
    this.avgDuration = this.avgDuration === 0
      ? duration
      : this.avgDuration * (1 - alpha) + duration * alpha;
    
    const sample = success ? 1 : 0;
    this.successRate = this.successRate * (1 - beta) + sample * beta;
    
    // Adjust concurrency based on metrics
    this.adjustConcurrency();
  }

  private adjustConcurrency() {
    // If success rate is high and duration is low, increase concurrency
    if (this.successRate > 0.8 && this.avgDuration < 4000) {
      this.maxConcurrentGlobal = Math.min(this.maxConcurrentGlobal + 1, 20);
    }
    
    // If success rate is low or duration is high, decrease concurrency
    if (this.successRate < 0.5 || this.avgDuration > 8000) {
      this.maxConcurrentGlobal = Math.max(this.maxConcurrentGlobal - 1, 3);
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      )
    ]);
  }

  private async resumeOrphanedJobs() {
    // On startup, mark any processing jobs as failed
    const processingJobs = await this.store.getByStatus(JobStatus.PROCESSING);
    for (const job of processingJobs) {
      job.status = JobStatus.FAILED;
      job.error = 'Server restart - job interrupted';
      await this.store.update(job.id, {
        status: JobStatus.FAILED,
        error: job.error
      });
    }
    
    // Re-queue any queued jobs
    const queuedJobs = await this.store.getByStatus(JobStatus.QUEUED);
    this.queue.push(...queuedJobs);
    this.queue.sort((a, b) => b.priority - a.priority);
  }
}

// Singleton instance
let queueInstance: GenerationQueue | null = null;

export function getGenerationQueue(): GenerationQueue {
  if (!queueInstance) {
    queueInstance = new GenerationQueue();
  }
  return queueInstance;
}