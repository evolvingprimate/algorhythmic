import { useRef, useCallback, useEffect } from 'react';
import { apiRequest, queryClient } from '@/lib/queryClient';

interface UseImpressionRecorderOptions {
  maxBatchSize?: number;
  flushDelayMs?: number;
  sessionId?: string; // For cache invalidation
  onFlush?: () => void; // Called after successful flush
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
  const { maxBatchSize = 200, flushDelayMs = 2000, sessionId, onFlush } = options;
  
  // Queue of pending impression IDs
  const queueRef = useRef<Set<string>>(new Set());
  
  // IDs that have been successfully recorded
  const recordedRef = useRef<Set<string>>(new Set());
  
  // Flush timer
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // In-flight request
  const isFlushingRef = useRef(false);
  
  // ⭐ NEW: Client telemetry metrics (Phase 2)
  const metricsRef = useRef({ 
    flushSuccess: 0, 
    flushFail: 0,
    totalFlushed: 0 
  });
  
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
            
            // ⭐ NEW: Track telemetry metrics
            metricsRef.current.flushSuccess++;
            metricsRef.current.totalFlushed += chunk.length;
            
            // ⭐ NEW: Sampled logging (10% for success)
            if (Math.random() < 0.1) {
              console.log(`[Metrics] client_batch_flush_success=${metricsRef.current.flushSuccess} total=${metricsRef.current.totalFlushed} chunk=${chunk.length}`);
            }
          } else {
            // ⭐ NEW: Track failures (always log)
            metricsRef.current.flushFail++;
            const { flushSuccess, flushFail } = metricsRef.current;
            const rate = flushSuccess ? (flushFail / flushSuccess).toFixed(3) : "n/a";
            console.error(`[ImpressionRecorder] ❌ Batch failed (${res.status}), will retry. Failure rate: ${rate}`);
            // Keep in queue for retry
          }
        } catch (error) {
          // ⭐ NEW: Track failures (always log)
          metricsRef.current.flushFail++;
          const { flushSuccess, flushFail } = metricsRef.current;
          const rate = flushSuccess ? (flushFail / flushSuccess).toFixed(3) : "n/a";
          console.error(`[ImpressionRecorder] ❌ Network error, will retry. Failure rate: ${rate}`, error);
          // Keep in queue for retry
        }
      }
      
      // ⭐ OPTIMIZED: Single cache invalidation after all chunks (not per chunk)
      if (anyChunkSucceeded && sessionId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/artworks/next", sessionId, undefined],  // Use undefined as wildcard for third segment
          refetchType: "active",
        });
      }
      
      // ⭐ BUG FIX: Call onFlush callback after successful flush
      if (anyChunkSucceeded && onFlush) {
        onFlush();
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
    // ⭐ NEW: Debounce timer for visibility-change (prevents Safari/Firefox double-fire)
    let visTimer: number | null = null;
    
    // Flush on visibility change (tab switch) with debounce
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      
      if (visTimer) clearTimeout(visTimer);
      visTimer = window.setTimeout(() => flush(true), 100); // 100ms debounce
    };
    
    // Flush on beforeunload (tab close)
    const handleBeforeUnload = () => {
      // Use sendBeacon as last resort
      if (queueRef.current.size > 0) {
        const idsToSend = Array.from(queueRef.current);
        const payload = JSON.stringify({ artworkIds: idsToSend });
        
        // ⭐ NEW: Measure actual byte size (not string length)
        const payloadBytes = new TextEncoder().encode(payload).byteLength;
        
        // Try sendBeacon first (non-blocking, max 64KB)
        let beaconSent = false;
        if (navigator.sendBeacon && payloadBytes <= 64 * 1024) {
          const blob = new Blob([payload], { type: 'application/json' });
          beaconSent = navigator.sendBeacon('/api/artworks/batch-impressions', blob);
          
          if (beaconSent) {
            console.log(`[ImpressionRecorder] 📡 Sent ${idsToSend.length} impressions via beacon`);
          }
        }
        
        // ⭐ NEW: Fallback to fetch keepalive for large payloads or beacon failure
        if (!beaconSent) {
          try {
            fetch('/api/artworks/batch-impressions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payload,
              keepalive: true, // Allows request to outlive page
              credentials: 'include',
            });
            console.log(`[ImpressionRecorder] 🚀 Sent ${idsToSend.length} impressions via fetch keepalive`);
          } catch (error) {
            console.error(`[ImpressionRecorder] ❌ Keepalive fetch failed:`, error);
            // Final fallback: synchronous flush (blocks unload briefly)
            flush(true);
          }
        }
      }
    };
    
    // ⭐ NEW: pagehide event for iOS reliability
    const handlePageHide = () => flush(true);
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide, { once: true });
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      
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
    hasRecorded: (id: string) => recordedRef.current.has(id),
  };
}
