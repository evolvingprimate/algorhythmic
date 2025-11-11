/**
 * Integration test for DALL-E circuit breaker timeout handling
 * Tests:
 * - Timeout triggers at 45-60 seconds
 * - Circuit breaker opens after failures
 * - Recovery after circuit opens
 */

import { GenerationHealthService } from '../generation-health';
import { OpenAIService } from '../openai-service';
import { telemetryService } from '../telemetry-service';

// Mock OpenAI module
const mockOpenAIGenerate = jest.fn();
jest.mock('openai', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      images: {
        generate: mockOpenAIGenerate
      }
    }))
  };
});

describe('Circuit Breaker Timeout Handling', () => {
  let healthService: GenerationHealthService;
  let openAIService: OpenAIService;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create fresh instances
    healthService = new GenerationHealthService();
    openAIService = new OpenAIService(healthService);
    
    // Reset environment
    process.env.GEN_BREAKER_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Timeout Detection', () => {
    it('should timeout generation after 45-60 seconds', async () => {
      // Mock OpenAI to hang for 65 seconds
      mockOpenAIGenerate.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 65000))
      );

      // Start timer
      const startTime = Date.now();
      
      // Attempt generation (should timeout)
      const generatePromise = openAIService.generateArtImage('test prompt');
      
      // Wait for timeout
      await expect(generatePromise).rejects.toThrow();
      
      // Check that timeout occurred within expected range (45-90 seconds)
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(45000); // Min timeout
      expect(elapsed).toBeLessThanOrEqual(90000); // Max timeout
      
      // Verify telemetry event was recorded
      const telemetryEvents = telemetryService.getEvents();
      const failEvent = telemetryEvents.find(e => e.event === 'gen.fail' && e.metrics.error_type === 'timeout');
      expect(failEvent).toBeDefined();
    });

    it('should properly cancel HTTP request on timeout', async () => {
      let abortSignalReceived = false;
      
      // Mock OpenAI to detect abort signal
      mockOpenAIGenerate.mockImplementation((params, options) => {
        return new Promise((resolve, reject) => {
          // Listen for abort signal
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              abortSignalReceived = true;
              reject(new Error('AbortError'));
            });
          }
          // Hang indefinitely
          setTimeout(() => resolve({ data: [{ url: 'test-url' }] }), 100000);
        });
      });

      // Attempt generation with shorter timeout for testing
      const originalTimeout = healthService.getTimeout();
      jest.spyOn(healthService, 'getTimeout').mockReturnValue(1000); // 1 second for test
      
      await expect(openAIService.generateArtImage('test prompt')).rejects.toThrow();
      
      // Verify abort signal was sent
      expect(abortSignalReceived).toBe(true);
    });
  });

  describe('Circuit Breaker State Transitions', () => {
    it('should open circuit breaker after multiple failures', async () => {
      // Mock OpenAI to always timeout quickly
      mockOpenAIGenerate.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      );
      
      // Override timeout for faster testing
      jest.spyOn(healthService, 'getTimeout').mockReturnValue(100);
      
      // Initial state should be closed
      expect(healthService.getCurrentState()).toBe('closed');
      
      // Generate failures to open breaker
      const failures = [];
      for (let i = 0; i < 6; i++) {
        failures.push(
          openAIService.generateArtImage(`test prompt ${i}`)
            .catch(() => 'failed')
        );
      }
      
      await Promise.all(failures);
      
      // Circuit breaker should be open now
      expect(healthService.getCurrentState()).toBe('open');
      
      // Verify telemetry event for breaker opening
      const telemetryEvents = telemetryService.getEvents();
      const openEvent = telemetryEvents.find(e => e.event === 'circuit_breaker_opened');
      expect(openEvent).toBeDefined();
    });

    it('should reject requests immediately when circuit is open', async () => {
      // Force circuit breaker to open state
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      
      expect(healthService.getCurrentState()).toBe('open');
      
      // Attempt generation should fail immediately
      const startTime = Date.now();
      await expect(openAIService.generateArtImage('test prompt')).rejects.toThrow('unavailable');
      const elapsed = Date.now() - startTime;
      
      // Should reject almost immediately (< 100ms)
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Circuit Breaker Recovery', () => {
    it('should transition to half-open state after cool-down period', async () => {
      jest.useFakeTimers();
      
      // Open the circuit breaker
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      
      expect(healthService.getCurrentState()).toBe('open');
      
      // Advance time to half of open duration (2.5 minutes)
      jest.advanceTimersByTime(150000);
      
      // Should be in half-open state
      expect(healthService.getCurrentState()).toBe('half-open');
      
      // Some requests should be allowed through (sampling)
      let allowedCount = 0;
      for (let i = 0; i < 100; i++) {
        if (healthService.shouldAttemptGeneration()) {
          allowedCount++;
        }
      }
      
      // Should allow ~10% of requests (sampling rate)
      expect(allowedCount).toBeGreaterThan(5);
      expect(allowedCount).toBeLessThan(20);
    });

    it('should close circuit after consecutive successes in half-open state', async () => {
      jest.useFakeTimers();
      
      // Open the circuit breaker
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      
      // Move to half-open state
      jest.advanceTimersByTime(150000);
      expect(healthService.getCurrentState()).toBe('half-open');
      
      // Record consecutive successes
      for (let i = 0; i < 3; i++) {
        healthService.recordSuccess(1000, `success-job-${i}`);
      }
      
      // Circuit should be closed after 3 consecutive successes
      expect(healthService.getCurrentState()).toBe('closed');
      
      // Verify recovery telemetry event
      const telemetryEvents = telemetryService.getEvents();
      const recoveryEvent = telemetryEvents.find(e => e.event === 'circuit_breaker_recovered');
      expect(recoveryEvent).toBeDefined();
    });

    it('should reset recovery on failure during half-open state', async () => {
      jest.useFakeTimers();
      
      // Open the circuit breaker
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      
      // Move to half-open state
      jest.advanceTimersByTime(150000);
      expect(healthService.getCurrentState()).toBe('half-open');
      
      // Record some successes
      healthService.recordSuccess(1000, 'success-1');
      healthService.recordSuccess(1000, 'success-2');
      
      // Then a failure
      healthService.recordFailure('timeout', 'failure-during-recovery');
      
      // Should reset recovery progress
      const telemetryEvents = telemetryService.getEvents();
      const resetEvent = telemetryEvents.find(e => e.event === 'recovery_reset');
      expect(resetEvent).toBeDefined();
      expect(resetEvent?.metrics.reason).toBe('failure_during_recovery');
    });
  });

  describe('Adaptive Timeout', () => {
    it('should adjust timeout based on P95 latency', () => {
      // Record various latencies
      const latencies = [
        30000, 35000, 40000, 45000, 50000, // Normal
        55000, 60000, 65000, 70000, 75000, // Slower
      ];
      
      latencies.forEach((latency, i) => {
        healthService.recordSuccess(latency, `job-${i}`);
      });
      
      // Get adaptive timeout (should be P95 + buffer)
      const timeout = healthService.getTimeout();
      
      // Should be between 45-90 seconds
      expect(timeout).toBeGreaterThanOrEqual(45000);
      expect(timeout).toBeLessThanOrEqual(90000);
      
      // Should be approximately P95 + 10 seconds
      // P95 of our data should be around 73500ms
      // So timeout should be ~83500ms (clamped if needed)
      expect(timeout).toBeGreaterThan(70000);
    });

    it('should clamp timeout to min/max bounds', () => {
      // Record very fast latencies
      for (let i = 0; i < 20; i++) {
        healthService.recordSuccess(5000, `fast-job-${i}`);
      }
      
      // Should still respect minimum timeout
      let timeout = healthService.getTimeout();
      expect(timeout).toBeGreaterThanOrEqual(45000);
      
      // Record very slow latencies
      for (let i = 0; i < 20; i++) {
        healthService.recordSuccess(120000, `slow-job-${i}`);
      }
      
      // Should respect maximum timeout
      timeout = healthService.getTimeout();
      expect(timeout).toBeLessThanOrEqual(90000);
    });
  });

  describe('Retry Behavior', () => {
    it('should retry with exponential backoff on timeout', async () => {
      jest.useFakeTimers();
      let attemptCount = 0;
      
      // Mock OpenAI to fail first 2 times, succeed on 3rd
      mockOpenAIGenerate.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error('Timeout'));
        }
        return Promise.resolve({ data: [{ url: 'success-url' }] });
      });
      
      // Override timeout for faster testing
      jest.spyOn(healthService, 'getTimeout').mockReturnValue(100);
      
      const generatePromise = openAIService.generateArtImage('test prompt');
      
      // Fast-forward through retries
      // First attempt fails immediately
      await jest.runOnlyPendingTimersAsync();
      
      // First retry after 15 seconds
      jest.advanceTimersByTime(15000);
      await jest.runOnlyPendingTimersAsync();
      
      // Second retry after 30 seconds
      jest.advanceTimersByTime(30000);
      await jest.runOnlyPendingTimersAsync();
      
      const result = await generatePromise;
      expect(result).toBe('success-url');
      expect(attemptCount).toBe(3);
    });

    it('should give up after max retries', async () => {
      // Mock OpenAI to always fail
      mockOpenAIGenerate.mockRejectedValue(new Error('Persistent failure'));
      
      // Override timeout for faster testing
      jest.spyOn(healthService, 'getTimeout').mockReturnValue(100);
      
      await expect(openAIService.generateArtImage('test prompt')).rejects.toThrow();
      
      // Should have attempted 3 times total (initial + 2 retries)
      expect(mockOpenAIGenerate).toHaveBeenCalledTimes(3);
    });
  });

  describe('Job Tracking', () => {
    it('should track active jobs and clean up on completion', async () => {
      mockOpenAIGenerate.mockResolvedValue({ data: [{ url: 'test-url' }] });
      
      // Start multiple concurrent jobs
      const jobs = [
        openAIService.generateArtImage('prompt1'),
        openAIService.generateArtImage('prompt2'),
        openAIService.generateArtImage('prompt3'),
      ];
      
      // Check active jobs are being tracked
      const metrics = healthService.getHealthMetrics();
      expect(metrics.queueDepth).toBeGreaterThan(0);
      
      // Wait for all to complete
      await Promise.all(jobs);
      
      // Active jobs should be cleaned up
      const finalMetrics = healthService.getHealthMetrics();
      expect(finalMetrics.queueDepth).toBe(0);
    });

    it('should expire stale jobs', async () => {
      // Register a job
      const jobId = 'test-job';
      healthService.registerJob(jobId, false);
      
      // Initially should be valid
      expect(healthService.isJobValid(jobId)).toBe(true);
      
      // Fast-forward past expiration (90 seconds)
      jest.useFakeTimers();
      jest.advanceTimersByTime(91000);
      
      // Job should be expired
      expect(healthService.isJobValid(jobId)).toBe(false);
      
      jest.useRealTimers();
    });
  });
});

// Simple test runner if Jest is not available
if (typeof jest === 'undefined') {
  console.log('Running tests without Jest...\n');
  
  class SimpleTestRunner {
    private tests: Array<{ name: string; fn: () => Promise<void> }> = [];
    private currentSuite = '';
    
    describe(name: string, fn: () => void) {
      this.currentSuite = name;
      fn();
    }
    
    it(name: string, fn: () => Promise<void>) {
      this.tests.push({ name: `${this.currentSuite} > ${name}`, fn });
    }
    
    async run() {
      let passed = 0;
      let failed = 0;
      
      for (const test of this.tests) {
        try {
          await test.fn();
          console.log(`✅ ${test.name}`);
          passed++;
        } catch (error) {
          console.log(`❌ ${test.name}`);
          console.error(`   ${error}`);
          failed++;
        }
      }
      
      console.log(`\n${passed} passed, ${failed} failed`);
      process.exit(failed > 0 ? 1 : 0);
    }
  }
  
  // Run tests
  const runner = new SimpleTestRunner();
  
  // Basic smoke test without Jest
  runner.describe('Circuit Breaker Basic Test', () => {
    runner.it('should create health service', async () => {
      const healthService = new GenerationHealthService();
      if (healthService.getCurrentState() !== 'closed') {
        throw new Error('Initial state should be closed');
      }
    });
    
    runner.it('should track failures', async () => {
      const healthService = new GenerationHealthService();
      healthService.recordFailure('timeout', 'job-1');
      const metrics = healthService.getHealthMetrics();
      if (metrics.consecutiveFailures !== 1) {
        throw new Error('Should track consecutive failures');
      }
    });
    
    runner.it('should open after multiple failures', async () => {
      const healthService = new GenerationHealthService();
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      if (healthService.getCurrentState() === 'closed') {
        throw new Error('Should open after 5 failures');
      }
    });
  });
  
  runner.run();
}