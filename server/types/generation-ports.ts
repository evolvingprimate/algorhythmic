/**
 * Port interfaces for dependency injection
 * Breaks circular dependencies between openai-service, generation-health, and recovery-manager
 * Based on recommendations from Grok and ChatGPT
 */

/**
 * Generation Health Port - manages circuit breaker and health metrics
 */
export interface GenerationHealthPort {
  // Job lifecycle management
  registerJob(jobId: string, isProbe: boolean): void;
  recordSuccess(latency: number, jobId: string): void;
  recordFailure(
    kind: 'timeout' | 'quota' | '5xx' | '4xx' | 'unknown',
    jobId: string
  ): void;
  isJobValid(jobId: string): boolean;
  
  // Circuit breaker state
  shouldAttemptGeneration(): boolean;
  getCurrentState(): 'closed' | 'open' | 'half-open';
  currentBudget(): number;
  
  // Timeout management
  getTimeout(): number; // Returns adaptive timeout in ms
  
  // Metrics
  getMetrics(): {
    successRate: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    totalTimeouts: number;
    totalSuccesses: number;
  };
  
  // Cleanup
  cleanupExpiredJobs(): void;
}

/**
 * Recovery Port - manages health probes and gradual recovery
 */
export interface RecoveryPort {
  // Probe scheduling
  scheduleProbe(kind: 'timeout' | 'burst' | 'quota'): void;
  cancelProbes(): void;
  
  // Recovery state
  isRecovering(): boolean;
  getBatchSize(): number;
  
  // Budget management
  getRemainingBudget(): number;
  shouldAttemptRecovery(): boolean;
}

/**
 * Dead Letter Queue Port - handles permanently failed jobs
 */
export interface DeadLetterPort {
  addJob(job: {
    jobId: string;
    prompt: string;
    reason: string;
    error?: Error;
    retryCount: number;
  }): void;
  
  getJobs(limit?: number): Array<{
    id: string;
    timestamp: Date;
    reason: string;
    retryCount: number;
  }>;
  
  clearOldJobs(olderThan: Date): number;
}

/**
 * Queue Controller Port - manages frame generation queue state
 */
export interface QueueControllerPort {
  evaluateState(queueSize: number): {
    state: 'HUNGRY' | 'SATISFIED' | 'OVERFULL';
    shouldGenerate: boolean;
    batchSize: number;
  };
  
  updateMetrics(metrics: {
    generationRate: number;
    consumptionRate: number;
  }): void;
}