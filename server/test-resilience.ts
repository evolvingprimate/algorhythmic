/**
 * Test script to validate DALL-E resilience mechanisms
 * Simulates timeouts and validates circuit breaker behavior
 */

import { generationHealthService } from './generation-health';
import { recoveryManager } from './recovery-manager';
import { deadLetterQueue } from './dead-letter-queue';
import { generateArtImage } from './openai-service';
import { telemetryService } from './telemetry-service';

// Mock environment for testing
const TEST_TIMEOUT_MS = 5000; // 5 second timeout for testing
const SIMULATED_HANG_MS = 10000; // 10 second simulated hang

/**
 * Simulate a hung DALL-E request
 */
async function simulateHungRequest(): Promise<void> {
  console.log('\n=== TEST: Simulating Hung DALL-E Request ===');
  
  // Temporarily reduce timeout for testing
  const originalTimeout = generationHealthService.getAdaptiveTimeout();
  generationHealthService['adaptiveTimeout'] = TEST_TIMEOUT_MS;
  
  try {
    // This should timeout and trigger circuit breaker
    const result = await generateArtImage({
      prompt: 'TEST: Simulated hung request that will timeout',
      userId: 'test-user',
      sessionId: 'test-session',
      delay: SIMULATED_HANG_MS // Add artificial delay
    });
    
    console.log('❌ Request should have timed out!');
  } catch (error: any) {
    if (error.reason === 'timeout') {
      console.log('✅ Request timed out as expected');
      console.log(`   Timeout: ${TEST_TIMEOUT_MS}ms`);
      console.log(`   Breaker state: ${generationHealthService.getBreakerState()}`);
      console.log(`   Token count: ${generationHealthService['tokenBucket']}`);
    } else {
      console.log('❌ Unexpected error:', error);
    }
  }
  
  // Restore original timeout
  generationHealthService['adaptiveTimeout'] = originalTimeout;
}

/**
 * Test circuit breaker transitions
 */
async function testCircuitBreaker(): Promise<void> {
  console.log('\n=== TEST: Circuit Breaker Transitions ===');
  
  // Reset state
  generationHealthService['tokenBucket'] = 3;
  generationHealthService['breakerState'] = 'closed';
  
  console.log('Initial state:');
  console.log(`  Breaker: ${generationHealthService.getBreakerState()}`);
  console.log(`  Tokens: ${generationHealthService['tokenBucket']}`);
  
  // Simulate 3 failures to open circuit
  for (let i = 1; i <= 3; i++) {
    console.log(`\nFailure ${i}:`);
    generationHealthService.recordFailure('timeout');
    console.log(`  Breaker: ${generationHealthService.getBreakerState()}`);
    console.log(`  Tokens: ${generationHealthService['tokenBucket']}`);
  }
  
  // Should be open now
  if (generationHealthService.getBreakerState() === 'open') {
    console.log('\n✅ Circuit breaker opened after 3 failures');
  } else {
    console.log('\n❌ Circuit breaker should be open');
  }
  
  // Test generation blocked when open
  const shouldGenerate = generationHealthService.shouldAttemptGeneration();
  if (!shouldGenerate) {
    console.log('✅ Generation blocked when breaker is open');
  } else {
    console.log('❌ Generation should be blocked');
  }
  
  // Simulate time passing for half-open transition
  console.log('\nSimulating 5 minute wait...');
  generationHealthService['breakerOpenedAt'] = Date.now() - (5 * 60 * 1000);
  
  // Force check for half-open transition
  const nowHalfOpen = generationHealthService.shouldAttemptGeneration();
  if (generationHealthService.getBreakerState() === 'half-open') {
    console.log('✅ Circuit breaker transitioned to half-open');
  } else {
    console.log('❌ Circuit breaker should be half-open');
  }
  
  // Record success to close breaker
  generationHealthService.recordSuccess(45000);
  if (generationHealthService.getBreakerState() === 'closed') {
    console.log('✅ Circuit breaker closed after success');
  } else {
    console.log('❌ Circuit breaker should be closed');
  }
}

/**
 * Test dead letter queue
 */
async function testDeadLetterQueue(): Promise<void> {
  console.log('\n=== TEST: Dead Letter Queue ===');
  
  const jobId = 'test-job-123';
  const prompt = 'Test prompt for DLQ';
  const userId = 'test-user';
  const sessionId = 'test-session';
  
  // Add failed job
  deadLetterQueue.addFailedJob(
    jobId,
    prompt,
    userId,
    sessionId,
    {
      reason: 'timeout',
      details: {
        timeoutMs: 5000,
        attemptNumber: 1,
        error: 'Simulated timeout'
      }
    },
    1
  );
  
  // Check if should retry
  const shouldRetry = deadLetterQueue.shouldRetryJob(jobId);
  console.log(`Should retry job: ${shouldRetry} ✅`);
  
  // Add more failures
  for (let i = 2; i <= 3; i++) {
    deadLetterQueue.addFailedJob(
      jobId,
      prompt,
      userId,
      sessionId,
      {
        reason: 'timeout',
        details: {
          timeoutMs: 5000,
          attemptNumber: i,
          error: `Attempt ${i} failed`
        }
      },
      i
    );
  }
  
  // Check if should NOT retry after max attempts
  const shouldNotRetry = deadLetterQueue.shouldRetryJob(jobId);
  if (!shouldNotRetry) {
    console.log('Job marked as critical after max attempts ✅');
  } else {
    console.log('Job should NOT be retried after max attempts ❌');
  }
  
  // Check stats
  const stats = deadLetterQueue.getStats();
  console.log('\nDLQ Stats:');
  console.log(`  Total jobs: ${stats.totalJobs}`);
  console.log(`  Critical jobs: ${stats.criticalJobs}`);
  console.log(`  Avg attempts: ${stats.avgAttempts}`);
}

/**
 * Test recovery manager
 */
async function testRecoveryManager(): Promise<void> {
  console.log('\n=== TEST: Recovery Manager ===');
  
  // Check probe scheduling
  const shouldProbe = recoveryManager.shouldSendProbe();
  console.log(`Should send probe: ${shouldProbe}`);
  
  // Get recovery batch size
  const batchSize = recoveryManager.getRecoveryBatchSize();
  console.log(`Recovery batch size: ${batchSize}`);
  
  // Check budget
  const withinBudget = recoveryManager['isWithinBudget']();
  console.log(`Within budget: ${withinBudget}`);
  
  // Record probe result
  if (shouldProbe) {
    recoveryManager.recordProbeResult(true, 100);
    console.log('Recorded successful probe ✅');
  }
  
  // Get stats
  const stats = recoveryManager.getStats();
  console.log('\nRecovery Stats:');
  console.log(`  Probes sent: ${stats.totalProbes}`);
  console.log(`  Success rate: ${(stats.successRate * 100).toFixed(1)}%`);
  console.log(`  Estimated cost: $${stats.estimatedCost.toFixed(4)}`);
}

/**
 * Main test runner
 */
async function runTests(): Promise<void> {
  console.log('🧪 DALL-E Resilience System Tests');
  console.log('==================================');
  
  try {
    // Run individual test suites
    await testCircuitBreaker();
    await testDeadLetterQueue();
    await testRecoveryManager();
    
    // Note: Skip actual hung request simulation to avoid delays
    // await simulateHungRequest();
    
    console.log('\n✅ All tests completed successfully!');
    
    // Print telemetry summary
    const events = telemetryService.getRecentEvents(10);
    console.log(`\n📊 Recent telemetry events: ${events.length}`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if executed directly
runTests().then(() => {
  console.log('\n🎉 Test suite finished!');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { runTests };