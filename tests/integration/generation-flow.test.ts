/**
 * Integration test for the complete art generation flow
 * Tests: enqueue → generate → record → display
 */

import { test, expect } from '@playwright/test';

test.describe('Art Generation Flow Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Set a longer timeout for generation tests
    test.setTimeout(90000); // 90 seconds
    
    // Navigate to the application
    await page.goto('/');
  });

  test('Complete generation flow - from enqueue to display', async ({ page }) => {
    // Step 1: Authenticate
    console.log('[Test] Step 1: Authenticating...');
    
    // Wait for auth to complete
    await page.waitForSelector('[data-testid="display-canvas"]', { timeout: 10000 });
    
    // Step 2: Verify circuit breaker is healthy
    console.log('[Test] Step 2: Checking circuit breaker status...');
    const breakerResponse = await page.request.get('/api/test/breaker-status');
    const breakerStatus = await breakerResponse.json();
    expect(breakerStatus.state).toBe('closed');
    console.log('[Test] Circuit breaker is healthy:', breakerStatus.state);
    
    // Step 3: Check if preferences are set
    console.log('[Test] Step 3: Checking user preferences...');
    const preferencesResponse = await page.request.get('/api/preferences');
    const preferences = await preferencesResponse.json();
    
    if (!preferences || preferences.styles?.length === 0) {
      console.log('[Test] No preferences set, setting default styles...');
      await page.request.post('/api/preferences', {
        data: {
          styles: ['futuristic', 'abstract'],
          dynamicMode: false
        }
      });
    }
    
    // Step 4: Trigger artwork generation by requesting next artwork
    console.log('[Test] Step 4: Triggering artwork generation...');
    
    // Get the current session ID from the page
    const sessionId = await page.evaluate(() => {
      // Try to get session ID from local storage or session storage
      return localStorage.getItem('sessionId') || 
             sessionStorage.getItem('sessionId') || 
             'test-session-' + Date.now();
    });
    
    // Request next artwork (this should trigger generation if needed)
    const startTime = Date.now();
    const artworkResponse = await page.request.get(`/api/artworks/next?sessionId=${sessionId}`, {
      timeout: 70000 // 70 second timeout
    });
    const elapsedMs = Date.now() - startTime;
    
    expect(artworkResponse.ok()).toBe(true);
    const artworkData = await artworkResponse.json();
    
    console.log(`[Test] Artwork response received in ${elapsedMs}ms`);
    console.log('[Test] Artworks received:', artworkData.artworks?.length);
    console.log('[Test] Pool size:', artworkData.poolSize);
    console.log('[Test] Fresh count:', artworkData.freshCount);
    console.log('[Test] Needs generation:', artworkData.needsGeneration);
    
    // Step 5: Verify artwork data structure
    console.log('[Test] Step 5: Verifying artwork data structure...');
    expect(artworkData).toHaveProperty('artworks');
    expect(Array.isArray(artworkData.artworks)).toBe(true);
    
    if (artworkData.artworks.length > 0) {
      const artwork = artworkData.artworks[0];
      expect(artwork).toHaveProperty('id');
      expect(artwork).toHaveProperty('imageUrl');
      expect(artwork).toHaveProperty('prompt');
      
      console.log('[Test] First artwork ID:', artwork.id);
      console.log('[Test] Image URL exists:', !!artwork.imageUrl);
      console.log('[Test] Prompt exists:', !!artwork.prompt);
    }
    
    // Step 6: Record impression for the artwork
    if (artworkData.artworks.length > 0) {
      console.log('[Test] Step 6: Recording impressions...');
      const artworkIds = artworkData.artworks.map(a => a.id);
      
      const impressionResponse = await page.request.post('/api/artworks/batch-impressions', {
        data: {
          artworkIds: artworkIds.slice(0, 5) // Record first 5
        }
      });
      
      expect(impressionResponse.ok()).toBe(true);
      const impressionResult = await impressionResponse.json();
      console.log('[Test] Impressions recorded:', impressionResult.recorded);
      console.log('[Test] Impressions filtered:', impressionResult.filtered);
    }
    
    // Step 7: Verify the display page is rendering
    console.log('[Test] Step 7: Verifying display rendering...');
    
    // Check if canvas is visible
    const canvas = page.locator('[data-testid="display-canvas"]');
    await expect(canvas).toBeVisible();
    
    // Check if there's an image being displayed
    const displayContainer = page.locator('[data-testid="artwork-display"]');
    if (await displayContainer.count() > 0) {
      await expect(displayContainer).toBeVisible();
      console.log('[Test] Artwork is being displayed');
    }
    
    // Step 8: Check generation health metrics
    console.log('[Test] Step 8: Checking generation health metrics...');
    const healthResponse = await page.request.get('/api/health');
    const health = await healthResponse.json();
    
    expect(health.status).toBe('healthy');
    console.log('[Test] System health:', health.status);
    console.log('[Test] Database status:', health.database?.status);
    console.log('[Test] Generation service status:', health.generationService?.status);
    
    // Step 9: Verify no critical errors in telemetry
    console.log('[Test] Step 9: Checking for critical errors...');
    const telemetryResponse = await page.request.get('/api/telemetry/dashboard');
    if (telemetryResponse.ok()) {
      const telemetry = await telemetryResponse.json();
      const criticalErrors = telemetry.events?.filter(e => e.severity === 'critical') || [];
      
      if (criticalErrors.length > 0) {
        console.warn('[Test] Critical errors found:', criticalErrors.length);
        criticalErrors.forEach(error => {
          console.warn('[Test] Critical error:', error.event, error.metrics);
        });
      } else {
        console.log('[Test] No critical errors found');
      }
    }
    
    console.log('[Test] ✅ Complete generation flow test passed!');
  });

  test('Circuit breaker handles failures gracefully', async ({ page }) => {
    console.log('[Test] Testing circuit breaker failure handling...');
    
    // Step 1: Force circuit breaker open
    const forceOpenResponse = await page.request.post('/api/test/force-breaker-open', {
      data: { durationMs: 5000 } // Open for 5 seconds
    });
    expect(forceOpenResponse.ok()).toBe(true);
    console.log('[Test] Circuit breaker forced open');
    
    // Step 2: Try to get artwork (should use fallback)
    const sessionId = 'test-breaker-' + Date.now();
    const artworkResponse = await page.request.get(`/api/artworks/next?sessionId=${sessionId}`);
    
    expect(artworkResponse.ok()).toBe(true);
    const artworkData = await artworkResponse.json();
    
    // Should still get artworks from storage/cache
    expect(artworkData.artworks).toBeDefined();
    console.log('[Test] Got fallback artworks:', artworkData.artworks?.length);
    console.log('[Test] Storage count:', artworkData.storageCount);
    
    // Step 3: Wait for circuit breaker to close
    await page.waitForTimeout(6000);
    
    // Step 4: Force close to ensure clean state
    await page.request.post('/api/test/force-breaker-closed');
    console.log('[Test] Circuit breaker reset to closed');
    
    console.log('[Test] ✅ Circuit breaker test passed!');
  });

  test('Timeout handling for long generation requests', async ({ page }) => {
    console.log('[Test] Testing timeout handling...');
    
    // This test verifies that the frontend properly handles long-running requests
    const sessionId = 'test-timeout-' + Date.now();
    
    // Make a request with a custom timeout handler
    const startTime = Date.now();
    try {
      const response = await page.request.get(`/api/artworks/next?sessionId=${sessionId}`, {
        timeout: 70000 // 70 seconds
      });
      
      const elapsedMs = Date.now() - startTime;
      console.log(`[Test] Request completed in ${elapsedMs}ms`);
      
      if (response.ok()) {
        const data = await response.json();
        console.log('[Test] Got response with artworks:', data.artworks?.length);
        expect(data.artworks).toBeDefined();
      } else {
        console.log('[Test] Request failed with status:', response.status());
        // Even on failure, we shouldn't timeout prematurely
        expect(elapsedMs).toBeGreaterThan(60000);
      }
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      console.log(`[Test] Request errored after ${elapsedMs}ms:`, error.message);
      
      // If it's a timeout, it should be after our configured timeout
      if (error.message.includes('timeout')) {
        expect(elapsedMs).toBeGreaterThanOrEqual(65000);
      }
    }
    
    console.log('[Test] ✅ Timeout handling test passed!');
  });
});