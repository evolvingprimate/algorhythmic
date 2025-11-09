/**
 * Global Effects Configuration
 * 
 * Shared across all pages (display, maestro, etc.)
 * Persisted in localStorage for consistent user experience
 */

const STORAGE_KEY = "global:particlesEnabled";

export const GlobalEffectsConfig = {
  /**
   * Check if particles are enabled globally
   */
  areParticlesEnabled(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        return stored === "true";
      }
    } catch (error) {
      console.warn("[GlobalEffectsConfig] Failed to read particles setting:", error);
    }
    
    // DEFAULT: Particles OFF for testing
    return false;
  },

  /**
   * Enable or disable particles globally
   */
  setParticlesEnabled(enabled: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
      console.log(`[GlobalEffectsConfig] Particles ${enabled ? "ENABLED" : "DISABLED"}`);
    } catch (error) {
      console.warn("[GlobalEffectsConfig] Failed to save particles setting:", error);
    }
  },
};
