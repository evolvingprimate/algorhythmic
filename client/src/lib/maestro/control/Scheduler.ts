import type { Command } from "@shared/maestroTypes";
import { CommandBus } from "./CommandBus";

/**
 * Scheduler - Frame-aligned command dispatcher
 * 
 * Features:
 *   - Runs on requestAnimationFrame
 *   - Per-frame budget (2ms) to avoid frame drops
 *   - Dequeues commands from CommandBus
 *   - Delegates execution to MorphEngine/RendererManager
 * 
 * Design:
 *   - Budget-aware: skips commands if time budget exceeded
 *   - Diagnostic logging for performance tracking
 *   - Graceful degradation under load
 */
export class Scheduler {
  private commandBus: CommandBus;
  private isRunning = false;
  private rafId: number | null = null;
  private onCommandBatch: ((commands: Command[]) => void) | null = null;
  
  // Performance tracking
  private readonly FRAME_BUDGET_MS = 2; // 2ms per frame for command dispatch
  private readonly MAX_COMMANDS_PER_FRAME = 10; // Safety limit
  private frameCount = 0;
  private totalCommandsDispatched = 0;
  private totalTimeSpentMs = 0;
  private budgetExceededCount = 0;
  private lastStatsLog = 0;
  private readonly STATS_LOG_INTERVAL = 10000; // Log every 10 seconds
  
  constructor(commandBus: CommandBus) {
    this.commandBus = commandBus;
    console.log("[Scheduler] Initialized with budget:", this.FRAME_BUDGET_MS, "ms/frame");
  }

  /**
   * Start scheduler loop
   */
  start(onCommandBatch: (commands: Command[]) => void): void {
    if (this.isRunning) {
      console.warn("[Scheduler] Already running");
      return;
    }
    
    this.isRunning = true;
    this.onCommandBatch = onCommandBatch;
    this.frameCount = 0;
    this.totalCommandsDispatched = 0;
    this.totalTimeSpentMs = 0;
    this.budgetExceededCount = 0;
    this.lastStatsLog = performance.now();
    
    console.log("[Scheduler] Started");
    this.tick(performance.now());
  }

  /**
   * Stop scheduler loop
   */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    
    this.isRunning = false;
    this.onCommandBatch = null;
    
    console.log("[Scheduler] Stopped");
    this.logStats();
  }

  /**
   * Main scheduler tick (runs on RAF)
   */
  private tick = (timestamp: DOMHighResTimeStamp): void => {
    if (!this.isRunning) return;
    
    const frameStartTime = performance.now();
    this.frameCount++;
    
    // Dequeue commands within budget
    const commands: Command[] = [];
    let commandCount = 0;
    
    while (commandCount < this.MAX_COMMANDS_PER_FRAME && !this.commandBus.isEmpty()) {
      // Check budget before dequeuing (total tick duration)
      const currentTime = performance.now();
      const elapsed = currentTime - frameStartTime;
      
      if (elapsed >= this.FRAME_BUDGET_MS) {
        this.budgetExceededCount++;
        break;
      }
      
      // Dequeue one command
      const batch = this.commandBus.dequeue(1);
      if (batch.length > 0) {
        commands.push(batch[0]);
        commandCount++;
      } else {
        break;
      }
    }
    
    // Dispatch commands
    if (commands.length > 0 && this.onCommandBatch) {
      this.onCommandBatch(commands);
      
      this.totalCommandsDispatched += commands.length;
    }
    
    // Track total tick duration (including dequeue + dispatch)
    const totalTickTime = performance.now() - frameStartTime;
    this.totalTimeSpentMs += totalTickTime;
    
    // Check if we exceeded budget after dispatch
    if (totalTickTime >= this.FRAME_BUDGET_MS && commands.length > 0) {
      this.budgetExceededCount++;
    }
    
    // Log stats periodically
    const now = performance.now();
    if (now - this.lastStatsLog >= this.STATS_LOG_INTERVAL) {
      this.logStats();
      this.lastStatsLog = now;
    }
    
    // Schedule next tick
    this.rafId = requestAnimationFrame(this.tick);
  };

  /**
   * Log diagnostic stats
   */
  private logStats(): void {
    if (this.frameCount === 0) return;
    
    const avgCommandsPerFrame = this.totalCommandsDispatched / this.frameCount;
    const avgTimePerFrame = this.totalTimeSpentMs / this.frameCount;
    const budgetExceededPercent = (this.budgetExceededCount / this.frameCount) * 100;
    
    console.log(
      `[Scheduler] Stats: ` +
      `${this.totalCommandsDispatched} commands over ${this.frameCount} frames, ` +
      `avg ${avgCommandsPerFrame.toFixed(2)} cmds/frame, ` +
      `avg ${avgTimePerFrame.toFixed(3)}ms/frame, ` +
      `budget exceeded ${budgetExceededPercent.toFixed(1)}% of frames`
    );
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      frameCount: this.frameCount,
      totalCommandsDispatched: this.totalCommandsDispatched,
      avgCommandsPerFrame: this.frameCount > 0 ? this.totalCommandsDispatched / this.frameCount : 0,
      avgTimePerFrame: this.frameCount > 0 ? this.totalTimeSpentMs / this.frameCount : 0,
      budgetExceededCount: this.budgetExceededCount,
      budgetExceededPercent: this.frameCount > 0 ? (this.budgetExceededCount / this.frameCount) * 100 : 0,
      frameBudgetMs: this.FRAME_BUDGET_MS,
    };
  }
}
