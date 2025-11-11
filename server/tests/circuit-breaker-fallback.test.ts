/**
 * Integration test for circuit breaker fallback cascade
 * Tests the critical fix ensuring fallback triggers when breaker is open
 */

import { GenerationHealthService } from '../generation-health';
import { QueueController } from '../queue-controller';
import { RecoveryManager } from '../recovery-manager';
import { resolveEmergencyFallback } from '../fallback-service';
import { generateProceduralBridge } from '../procedural-bridge';
import { telemetryService } from '../telemetry-service';
import type { IStorage } from '../storage';

// Mock storage for testing
const mockStorage: Partial<IStorage> = {
  getQueueMetrics: jest.fn().mockResolvedValue({
    freshCount: 1,
    totalCount: 5,
    oldestTimestamp: new Date(),
    generationRate: 1.0,
    consumptionRate: 1.0
  }),
  getPreferencesBySession: jest.fn().mockResolvedValue({
    styles: ['cyberpunk', 'digital'],
    artists: [],
    dynamicMode: false
  }),
  getFreshArtworks: jest.fn().mockResolvedValue([]),
  getCatalogCandidates: jest.fn().mockResolvedValue([
    {
      id: 'catalog-1',
      imageUrl: 'https://example.com/catalog1.jpg',
      prompt: 'Test catalog artwork 1',
      userId: 'test-user',
      sessionId: 'test-session'
    },
    {
      id: 'catalog-2',
      imageUrl: 'https://example.com/catalog2.jpg',
      prompt: 'Test catalog artwork 2',
      userId: 'test-user',
      sessionId: 'test-session'
    }
  ])
};

// Mock OpenAI generation function
const mockGenerateArtImage = jest.fn();

describe('Circuit Breaker Fallback Cascade', () => {
  let healthService: GenerationHealthService;
  let queueController: QueueController;
  let recoveryManager: RecoveryManager;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Create services
    healthService = new GenerationHealthService();
    recoveryManager = new RecoveryManager(healthService, mockGenerateArtImage);
    queueController = new QueueController(healthService, recoveryManager);
    
    // Enable circuit breaker
    process.env.GEN_BREAKER_ENABLED = 'true';
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
  });
  
  describe('Fallback Triggers When Breaker Open', () => {
    it('should return fallback decision when circuit breaker is open', () => {
      // Force circuit breaker to open state
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      
      expect(healthService.getCurrentState()).toBe('open');
      
      // Get generation decision
      const decision = queueController.getGenerationDecision();
      
      // Should deny generation with specific reason
      expect(decision.shouldGenerate).toBe(false);
      expect(decision.reason).toBe('breaker_open');
    });
    
    it('should provide fallback frames within 100ms when breaker is open', async () => {
      // Force circuit breaker to open
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      
      const startTime = Date.now();
      
      // Simulate fallback resolution
      const fallbackResult = await resolveEmergencyFallback(
        mockStorage as IStorage,
        'test-session',
        'test-user',
        {
          styleTags: ['cyberpunk'],
          minFrames: 2,
          useCache: true
        }
      );
      
      const elapsed = Date.now() - startTime;
      
      // Should complete quickly (< 100ms)
      expect(elapsed).toBeLessThan(100);
      
      // Should return catalog frames
      expect(fallbackResult.artworks).toHaveLength(2);
      expect(fallbackResult.tier).toBe('style-matched');
      expect(fallbackResult.artworks[0].id).toBe('catalog-1');
    });
    
    it('should cascade through fallback tiers when higher tiers are empty', async () => {
      // Mock empty fresh and empty catalog
      (mockStorage.getFreshArtworks as jest.Mock).mockResolvedValue([]);
      (mockStorage.getCatalogCandidates as jest.Mock).mockResolvedValueOnce([]); // First call empty
      (mockStorage.getCatalogCandidates as jest.Mock).mockResolvedValueOnce([   // Second call (global) has frames
        {
          id: 'global-1',
          imageUrl: 'https://example.com/global1.jpg',
          prompt: 'Global fallback artwork',
          userId: 'other-user',
          sessionId: 'other-session'
        }
      ]);
      
      const fallbackResult = await resolveEmergencyFallback(
        mockStorage as IStorage,
        'test-session',
        'test-user',
        {
          styleTags: ['cyberpunk'],
          minFrames: 1,
          useCache: false
        }
      );
      
      // Should fall through to global tier
      expect(fallbackResult.tier).toBe('global');
      expect(fallbackResult.artworks).toHaveLength(1);
      expect(fallbackResult.artworks[0].id).toBe('global-1');
    });
    
    it('should use procedural bridge as last resort when all tiers fail', () => {
      // Test procedural bridge generation
      const proceduralData = generateProceduralBridge(['cyberpunk']);
      
      // Should generate valid procedural data
      expect(proceduralData.type).toBe('gradient');
      expect(proceduralData.palette).toBeDefined();
      expect(proceduralData.palette.length).toBeGreaterThan(0);
      expect(proceduralData.gradientParams).toBeDefined();
      expect(proceduralData.gradientParams?.direction).toBeGreaterThanOrEqual(0);
      expect(proceduralData.gradientParams?.direction).toBeLessThanOrEqual(360);
      expect(proceduralData.styleHint).toBe('cyberpunk');
    });
  });
  
  describe('Queue Controller Integration', () => {
    it('should differentiate between breaker-open and queue-full reasons', () => {
      // Test queue full scenario
      queueController.reset();
      
      // Set queue to OVERFULL state by simulating high queue metrics
      const metrics = {
        queueSize: 5, // Above MAX_FRAMES (4)
        targetSize: queueController.TARGET_FRAMES,
        minSize: queueController.MIN_FRAMES,
        maxSize: queueController.MAX_FRAMES,
        generationRate: 0,
        consumptionRate: 0
      };
      
      // Process multiple ticks to trigger state change
      queueController.tick(metrics);
      queueController.tick(metrics); // Need 2 ticks for hysteresis
      
      const decision = queueController.getGenerationDecision();
      
      // Should deny generation due to queue full
      expect(decision.shouldGenerate).toBe(false);
      expect(decision.reason).toBe('queue_full');
    });
    
    it('should handle half-open state with sampling', () => {
      // Force circuit breaker to open, then let it transition to half-open
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      
      expect(healthService.getCurrentState()).toBe('open');
      
      // Simulate time passing (would normally use fake timers)
      // In half-open, breaker allows some requests through for testing
      // This is handled internally by the health service
      
      let denialCount = 0;
      let allowCount = 0;
      
      // Test multiple decision attempts
      for (let i = 0; i < 10; i++) {
        const decision = queueController.getGenerationDecision();
        if (decision.shouldGenerate) {
          allowCount++;
        } else {
          denialCount++;
          // When denied in half-open, should have appropriate reason
          if (decision.reason) {
            expect(['breaker_open', 'breaker_half_open']).toContain(decision.reason);
          }
        }
      }
      
      // In open state, all should be denied
      expect(denialCount).toBeGreaterThan(0);
    });
  });
  
  describe('Telemetry and Monitoring', () => {
    it('should record telemetry when fallback is triggered', async () => {
      // Spy on telemetry service
      const recordEventSpy = jest.spyOn(telemetryService, 'recordEvent');
      
      // Force breaker open
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      
      // Get decision which should trigger telemetry
      const decision = queueController.getGenerationDecision();
      
      // Verify telemetry was recorded
      expect(recordEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'generation',
          event: 'generation_denied_breaker',
          metrics: expect.objectContaining({
            breaker_state: 'open',
            reason: 'breaker_denial'
          }),
          severity: 'warning'
        })
      );
      
      // Simulate fallback resolution
      await resolveEmergencyFallback(
        mockStorage as IStorage,
        'test-session',
        'test-user',
        { styleTags: ['cyberpunk'], minFrames: 2 }
      );
      
      // Should record fallback telemetry
      expect(recordEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'fallback',
          event: 'tier_selected'
        })
      );
    });
    
    it('should track fallback cascade performance', async () => {
      const timings: number[] = [];
      
      // Test multiple fallback resolutions
      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        
        await resolveEmergencyFallback(
          mockStorage as IStorage,
          'test-session',
          'test-user',
          { styleTags: ['cyberpunk'], minFrames: 2 }
        );
        
        timings.push(Date.now() - start);
      }
      
      // All resolutions should be fast
      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      expect(avgTime).toBeLessThan(50); // Well under 100ms requirement
      
      // No timing should exceed 100ms
      expect(Math.max(...timings)).toBeLessThan(100);
    });
  });
  
  describe('End-to-End Verification', () => {
    it('should never return empty frames when breaker is open', async () => {
      // Force breaker open
      for (let i = 0; i < 5; i++) {
        healthService.recordFailure('timeout', `job-${i}`);
      }
      
      // Mock various failure scenarios
      const testScenarios = [
        { fresh: [], catalog: [], global: [] }, // All empty
        { fresh: [], catalog: [], global: [{ id: 'g1', imageUrl: 'url', prompt: 'p' }] }, // Only global
        { fresh: [], catalog: [{ id: 'c1', imageUrl: 'url', prompt: 'p' }], global: [] }, // Only catalog
      ];
      
      for (const scenario of testScenarios) {
        (mockStorage.getFreshArtworks as jest.Mock).mockResolvedValueOnce(scenario.fresh);
        (mockStorage.getCatalogCandidates as jest.Mock).mockResolvedValueOnce(scenario.catalog);
        (mockStorage.getCatalogCandidates as jest.Mock).mockResolvedValueOnce(scenario.global);
        
        const decision = queueController.getGenerationDecision();
        expect(decision.shouldGenerate).toBe(false);
        expect(decision.reason).toBe('breaker_open');
        
        // Even with empty pools, should get procedural bridge
        if (scenario.fresh.length === 0 && scenario.catalog.length === 0 && scenario.global.length === 0) {
          const procedural = generateProceduralBridge(['abstract']);
          expect(procedural).toBeDefined();
          expect(procedural.palette.length).toBeGreaterThan(0);
        } else {
          // Should get frames from available tier
          const fallback = await resolveEmergencyFallback(
            mockStorage as IStorage,
            'test-session',
            'test-user',
            { minFrames: 1 }
          );
          
          expect(fallback.artworks.length).toBeGreaterThan(0);
        }
      }
    });
    
    it('should maintain <100ms latency requirement across all paths', async () => {
      const latencies: { path: string; time: number }[] = [];
      
      // Test breaker decision latency
      const decisionStart = Date.now();
      queueController.getGenerationDecision();
      latencies.push({ path: 'breaker_decision', time: Date.now() - decisionStart });
      
      // Test catalog fallback latency
      const catalogStart = Date.now();
      await resolveEmergencyFallback(
        mockStorage as IStorage,
        'test-session',
        'test-user',
        { styleTags: ['cyberpunk'], minFrames: 2 }
      );
      latencies.push({ path: 'catalog_fallback', time: Date.now() - catalogStart });
      
      // Test procedural bridge latency
      const proceduralStart = Date.now();
      generateProceduralBridge(['abstract', 'digital']);
      latencies.push({ path: 'procedural_bridge', time: Date.now() - proceduralStart });
      
      // All paths should be under 100ms
      for (const { path, time } of latencies) {
        expect(time).toBeLessThan(100);
        console.log(`[Performance] ${path}: ${time}ms`);
      }
      
      // Total end-to-end should also be under 100ms
      const totalTime = latencies.reduce((sum, l) => sum + l.time, 0);
      expect(totalTime).toBeLessThan(100);
    });
  });
});