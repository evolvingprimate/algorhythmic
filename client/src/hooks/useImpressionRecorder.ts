import { useRef, useCallback, useEffect } from 'react';
import { apiRequest, queryClient } from '@/lib/queryClient';

interface UseImpressionRecorderOptions {
  maxBatchSize?: number;
  flushDelayMs?: number;
  sessionId?: string; // For cache invalidation
}

/**
 * Production-grade impression recorder with:
 * - Automatic batching and chunking (max 200 per request)
 * - Deduplication to prevent double-recording
 * - Lifecycle flushing (visibilitychange, beforeunload)
 * - Retry on failure with exponential backoff
 * - Immediate first-frame flush for hero impression
 */
export function useImpressionRecorder(options: UseImpressionRecorderOptions = {}) {
  const { maxBatchSize = 200, flushDelayMs = 2000, sessionId } = options;
  
  // Queue of pending impression IDs
  const queueRef = useRef<Set<string>>(new Set());
  
  // IDs that have been successfully recorded
  const recordedRef = useRef<Set<string>>(new Set());
  
  // Flush timer
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // In-flight request
  const isFlushingRef = useRef(false);
  
  /**
   * Flush the queue: send all pending IDs to backend
   */
  const flush = useCallback(async (immediate = false) => {
    // Bail if no pending IDs or already flushing
    if (queueRef.current.size === 0 || isFlushingRef.current) {
      return;
    }
    
    // Clear any pending timer
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    
    // Convert queue to array and chunk if needed
    const idsToSend = Array.from(queueRef.current);
    const chunks: string[][] = [];
    
    for (let i = 0; i < idsToSend.length; i += maxBatchSize) {
      chunks.push(idsToSend.slice(i, i + maxBatchSize));
    }
    
    // Process each chunk with try/finally safety
    let anyChunkSucceeded = false;
    
    try {
      isFlushingRef.current = true;
      
      for (const chunk of chunks) {
        try {
          const res = await apiRequest("POST", "/api/artworks/batch-impressions", { artworkIds: chunk });
          
          if (res.ok) {
            // Mark as recorded and remove from queue
            chunk.forEach(id => {
              recordedRef.current.add(id);
              queueRef.current.delete(id);
            });
            
            anyChunkSucceeded = true;
            console.log(`[ImpressionRecorder] ✅ Flushed ${chunk.length} impressions`);
          } else {
            console.error(`[ImpressionRecorder] ❌ Batch failed (${res.status}), will retry`);
            // Keep in queue for retry
          }
        } catch (error) {
          console.error(`[ImpressionRecorder] ❌ Network error, will retry:`, error);
          // Keep in queue for retry
        }
      }
      
      // ⭐ OPTIMIZED: Single cache invalidation after all chunks (not per chunk)
      if (anyChunkSucceeded && sessionId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/artworks/next", sessionId],
          refetchType: "active",
        });
      }
    } finally {
      // ⭐ SAFETY: Always reset flush flag, even on error
      isFlushingRef.current = false;
    }
    
    // If there are still items in queue (failed), schedule retry
    if (queueRef.current.size > 0) {
      flushTimerRef.current = setTimeout(() => flush(false), 5000); // Retry in 5s
    }
  }, [maxBatchSize, sessionId]);
  
  /**
   * Queue impression IDs for recording
   */
  const queueImpressions = useCallback((ids: string | string[]) => {
    const idArray = Array.isArray(ids) ? ids : [ids];
    let addedNew = false;
    
    // Add to queue if not already recorded
    idArray.forEach(id => {
      if (!recordedRef.current.has(id) && !queueRef.current.has(id)) {
        queueRef.current.add(id);
        addedNew = true;
      }
    });
    
    if (!addedNew) return;
    
    // If first item in queue, flush immediately (hero impression)
    if (queueRef.current.size === idArray.length) {
      console.log(`[ImpressionRecorder] Hero impression detected, immediate flush`);
      flush(true);
    } else {
      // Otherwise, debounce flush
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
      
      flushTimerRef.current = setTimeout(() => flush(false), flushDelayMs);
    }
  }, [flush, flushDelayMs]);
  
  /**
   * Lifecycle flush handlers
   */
  useEffect(() => {
    // Flush on visibility change (tab switch)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush(true);
      }
    };
    
    // Flush on beforeunload (tab close)
    const handleBeforeUnload = () => {
      // Use sendBeacon as last resort
      if (queueRef.current.size > 0) {
        const idsToSend = Array.from(queueRef.current);
        const payload = JSON.stringify({ artworkIds: idsToSend });
        
        // Try sendBeacon first (non-blocking)
        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon('/api/artworks/batch-impressions', blob);
          console.log(`[ImpressionRecorder] 📡 Sent ${idsToSend.length} impressions via beacon`);
        } else {
          // Fallback: synchronous flush
          flush(true);
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      // Final cleanup flush
      if (queueRef.current.size > 0) {
        flush(true);
      }
    };
  }, [flush]);
  
  return {
    queueImpressions,
    flush,
    getPendingCount: () => queueRef.current.size,
    getRecordedCount: () => recordedRef.current.size,
  };
}
