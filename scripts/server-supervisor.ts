#!/usr/bin/env tsx
/**
 * Server Supervisor Script
 * 
 * Lightweight Node.js supervisor that monitors the server process and 
 * automatically restarts it on crashes with throttling to prevent crash loops.
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';

interface RestartRecord {
  timestamp: number;
  reason: string;
}

class ServerSupervisor {
  private serverProcess: ChildProcess | null = null;
  private restartHistory: RestartRecord[] = [];
  private isShuttingDown = false;
  private restartInProgress = false;
  
  // Configuration
  private readonly MAX_RESTARTS = 5;
  private readonly RESTART_WINDOW = 5 * 60 * 1000; // 5 minutes in ms
  private readonly RESTART_DELAY = 2000; // 2 seconds
  private readonly SERVER_SCRIPT = resolve(__dirname, '../server/index.ts');
  
  constructor() {
    console.log('[Supervisor] Starting server supervisor...');
    console.log(`[Supervisor] Server script: ${this.SERVER_SCRIPT}`);
    console.log(`[Supervisor] Max restarts: ${this.MAX_RESTARTS} in ${this.RESTART_WINDOW / 1000}s window`);
  }
  
  /**
   * Start the supervisor
   */
  async start(): Promise<void> {
    // Handle process signals
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    
    // Start the server
    await this.startServer('initial');
  }
  
  /**
   * Check if we've exceeded restart throttling limits
   */
  private isThrottled(): boolean {
    const now = Date.now();
    
    // Remove old restart records outside the window
    this.restartHistory = this.restartHistory.filter(
      record => (now - record.timestamp) < this.RESTART_WINDOW
    );
    
    // Check if we've exceeded the limit
    if (this.restartHistory.length >= this.MAX_RESTARTS) {
      console.error(`[Supervisor] ❌ FATAL: Server crashed ${this.MAX_RESTARTS} times in ${this.RESTART_WINDOW / 1000} seconds`);
      console.error('[Supervisor] Refusing to restart. Manual intervention required.');
      console.error('[Supervisor] Recent crashes:');
      this.restartHistory.forEach((record, index) => {
        const time = new Date(record.timestamp).toISOString();
        console.error(`  ${index + 1}. ${time} - ${record.reason}`);
      });
      return true;
    }
    
    return false;
  }
  
  /**
   * Start or restart the server process
   */
  private async startServer(reason: string): Promise<void> {
    if (this.restartInProgress) {
      console.log('[Supervisor] Restart already in progress, skipping...');
      return;
    }
    
    this.restartInProgress = true;
    
    // Record restart
    if (reason !== 'initial') {
      this.restartHistory.push({ timestamp: Date.now(), reason });
      console.log(`[Supervisor] Restart attempt ${this.restartHistory.length}/${this.MAX_RESTARTS}`);
      
      // Check throttling
      if (this.isThrottled()) {
        process.exit(1);
      }
      
      // Wait before restarting
      console.log(`[Supervisor] Waiting ${this.RESTART_DELAY}ms before restart...`);
      await new Promise(resolve => setTimeout(resolve, this.RESTART_DELAY));
    }
    
    // Set environment variable to indicate supervisor is active
    const env = {
      ...process.env,
      SERVER_SUPERVISOR: 'true',
      NODE_ENV: process.env.NODE_ENV || 'development',
    };
    
    console.log(`[Supervisor] Starting server... (reason: ${reason})`);
    
    // Spawn the server process
    this.serverProcess = spawn('tsx', [this.SERVER_SCRIPT], {
      env,
      stdio: 'inherit', // Forward all output to parent process
      shell: false,
    });
    
    const pid = this.serverProcess.pid;
    console.log(`[Supervisor] ✅ Server started with PID: ${pid}`);
    
    // Handle server exit
    this.serverProcess.on('exit', (code, signal) => {
      this.serverProcess = null;
      this.restartInProgress = false;
      
      if (this.isShuttingDown) {
        console.log(`[Supervisor] Server exited during shutdown (code: ${code}, signal: ${signal})`);
        return;
      }
      
      const exitReason = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`[Supervisor] ⚠️ Server exited unexpectedly: ${exitReason}`);
      
      // Log structured event
      const event = {
        type: 'server_crash',
        pid,
        code,
        signal,
        timestamp: new Date().toISOString(),
        restarts: this.restartHistory.length,
      };
      console.log('[Supervisor] Event:', JSON.stringify(event));
      
      // Attempt restart
      this.startServer(exitReason);
    });
    
    // Handle server errors
    this.serverProcess.on('error', (error) => {
      console.error('[Supervisor] Failed to start server:', error);
      this.serverProcess = null;
      this.restartInProgress = false;
      
      if (!this.isShuttingDown) {
        this.startServer(`error: ${error.message}`);
      }
    });
    
    this.restartInProgress = false;
  }
  
  /**
   * Gracefully shutdown the supervisor and server
   */
  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    
    console.log(`\n[Supervisor] Received ${signal}, shutting down...`);
    this.isShuttingDown = true;
    
    if (this.serverProcess) {
      console.log('[Supervisor] Stopping server process...');
      
      // Send SIGTERM to server for graceful shutdown
      this.serverProcess.kill('SIGTERM');
      
      // Give server 15 seconds to shutdown gracefully
      const timeout = setTimeout(() => {
        if (this.serverProcess) {
          console.log('[Supervisor] Force killing server process...');
          this.serverProcess.kill('SIGKILL');
        }
      }, 15000);
      
      // Wait for server to exit
      await new Promise<void>((resolve) => {
        if (!this.serverProcess) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        
        this.serverProcess.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    
    console.log('[Supervisor] Shutdown complete');
    process.exit(0);
  }
}

// Start the supervisor
const supervisor = new ServerSupervisor();
supervisor.start().catch((error) => {
  console.error('[Supervisor] Fatal error:', error);
  process.exit(1);
});