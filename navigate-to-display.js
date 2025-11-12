const { chromium } = require('@playwright/test');

(async () => {
  // Connect to existing browser instance
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  
  // Get the existing page
  const contexts = browser.contexts();
  if (contexts.length > 0) {
    const pages = await contexts[0].pages();
    if (pages.length > 0) {
      const page = pages[0];
      
      // Navigate directly to display page
      console.log('Navigating to /display page...');
      await page.goto('http://localhost:5000/display');
      
      // Wait for the canvas to appear
      console.log('Waiting for canvas element...');
      await page.waitForTimeout(3000);
      
      // Check if canvas exists
      const canvasExists = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (canvas) {
          console.log('[Test] Canvas found:', canvas.width, 'x', canvas.height);
          return true;
        }
        console.log('[Test] Canvas NOT found');
        return false;
      });
      
      console.log('Canvas exists:', canvasExists);
      
      // Keep the page open
      console.log('Display page loaded. Keeping browser open...');
    }
  }
})().catch(err => {
  console.error('Error:', err);
});