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

    // Create script tag
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.11.0/opencv.js';
    script.async = true;

    // Handle successful load
    script.onload = () => {
      console.log('[OpenCV] Script loaded, waiting for cv object...');
      
      // OpenCV.js needs a moment to initialize after script loads
      const checkCV = setInterval(() => {
        if (typeof (window as any).cv !== 'undefined' && (window as any).cv.Mat) {
          clearInterval(checkCV);
          cvLoaded = true;
          console.log('[OpenCV] OpenCV.js ready!');
          resolve((window as any).cv);
        }
      }, 100);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkCV);
        if (!cvLoaded) {
          console.error('[OpenCV] Timeout waiting for cv object');
          reject(new Error('OpenCV.js initialization timeout'));
        }
      }, 30000);
    };

    // Handle error
    script.onerror = (error) => {
      console.error('[OpenCV] Failed to load script:', error);
      reject(new Error('Failed to load OpenCV.js script'));
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
