# Playwright E2E Test Infrastructure

This directory contains comprehensive end-to-end tests for the Algorhythmic app to verify the entire pipeline from login to image rendering.

## Setup

### 1. Install Playwright

Run the following command to install @playwright/test as a dev dependency:

```bash
npm install --save-dev @playwright/test
```

### 2. Install Playwright Browsers

After installing @playwright/test, install the required browsers:

```bash
npx playwright install chromium
```

### 3. Add Test Script

Add the following script to your `package.json` scripts section:

```json
"test:e2e": "playwright test"
```

## Running Tests

### Run all tests
```bash
npm run test:e2e
```

### Run tests in headed mode (see the browser)
```bash
npx playwright test --headed
```

### Run tests in debug mode
```bash
npx playwright test --debug
```

### Run a specific test file
```bash
npx playwright test tests/e2e/art-generation.test.ts
```

### View test report
```bash
npx playwright show-report
```

## Test Structure

### Test Files

- **tests/e2e/art-generation.test.ts**: Main test suite covering the art generation pipeline
- **tests/helpers/canvas-analysis.ts**: Utility functions for canvas pixel analysis

### Test Coverage

1. **Frame A Brightness Test**: Verifies that the initial frame is rendered at full brightness (no black frames)
2. **Frame A Opacity Test**: Checks that Frame A opacity starts at 1.0
3. **Color Variation Test**: Ensures the canvas has proper color variation
4. **Full Workflow Integration Test**: End-to-end test of the complete art generation workflow

## Configuration

The `playwright.config.ts` file contains:

- Test directory: `./tests/e2e`
- Base URL: `http://localhost:5000` (configurable via BASE_URL env var)
- Web server auto-start: Runs `npm run dev` before tests
- Single worker for sequential test execution
- Chromium browser only (can be extended to Firefox and WebKit)
- Screenshots and videos on failure
- Trace on first retry

## Canvas Analysis Utilities

The `tests/helpers/canvas-analysis.ts` module provides:

### `analyzeCanvas(page: Page)`
Analyzes the canvas element and returns:
- `avgLuminance`: Average luminance (0-1)
- `blackPixelPercent`: Percentage of black pixels
- `width`, `height`: Canvas dimensions
- `pixelCount`: Total number of pixels

### `sampleCanvasPixels(page: Page, sampleSize: number)`
Samples pixels from the canvas for analysis.

### `calculateColorVariance(samples)`
Calculates color variance from pixel samples to verify proper rendering.

## Test Requirements

Tests verify:
- ✅ Canvas renders with minimum brightness (avgLuminance > 0.05)
- ✅ Less than 95% black pixels on canvas
- ✅ Canvas has reasonable dimensions (>100x100)
- ✅ Color variation indicates proper rendering
- ✅ No JavaScript errors during workflow
- ✅ Successful API responses from art generation endpoint

## Troubleshooting

### Tests timing out
- Increase timeout in `playwright.config.ts`
- Check if the dev server is running on port 5000
- Verify OpenAI and Spotify API keys are configured

### Canvas analysis returning errors
- Ensure the canvas element exists on the page
- Check browser console for WebGL errors
- Verify image textures are loading correctly

### Login issues
- Verify Replit authentication is configured
- Check that test data-testid attributes are present on UI elements
