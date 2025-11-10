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

    // BUG FIX: Set up Module object with onRuntimeInitialized callback
    // OpenCV.js requires this to signal when WASM is ready
    (window as any).Module = {
      onRuntimeInitialized: () => {
        console.log('[OpenCV] ✅ WASM runtime initialized, cv object ready');
        cvLoaded = true;
        if (typeof (window as any).cv !== 'undefined' && (window as any).cv.Mat) {
          console.log('[OpenCV] ✅ OpenCV.js ready! Version:', (window as any).cv.getBuildInformation?.() || '4.5.2');
          resolve((window as any).cv);
        } else {
          reject(new Error('OpenCV Module initialized but cv object not found'));
        }
      }
    };

    // Create script tag - load from local public/opencv/opencv.js (version 4.5.2)
    const script = document.createElement('script');
    script.src = '/opencv/opencv.js';
    script.async = true;

    let timeoutId: number | null = null;

    // Handle successful script load
    script.onload = () => {
      console.log('[OpenCV] Script loaded, waiting for WASM initialization...');
      
      // BUG FIX: Reduced timeout from 30s to 2s so UI doesn't hang
      // If WASM doesn't initialize in 2s, we proceed with crossfade rendering
      timeoutId = window.setTimeout(() => {
        if (!cvLoaded) {
          const errorMsg = `OpenCV.js WASM runtime never initialized after 2s. Module callback didn't fire.`;
          console.warn('[OpenCV] ⚠️', errorMsg, '- proceeding with crossfade fallback');
          console.warn('[OpenCV] window.cv type:', typeof (window as any).cv);
          console.warn('[OpenCV] window.Module:', typeof (window as any).Module);
          console.warn('[OpenCV] Resetting loader state - future calls will retry');
          
          // Remove failed script to prevent conflicts
          if (script.parentNode) {
            script.parentNode.removeChild(script);
          }
          
          // Reset all global state for clean retry
          cvPromise = null;
          cvLoaded = false;
          delete (window as any).Module;
          if (typeof (window as any).cv !== 'undefined') {
            delete (window as any).cv;
          }
          
          reject(new Error(errorMsg));
        } else {
          // Clear timeout if callback already fired
          if (timeoutId !== null) clearTimeout(timeoutId);
        }
      }, 2000); // Changed from 30000 to 2000
    };

    // Handle error
    script.onerror = (error) => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      const errorMsg = `Failed to load OpenCV.js from local server: ${script.src}`;
      console.error('[OpenCV] ❌ Network error:', errorMsg, error);
      console.error('[OpenCV] Check: 1) File exists at public/opencv/opencv.js, 2) Server serving static files correctly');
      console.warn('[OpenCV] Resetting loader state - future calls will retry');
      
      // Remove failed script to prevent conflicts
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
      
      // Reset all global state for clean retry
      cvPromise = null;
      cvLoaded = false;
      delete (window as any).Module;
      if (typeof (window as any).cv !== 'undefined') {
        delete (window as any).cv;
      }
      
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
