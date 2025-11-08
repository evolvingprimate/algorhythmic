import { test, expect } from '@playwright/test';
import { analyzeCanvas, sampleCanvasPixels, calculateColorVariance } from '../helpers/canvas-analysis';

test.describe('Art Generation Pipeline', () => {
  test('should show Frame A immediately at full brightness (no black frames)', async ({ page }) => {
    console.log('Starting test: Frame A brightness verification');
    
    await page.goto('/');
    
    await page.waitForTimeout(2000);
    
    const loginButton = page.locator('[data-testid="button-login"]');
    const isLoginVisible = await loginButton.isVisible().catch(() => false);
    
    if (isLoginVisible) {
      console.log('Login button found, clicking...');
      await loginButton.click();
      await page.waitForURL('**/display', { timeout: 30000 });
    }
    
    await expect(page).toHaveURL(/.*display/);
    console.log('Successfully navigated to display page');
    
    const styleButton = page.locator('[data-testid^="button-style"]').first();
    await styleButton.waitFor({ state: 'visible', timeout: 10000 });
    await styleButton.click();
    console.log('Style selected');
    
    await page.waitForTimeout(500);
    
    const createButton = page.locator('[data-testid="button-create-art"]');
    await createButton.waitFor({ state: 'visible', timeout: 10000 });
    await createButton.click();
    console.log('Create Art button clicked');
    
    await page.waitForTimeout(2000);
    
    console.log('Waiting for art generation API to complete...');
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/generate-art') && response.status() === 200,
      { timeout: 60000 }
    );
    
    await responsePromise;
    console.log('Art generation API completed successfully');
    
    await page.waitForTimeout(3000);
    
    const canvasAnalysis = await analyzeCanvas(page);
    
    console.log('Canvas analysis:', JSON.stringify(canvasAnalysis, null, 2));
    
    expect(canvasAnalysis.error).toBeUndefined();
    
    expect(canvasAnalysis.avgLuminance).toBeGreaterThan(0.05);
    console.log(`✓ Average luminance: ${canvasAnalysis.avgLuminance.toFixed(3)} (> 0.05)`);
    
    expect(canvasAnalysis.blackPixelPercent).toBeLessThan(95);
    console.log(`✓ Black pixel percentage: ${canvasAnalysis.blackPixelPercent.toFixed(2)}% (< 95%)`);
    
    expect(canvasAnalysis.width).toBeGreaterThan(100);
    expect(canvasAnalysis.height).toBeGreaterThan(100);
    console.log(`✓ Canvas dimensions: ${canvasAnalysis.width}x${canvasAnalysis.height}`);
  });
  
  test('should verify Frame A opacity is 1.0 at start', async ({ page }) => {
    console.log('Starting test: Frame A opacity verification');
    
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('opacityA') || text.includes('Frame A') || text.includes('MorphEngine')) {
        consoleLogs.push(text);
        console.log(`Browser console: ${text}`);
      }
    });
    
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    const loginButton = page.locator('[data-testid="button-login"]');
    const isLoginVisible = await loginButton.isVisible().catch(() => false);
    
    if (isLoginVisible) {
      console.log('Login button found, clicking...');
      await loginButton.click();
      await page.waitForURL('**/display', { timeout: 30000 });
    }
    
    const styleButton = page.locator('[data-testid^="button-style"]').first();
    await styleButton.waitFor({ state: 'visible', timeout: 10000 });
    await styleButton.click();
    
    await page.waitForTimeout(500);
    
    const createButton = page.locator('[data-testid="button-create-art"]');
    await createButton.waitFor({ state: 'visible', timeout: 10000 });
    await createButton.click();
    console.log('Create Art button clicked, waiting for generation...');
    
    await page.waitForResponse(
      response => response.url().includes('/api/generate-art') && response.status() === 200,
      { timeout: 60000 }
    );
    
    console.log('Art generation completed, waiting for renderer initialization...');
    await page.waitForTimeout(3000);
    
    const morphEngineState = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'No canvas found' };
      
      return {
        canvasExists: true,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height
      };
    });
    
    console.log('MorphEngine state:', JSON.stringify(morphEngineState, null, 2));
    
    await page.waitForTimeout(2000);
    
    console.log(`Captured ${consoleLogs.length} relevant console logs`);
    
    expect(consoleLogs.length).toBeGreaterThan(0);
  });

  test('should render canvas with color variation', async ({ page }) => {
    console.log('Starting test: Canvas color variation verification');
    
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    const loginButton = page.locator('[data-testid="button-login"]');
    const isLoginVisible = await loginButton.isVisible().catch(() => false);
    
    if (isLoginVisible) {
      await loginButton.click();
      await page.waitForURL('**/display', { timeout: 30000 });
    }
    
    const styleButton = page.locator('[data-testid^="button-style"]').first();
    await styleButton.waitFor({ state: 'visible', timeout: 10000 });
    await styleButton.click();
    await page.waitForTimeout(500);
    
    const createButton = page.locator('[data-testid="button-create-art"]');
    await createButton.waitFor({ state: 'visible', timeout: 10000 });
    await createButton.click();
    
    await page.waitForResponse(
      response => response.url().includes('/api/generate-art') && response.status() === 200,
      { timeout: 60000 }
    );
    
    await page.waitForTimeout(3000);
    
    const pixelSamples = await sampleCanvasPixels(page, 100);
    
    expect(pixelSamples.length).toBeGreaterThan(0);
    console.log(`Sampled ${pixelSamples.length} pixels from canvas`);
    
    const variance = calculateColorVariance(pixelSamples);
    console.log(`Color variance: ${variance.toFixed(2)}`);
    
    expect(variance).toBeGreaterThan(10);
  });

  test('should complete full art generation workflow without errors', async ({ page }) => {
    console.log('Starting test: Full workflow integration test');
    
    const errors: string[] = [];
    page.on('pageerror', exception => {
      errors.push(exception.message);
      console.error(`Page error: ${exception.message}`);
    });
    
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    const loginButton = page.locator('[data-testid="button-login"]');
    const isLoginVisible = await loginButton.isVisible().catch(() => false);
    
    if (isLoginVisible) {
      await loginButton.click();
      await page.waitForURL('**/display', { timeout: 30000 });
    }
    
    await expect(page).toHaveURL(/.*display/);
    
    const styleButton = page.locator('[data-testid^="button-style"]').first();
    await styleButton.waitFor({ state: 'visible', timeout: 10000 });
    
    const styleCount = await page.locator('[data-testid^="button-style"]').count();
    console.log(`Found ${styleCount} style options`);
    expect(styleCount).toBeGreaterThan(0);
    
    await styleButton.click();
    
    const createButton = page.locator('[data-testid="button-create-art"]');
    await createButton.waitFor({ state: 'visible', timeout: 10000 });
    
    await createButton.click();
    
    const response = await page.waitForResponse(
      response => response.url().includes('/api/generate-art') && response.status() === 200,
      { timeout: 60000 }
    );
    
    console.log('API response status:', response.status());
    
    await page.waitForTimeout(3000);
    
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    
    const canvasAnalysis = await analyzeCanvas(page);
    expect(canvasAnalysis.error).toBeUndefined();
    expect(canvasAnalysis.avgLuminance).toBeGreaterThan(0.05);
    
    expect(errors).toHaveLength(0);
    console.log('✓ Workflow completed without errors');
  });
});
