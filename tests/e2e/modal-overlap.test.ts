import { test, expect, Page } from '@playwright/test';

test.describe('Wizard Modal Overlap Prevention', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    // Create a new page for each test
    page = await browser.newPage();
    
    // Navigate to the display page
    await page.goto('/display');
    
    // Wait for the app to load
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('should never show StyleSelector and AudioSourceSelector simultaneously', async () => {
    // Initial state - should show welcome screen
    await expect(page.locator('[data-testid="button-start-creating"]')).toBeVisible();
    
    // Click "Start Creating" to open StyleSelector
    await page.click('[data-testid="button-start-creating"]');
    
    // StyleSelector should be visible
    await expect(page.locator('[data-testid="style-selector-card"]')).toBeVisible();
    
    // AudioSourceSelector should NOT be visible
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    
    // Select a style and confirm
    await page.click('[data-testid="style-item-abstract"]');
    await page.click('[data-testid="button-save-selection"]');
    
    // Wait a moment for transition
    await page.waitForTimeout(100);
    
    // Now AudioSourceSelector should be visible
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // StyleSelector should NOT be visible anymore
    await expect(page.locator('[data-testid="style-selector-card"]')).not.toBeVisible();
    
    // Verify only ONE modal is in the DOM at this point
    const dialogCount = await page.locator('[role="dialog"]').count();
    expect(dialogCount).toBe(1);
  });

  test('should handle back navigation without overlap', async () => {
    // Navigate to audio selection step
    await page.click('[data-testid="button-start-creating"]');
    await page.click('[data-testid="style-item-abstract"]');
    await page.click('[data-testid="button-save-selection"]');
    
    // AudioSourceSelector should be visible
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // Click Cancel to go back to style selection
    await page.click('[data-testid="button-cancel"]');
    
    // Wait a moment for transition
    await page.waitForTimeout(100);
    
    // StyleSelector should be visible again
    await expect(page.locator('[data-testid="style-selector-card"]')).toBeVisible();
    
    // AudioSourceSelector should NOT be visible
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    
    // Verify no overlapping modals
    const dialogCount = await page.locator('[role="dialog"]').count();
    expect(dialogCount).toBe(0); // No dialogs since StyleSelector is a Card
  });

  test('should handle rapid forward/back navigation without overlap', async () => {
    // Start wizard flow
    await page.click('[data-testid="button-start-creating"]');
    
    // Rapid navigation: forward, back, forward, back
    for (let i = 0; i < 3; i++) {
      // Select style and go forward
      await page.click('[data-testid="style-item-abstract"]');
      await page.click('[data-testid="button-save-selection"]');
      
      // Immediately go back
      await page.click('[data-testid="button-cancel"]');
    }
    
    // Final state should be StyleSelector visible
    await expect(page.locator('[data-testid="style-selector-card"]')).toBeVisible();
    
    // No dialogs should be visible
    const dialogCount = await page.locator('[role="dialog"]').count();
    expect(dialogCount).toBe(0);
  });

  test('should handle cancel from style selection properly', async () => {
    // Open style selector
    await page.click('[data-testid="button-start-creating"]');
    
    // StyleSelector should be visible
    await expect(page.locator('[data-testid="style-selector-card"]')).toBeVisible();
    
    // Cancel style selection
    await page.click('[data-testid="button-close-style-selector"]');
    
    // Wait a moment for transition
    await page.waitForTimeout(100);
    
    // Should return to welcome screen
    await expect(page.locator('[data-testid="button-start-creating"]')).toBeVisible();
    
    // No modals should be visible
    await expect(page.locator('[data-testid="style-selector-card"]')).not.toBeVisible();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('should never have more than one modal portal in DOM', async () => {
    // Navigate through the entire wizard flow multiple times
    for (let i = 0; i < 2; i++) {
      // Start wizard
      await page.click('[data-testid="button-start-creating"]');
      
      // Check portal count
      let portalCount = await page.locator('[data-radix-portal]').count();
      expect(portalCount).toBeLessThanOrEqual(1);
      
      // Select style
      await page.click('[data-testid="style-item-abstract"]');
      await page.click('[data-testid="button-save-selection"]');
      
      // Check portal count again
      portalCount = await page.locator('[data-radix-portal]').count();
      expect(portalCount).toBeLessThanOrEqual(1);
      
      // Confirm audio selection
      await page.click('[data-testid="no-audio-option"]');
      await page.click('[data-testid="button-confirm"]');
      
      // Check portal count after completion
      portalCount = await page.locator('[data-radix-portal]').count();
      expect(portalCount).toBe(0);
    }
  });
});