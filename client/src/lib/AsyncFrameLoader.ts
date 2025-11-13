/**
 * AsyncFrameLoader - Handles asynchronous artwork fetching with polling
 * 
 * This class implements a non-blocking artwork fetching strategy:
 * 1. Returns immediately with cached artworks if available
 * 2. Returns a jobId for polling if generation needed
 * 3. Implements exponential backoff polling
 * 4. Falls back to library artworks on failure
 * 
 * Designed to prevent HTTP timeouts by never blocking more than 2 seconds
 */

import { clientTelemetry } from './client-telemetry';

export interface AsyncFrameResponse {
  type: 'immediate' | 'queued';
  artworks?: any[];
  jobId?: string;
  estimatedTime?: number;
  source?: string;
  message?: string;
}

export interface JobStatusResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  artworks?: any[];
  source?: string;
  error?: string;
  message?: string;
}

export class AsyncFrameLoader {
  private activeJobs = new Map<string, AbortController>();
  private pollingIntervals = [2000, 4000, 8000]; // Exponential backoff, capped at 8s
  private maxPollAttempts = 5; // Reduced to ~20s total max
  private globalTimeout = 20000; // 20 seconds max for entire async operation
  
  constructor() {
    console.log('[AsyncFrameLoader] Initialized with 20s global timeout');
  }
  
  /**
   * Fetch artworks asynchronously - returns immediately
   */
  async fetchArtworks(
    sessionId: string,
    signal?: AbortSignal,
    params?: {
      styles?: string[];
      artists?: string[];
      orientation?: string;
    }
  ): Promise<any[]> {
    try {
      // Build query parameters
      const queryParams = new URLSearchParams({
        sessionId,
        limit: '3', // Reduced for faster response
      });
      
      if (params?.styles) {
        queryParams.append('styles', JSON.stringify(params.styles));
      }
      if (params?.artists) {
        queryParams.append('artists', JSON.stringify(params.artists));
      }
      if (params?.orientation) {
        queryParams.append('orientation', params.orientation);
      }
      
      // Call async endpoint - should return immediately
      const response = await fetch(`/api/artworks/next/async?${queryParams}`, {
        credentials: 'include',
        signal,
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch artworks: ${response.status}`);
      }
      
      const data: AsyncFrameResponse = await response.json();
      console.log(`[AsyncFrameLoader] Initial response type: ${data.type}`);
      
      if (data.type === 'immediate' && data.artworks) {
        // Got cached artworks immediately - return even if partial
        console.log(`[AsyncFrameLoader] Got immediate artworks: ${data.artworks.length}`);
        
        // Return whatever we have, even if it's less than ideal
        if (data.artworks.length > 0) {
          console.log(`[AsyncFrameLoader] Returning ${data.artworks.length} cached artworks`);
          return data.artworks;
        }
      }
      
      if (data.type === 'queued' && data.jobId) {
        // Need to poll for results - with global timeout
        console.log(`[AsyncFrameLoader] Job queued: ${data.jobId}, starting poll with ${this.globalTimeout}ms timeout`);
        
        // Set up global timeout
        const timeoutPromise = new Promise<any[]>((_, reject) => {
          setTimeout(() => reject(new Error('Global timeout exceeded')), this.globalTimeout);
        });
        
        // Race between polling and timeout
        try {
          return await Promise.race([
            this.pollForResults(data.jobId, signal),
            timeoutPromise
          ]);
        } catch (error: any) {
          console.warn(`[AsyncFrameLoader] Polling failed: ${error.message}, returning empty fallback`);
          // Return empty array to trigger FrameBuffer's placeholder
          return [];
        }
      }
      
      // Unexpected response format - still return empty array (will trigger placeholder)
      console.warn('[AsyncFrameLoader] Unexpected response format:', data);
      return [];
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[AsyncFrameLoader] Fetch aborted');
      } else {
        console.error('[AsyncFrameLoader] Fetch error:', error);
      }
      throw error;
    }
  }
  
  /**
   * Poll for job completion with exponential backoff
   */
  private async pollForResults(
    jobId: string,
    signal?: AbortSignal
  ): Promise<any[]> {
    const startTime = Date.now();
    let pollAttempt = 0;
    
    // Create abort controller for this polling session
    const pollController = new AbortController();
    this.activeJobs.set(jobId, pollController);
    
    // Link to parent signal if provided
    if (signal) {
      signal.addEventListener('abort', () => {
        pollController.abort();
      });
    }
    
    try {
      while (pollAttempt < this.maxPollAttempts) {
        // Check if polling was aborted
        if (pollController.signal.aborted) {
          throw new Error('Polling aborted');
        }
        
        // Wait before polling (skip wait on first attempt)
        if (pollAttempt > 0) {
          const delay = this.pollingIntervals[Math.min(pollAttempt - 1, this.pollingIntervals.length - 1)];
          console.log(`[AsyncFrameLoader] Waiting ${delay}ms before poll attempt ${pollAttempt + 1}`);
          await this.delay(delay, pollController.signal);
        }
        
        // Poll for job status
        const statusResponse = await fetch(`/api/artworks/job/${jobId}`, {
          credentials: 'include',
          signal: pollController.signal,
        });
        
        if (!statusResponse.ok) {
          if (statusResponse.status === 404) {
            throw new Error('Job not found');
          }
          throw new Error(`Poll failed: ${statusResponse.status}`);
        }
        
        const status: JobStatusResponse = await statusResponse.json();
        console.log(`[AsyncFrameLoader] Poll ${pollAttempt + 1}: ${status.status}`);
        
        if (status.status === 'completed' && status.artworks) {
          const duration = Date.now() - startTime;
          console.log(`[AsyncFrameLoader] Job completed in ${duration}ms after ${pollAttempt + 1} attempts`);
          
          this.activeJobs.delete(jobId);
          return status.artworks;
        }
        
        if (status.status === 'failed') {
          console.warn(`[AsyncFrameLoader] Job failed: ${status.error}`);
          
          // Always try to return fallback artworks on failure
          if (status.artworks && status.artworks.length > 0) {
            // Got fallback artworks - return them
            
            console.log(`[AsyncFrameLoader] Returning ${status.artworks.length} fallback artworks`);
            this.activeJobs.delete(jobId);
            return status.artworks;
          }
          
          // No fallback available - return empty array to trigger placeholder
          console.warn('[AsyncFrameLoader] No fallback artworks available, returning empty');
          this.activeJobs.delete(jobId);
          return [];
        }
        
        pollAttempt++;
      }
      
      // Max attempts reached
      const duration = Date.now() - startTime;
      console.error(`[AsyncFrameLoader] Max poll attempts reached after ${duration}ms (${pollAttempt} attempts)`);
      
      throw new Error('Generation timeout - max poll attempts reached');
      
    } finally {
      this.activeJobs.delete(jobId);
    }
  }
  
  /**
   * Cancel all active polling jobs
   */
  cancelAll(): void {
    console.log(`[AsyncFrameLoader] Cancelling ${this.activeJobs.size} active jobs`);
    
    this.activeJobs.forEach((controller, jobId) => {
      controller.abort();
    });
    
    this.activeJobs.clear();
  }
  
  /**
   * Cancel specific job
   */
  cancelJob(jobId: string): void {
    const controller = this.activeJobs.get(jobId);
    if (controller) {
      console.log(`[AsyncFrameLoader] Cancelling job ${jobId}`);
      controller.abort();
      this.activeJobs.delete(jobId);
    }
  }
  
  /**
   * Delay helper with abort support
   */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Delay aborted'));
        });
      }
    });
  }
  
  /**
   * Get number of active polling jobs
   */
  getActiveJobCount(): number {
    return this.activeJobs.size;
  }
}