/**
 * OpenCV.js Dynamic Loader
 * Loads OpenCV.js on demand and ensures it's available globally
 */

let cvPromise: Promise<any> | null = null;
let cvLoaded = false;

export async function loadOpenCV(): Promise<any> {
  // Return existing promise if already loading
  if (cvPromise) {
    return cvPromise;
  }

  // Return immediately if already loaded
  if (cvLoaded && typeof (window as any).cv !== 'undefined') {
    return (window as any).cv;
  }

  cvPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if (typeof (window as any).cv !== 'undefined' && (window as any).cv.Mat) {
      cvLoaded = true;
      resolve((window as any).cv);
      return;
    }

    console.log('[OpenCV] Loading OpenCV.js from CDN...');

    // Create script tag - using stable 4.5.2 version (4.x redirects, 4.11.0 returns 404)
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.5.2/opencv.js';
    script.async = true;

    // Handle successful load
    script.onload = () => {
      console.log('[OpenCV] Script loaded, waiting for cv object...');
      
      // OpenCV.js needs a moment to initialize after script loads
      const checkCV = setInterval(() => {
        if (typeof (window as any).cv !== 'undefined' && (window as any).cv.Mat) {
          clearInterval(checkCV);
          cvLoaded = true;
          console.log('[OpenCV] ✅ OpenCV.js ready! Version:', (window as any).cv.getBuildInformation?.() || 'unknown');
          resolve((window as any).cv);
        }
      }, 100);

      // Timeout after 10 seconds (reduced from 30s for faster failure feedback)
      setTimeout(() => {
        clearInterval(checkCV);
        if (!cvLoaded) {
          const errorMsg = `OpenCV.js script loaded but cv object never initialized. URL: ${script.src}`;
          console.error('[OpenCV] ❌', errorMsg);
          console.error('[OpenCV] window.cv type:', typeof (window as any).cv);
          console.error('[OpenCV] Possible causes: CDN returned HTML error page, CORS blocked, incompatible build');
          reject(new Error(errorMsg));
        }
      }, 10000);
    };

    // Handle error
    script.onerror = (error) => {
      const errorMsg = `Failed to load OpenCV.js script from ${script.src}`;
      console.error('[OpenCV] ❌ Network error:', errorMsg, error);
      console.error('[OpenCV] Check: 1) CDN accessible, 2) No CORS issues, 3) URL returns JS not HTML');
      reject(new Error(errorMsg));
    };

    // Add to document
    document.head.appendChild(script);
  });

  return cvPromise;
}

export function isOpenCVLoaded(): boolean {
  return cvLoaded && typeof (window as any).cv !== 'undefined';
}

export function getOpenCV(): any {
  if (!isOpenCVLoaded()) {
    throw new Error('OpenCV.js not loaded. Call loadOpenCV() first.');
  }
  return (window as any).cv;
}
