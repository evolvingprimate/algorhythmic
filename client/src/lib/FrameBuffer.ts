/**
 * FrameBuffer with Priority Queues
 * 
 * Manages incoming frames with priority ordering:
 * 1. Fresh frames (newly generated, never seen)
 * 2. Style-matched frames (matching user preferences)
 * 3. Global frames (any available)
 * 4. Placeholder (last resort, never returns null)
 * 
 * Features:
 * - Priority queue management
 * - Placeholder guard to prevent black frames
 * - Music context tracking for stale frame detection
 * - Memory-efficient queue trimming
 */

import { PLACEHOLDER_IMAGE_URL } from './PlaceholderFrame';

export interface BufferedFrame {
  id: string;
  imageUrl: string;
  timestamp: Date;
  priority: 'fresh' | 'style' | 'global';
  sequenceId: number;
  musicContext?: {
    track: string;
    artist: string;
    isStale: boolean;
  };
  prompt?: string;
  explanation?: string;
}

export class FrameBuffer {
  // Priority queues
  private freshQueue: BufferedFrame[] = [];
  private styleQueue: BufferedFrame[] = [];
  private globalQueue: BufferedFrame[] = [];
  
  // Configuration
  private readonly MAX_QUEUE_SIZE = 10;
  private readonly MIN_BUFFER_SIZE = 2;
  
  // Placeholder guard
  private placeholderFrame: BufferedFrame;
  
  // Frame request callback
  private onNeedMoreFrames?: () => void;
  
  // Statistics
  private stats = {
    totalEnqueued: 0,
    totalDequeued: 0,
    placeholderUsed: 0,
    staleFramesRemoved: 0,
  };
  
  constructor(onNeedMoreFrames?: () => void) {
    this.onNeedMoreFrames = onNeedMoreFrames;
    
    // Initialize placeholder frame
    this.placeholderFrame = {
      id: 'placeholder',
      imageUrl: PLACEHOLDER_IMAGE_URL,
      timestamp: new Date(),
      priority: 'global',
      sequenceId: -1,
      prompt: 'Loading artwork...',
      explanation: 'Preparing your visual experience',
    };
    
    console.log('[FrameBuffer] Initialized with placeholder guard');
  }
  
  /**
   * Enqueue a frame into the appropriate priority queue
   */
  enqueue(frame: BufferedFrame): void {
    this.stats.totalEnqueued++;
    
    // Select the appropriate queue based on priority
    let queue: BufferedFrame[];
    let queueName: string;
    
    switch (frame.priority) {
      case 'fresh':
        queue = this.freshQueue;
        queueName = 'fresh';
        break;
      case 'style':
        queue = this.styleQueue;
        queueName = 'style';
        break;
      case 'global':
      default:
        queue = this.globalQueue;
        queueName = 'global';
        break;
    }
    
    // Add frame to queue
    queue.push(frame);
    
    // Sort by sequence ID (newer frames have higher sequence IDs)
    queue.sort((a, b) => a.sequenceId - b.sequenceId);
    
    // Trim queue if it exceeds max size
    if (queue.length > this.MAX_QUEUE_SIZE) {
      const removed = queue.shift(); // Remove oldest
      console.log(`[FrameBuffer] Trimmed oldest frame from ${queueName} queue (seq: ${removed?.sequenceId})`);
    }
    
    console.log(`[FrameBuffer] Enqueued frame to ${queueName} queue (seq: ${frame.sequenceId}, total: ${this.getBufferSize()})`);
  }
  
  /**
   * Dequeue next frame based on priority (never returns null)
   */
  dequeue(): BufferedFrame {
    this.stats.totalDequeued++;
    
    const frame = this.selectNextFrame();
    
    if (!frame) {
      // Return placeholder as last resort
      this.stats.placeholderUsed++;
      console.warn('[FrameBuffer] Using placeholder - all queues empty');
      
      // Request more frames urgently
      this.requestMoreFrames(true);
      
      return this.placeholderFrame;
    }
    
    // Request more frames if buffer getting low
    if (this.needsMoreFrames()) {
      this.requestMoreFrames();
    }
    
    console.log(`[FrameBuffer] Dequeued frame (priority: ${frame.priority}, seq: ${frame.sequenceId}, remaining: ${this.getBufferSize()})`);
    
    return frame;
  }
  
  /**
   * Peek at next frame without removing it
   */
  peek(): BufferedFrame | null {
    // Check fresh queue first
    if (this.freshQueue.length > 0) {
      return this.freshQueue[0];
    }
    
    // Then style queue
    if (this.styleQueue.length > 0) {
      return this.styleQueue[0];
    }
    
    // Finally global queue
    if (this.globalQueue.length > 0) {
      return this.globalQueue[0];
    }
    
    // Return null if all queues empty (peek doesn't use placeholder)
    return null;
  }
  
  /**
   * Get total buffer size across all queues
   */
  getBufferSize(): number {
    return this.freshQueue.length + this.styleQueue.length + this.globalQueue.length;
  }
  
  /**
   * Check if we need more frames
   */
  needsMoreFrames(): boolean {
    const totalFrames = this.getBufferSize();
    return totalFrames < this.MIN_BUFFER_SIZE;
  }
  
  /**
   * Check if placeholder is currently being used
   */
  hasPlaceholderActive(): boolean {
    return this.getBufferSize() === 0;
  }
  
  /**
   * Mark frames as stale when music changes
   */
  markStaleFrames(currentTrack: string): void {
    let staleCount = 0;
    
    [this.freshQueue, this.styleQueue, this.globalQueue].forEach(queue => {
      queue.forEach(frame => {
        if (frame.musicContext && frame.musicContext.track !== currentTrack) {
          frame.musicContext.isStale = true;
          staleCount++;
        }
      });
    });
    
    if (staleCount > 0) {
      console.log(`[FrameBuffer] Marked ${staleCount} frames as stale (music changed to: ${currentTrack})`);
    }
  }
  
  /**
   * Clear stale frames while maintaining minimum buffer
   */
  clearStaleFrames(): void {
    // Only clear if we have more than minimum buffer
    if (this.getBufferSize() <= this.MIN_BUFFER_SIZE) {
      console.log('[FrameBuffer] Keeping stale frames to maintain minimum buffer');
      return;
    }
    
    let removedCount = 0;
    
    // Remove stale frames from each queue
    const filterStale = (queue: BufferedFrame[]): BufferedFrame[] => {
      const original = queue.length;
      const filtered = queue.filter(f => !f.musicContext?.isStale);
      removedCount += original - filtered.length;
      return filtered;
    };
    
    this.freshQueue = filterStale(this.freshQueue);
    this.styleQueue = filterStale(this.styleQueue);
    this.globalQueue = filterStale(this.globalQueue);
    
    this.stats.staleFramesRemoved += removedCount;
    
    if (removedCount > 0) {
      console.log(`[FrameBuffer] Removed ${removedCount} stale frames (remaining: ${this.getBufferSize()})`);
      
      // Request more frames if we're now low
      if (this.needsMoreFrames()) {
        this.requestMoreFrames();
      }
    }
  }
  
  /**
   * Get buffer statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentBufferSize: this.getBufferSize(),
      freshQueueSize: this.freshQueue.length,
      styleQueueSize: this.styleQueue.length,
      globalQueueSize: this.globalQueue.length,
    };
  }
  
  /**
   * Clear all queues (useful for reset scenarios)
   */
  clear(): void {
    this.freshQueue = [];
    this.styleQueue = [];
    this.globalQueue = [];
    console.log('[FrameBuffer] All queues cleared');
  }
  
  /**
   * Select next frame based on priority ordering
   */
  private selectNextFrame(): BufferedFrame | null {
    // Priority 1: Fresh frames (newly generated)
    if (this.freshQueue.length > 0) {
      return this.freshQueue.shift()!;
    }
    
    // Priority 2: Style-matched frames
    if (this.styleQueue.length > 0) {
      return this.styleQueue.shift()!;
    }
    
    // Priority 3: Global frames
    if (this.globalQueue.length > 0) {
      return this.globalQueue.shift()!;
    }
    
    // No frames available
    return null;
  }
  
  /**
   * Request more frames from server
   */
  private requestMoreFrames(urgent: boolean = false): void {
    if (this.onNeedMoreFrames) {
      console.log(`[FrameBuffer] Requesting more frames (urgent: ${urgent}, current buffer: ${this.getBufferSize()})`);
      this.onNeedMoreFrames();
    }
  }
  
  /**
   * Trim all queues to max size (memory management)
   */
  private trimQueues(): void {
    const trimQueue = (queue: BufferedFrame[], name: string) => {
      while (queue.length > this.MAX_QUEUE_SIZE) {
        const removed = queue.shift();
        console.log(`[FrameBuffer] Trimmed frame from ${name} queue (seq: ${removed?.sequenceId})`);
      }
    };
    
    trimQueue(this.freshQueue, 'fresh');
    trimQueue(this.styleQueue, 'style');
    trimQueue(this.globalQueue, 'global');
  }
  
  /**
   * Debug: Get queue status summary
   */
  getQueueStatus(): string {
    const fresh = this.freshQueue.map(f => f.sequenceId).join(',');
    const style = this.styleQueue.map(f => f.sequenceId).join(',');
    const global = this.globalQueue.map(f => f.sequenceId).join(',');
    
    return `Fresh[${this.freshQueue.length}]: ${fresh || 'empty'} | ` +
           `Style[${this.styleQueue.length}]: ${style || 'empty'} | ` +
           `Global[${this.globalQueue.length}]: ${global || 'empty'}`;
  }
}