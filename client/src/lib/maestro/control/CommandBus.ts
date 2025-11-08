import type { Command } from "@shared/maestroTypes";

/**
 * CommandBus - Bounded priority queue for Maestro commands
 * 
 * Features:
 *   - Fixed capacity (120 commands) with back-pressure warnings
 *   - Priority-based ordering
 *   - Frame-aligned dequeue via Scheduler
 *   - Overflow protection with diagnostic logging
 * 
 * Command priorities (higher = more urgent):
 *   - PulseEvent: 100 (immediate visual responses)
 *   - SetParam: 50 (instant parameter changes)
 *   - RampParam: 40 (smooth transitions)
 *   - ScheduleCue: 30 (future-scheduled events)
 */
export class CommandBus {
  private queue: Array<{ command: Command; priority: number; enqueuedAt: number }> = [];
  private readonly MAX_CAPACITY = 120;
  private overflowCount = 0;
  private lastOverflowWarning = 0;
  private readonly OVERFLOW_WARNING_INTERVAL = 5000; // Warn every 5 seconds max
  
  constructor() {
    console.log("[CommandBus] Initialized with capacity:", this.MAX_CAPACITY);
  }

  /**
   * Enqueue a command with priority
   */
  enqueue(command: Command, customPriority?: number): boolean {
    const priority = customPriority ?? this.getCommandPriority(command);
    const now = performance.now();
    
    // Check capacity
    if (this.queue.length >= this.MAX_CAPACITY) {
      this.overflowCount++;
      
      // Log warning with rate limiting
      if (now - this.lastOverflowWarning > this.OVERFLOW_WARNING_INTERVAL) {
        console.warn(
          `[CommandBus] Back-pressure detected: queue at capacity (${this.MAX_CAPACITY}). ` +
          `${this.overflowCount} commands dropped since last warning.`
        );
        this.lastOverflowWarning = now;
        this.overflowCount = 0;
      }
      
      return false;
    }
    
    // Add to queue
    this.queue.push({
      command,
      priority,
      enqueuedAt: now,
    });
    
    // Sort by priority (descending)
    this.queue.sort((a, b) => b.priority - a.priority);
    
    return true;
  }

  /**
   * Dequeue up to N commands (called by Scheduler)
   */
  dequeue(maxCount: number): Command[] {
    const commands: Command[] = [];
    
    for (let i = 0; i < maxCount && this.queue.length > 0; i++) {
      const item = this.queue.shift();
      if (item) {
        commands.push(item.command);
      }
    }
    
    return commands;
  }

  /**
   * Peek at the next N commands without removing them
   */
  peek(maxCount: number): Command[] {
    return this.queue.slice(0, maxCount).map(item => item.command);
  }

  /**
   * Clear all commands
   */
  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    console.log(`[CommandBus] Cleared ${count} commands`);
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Get queue capacity
   */
  capacity(): number {
    return this.MAX_CAPACITY;
  }

  /**
   * Check if queue is full
   */
  isFull(): boolean {
    return this.queue.length >= this.MAX_CAPACITY;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get queue utilization (0-1)
   */
  utilization(): number {
    return this.queue.length / this.MAX_CAPACITY;
  }

  /**
   * Determine command priority based on kind
   */
  private getCommandPriority(command: Command): number {
    switch (command.kind) {
      case "PULSE":
        return 100; // Highest - immediate visual response to beats
      case "SET":
        return 50; // High - instant parameter changes
      case "RAMP":
        return 40; // Medium - smooth transitions
      case "SCHEDULE":
        return 30; // Lower - future-scheduled events
      default:
        return 0;
    }
  }

  /**
   * Get diagnostic stats
   */
  getStats() {
    return {
      size: this.queue.length,
      capacity: this.MAX_CAPACITY,
      utilization: this.utilization(),
      isFull: this.isFull(),
      isEmpty: this.isEmpty(),
      overflowsSinceLastWarning: this.overflowCount,
    };
  }
}
