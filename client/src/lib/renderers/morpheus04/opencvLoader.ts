/**
 * OpenCV.js Dynamic Loader
 * Loads OpenCV.js from local server (public/opencv/opencv.js)
 * Uses non-blocking async pattern to prevent browser freezes
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

    console.log('[OpenCV] Loading OpenCV.js from local server...');

    // Create script tag - load from local public/opencv/opencv.js (version 4.5.2)
    const script = document.createElement('script');
    script.src = '/opencv/opencv.js';
    script.async = true;

    let timeoutId: number | null = null;
    let rafId: number | null = null;

    // Cleanup function
    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    // Non-blocking check using requestAnimationFrame
    const checkCV = () => {
      if (typeof (window as any).cv !== 'undefined' && (window as any).cv.Mat) {
        cleanup();
        cvLoaded = true;
        console.log('[OpenCV] ✅ OpenCV.js ready! Version:', (window as any).cv.getBuildInformation?.() || '4.5.2');
        resolve((window as any).cv);
      } else {
        // Schedule next check without blocking
        rafId = requestAnimationFrame(checkCV);
      }
    };

    // Handle successful script load
    script.onload = () => {
      console.log('[OpenCV] Script loaded, waiting for cv object...');
      
      // Start non-blocking check loop
      rafId = requestAnimationFrame(checkCV);

      // Timeout after 10 seconds with proper cleanup
      timeoutId = window.setTimeout(() => {
        cleanup();
        if (!cvLoaded) {
          const errorMsg = `OpenCV.js script loaded but cv object never initialized after 10s. Local path: ${script.src}`;
          console.error('[OpenCV] ❌', errorMsg);
          console.error('[OpenCV] window.cv type:', typeof (window as any).cv);
          console.error('[OpenCV] Check: 1) File exists at public/opencv/opencv.js, 2) File is valid JS, 3) No console errors above');
          reject(new Error(errorMsg));
        }
      }, 10000);
    };

    // Handle error
    script.onerror = (error) => {
      cleanup();
      const errorMsg = `Failed to load OpenCV.js from local server: ${script.src}`;
      console.error('[OpenCV] ❌ Network error:', errorMsg, error);
      console.error('[OpenCV] Check: 1) File exists at public/opencv/opencv.js, 2) Server serving static files correctly');
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
