import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { bootstrapDatabase } from "./db-bootstrap";
import { applySecurity } from "./security";
import { jsonBodyLimit, urlEncodedLimit } from "./security-middleware";
import { getGenerationQueue } from "./services/job-queue";
import { DatabaseJobStore } from "./services/db-job-store";

const app = express();

// Global server reference for cleanup
let httpServer: any = null;
let isShuttingDown = false;

// Apply security middleware BEFORE body parsing and other middleware
// This ensures CORS, helmet, and rate limiting are applied first
applySecurity(app);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

// Configure body parsers with size limits for security
app.use(express.json({
  limit: jsonBodyLimit, // 10mb limit from security-middleware
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: false, 
  limit: urlEncodedLimit // 10mb limit from security-middleware
}));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    
    // Track metrics with health monitor (excluding health check endpoints themselves)
    if (!path.startsWith("/api/health") && !path.startsWith("/api/ready") && 
        !path.startsWith("/api/live") && !path.startsWith("/api/metrics")) {
      try {
        const { getHealthMonitor } = require('./health-monitor');
        const healthMonitor = getHealthMonitor();
        const isError = res.statusCode >= 400;
        healthMonitor.trackRequest(isError, duration);
      } catch (e) {
        // Health monitor may not be initialized yet
      }
    }
    
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n[Server] Received ${signal}, starting graceful shutdown...`);
  
  // Mark health monitor as shutting down
  try {
    const { getHealthMonitor } = require('./health-monitor');
    const healthMonitor = getHealthMonitor();
    healthMonitor.setShuttingDown(true);
  } catch (e) {
    // Health monitor may not be initialized
  }
  
  // Stop accepting new connections
  if (httpServer) {
    httpServer.close(() => {
      console.log('[Server] HTTP server closed');
    });
  }
  
  // Give services 10 seconds to clean up
  setTimeout(() => {
    console.log('[Server] Forcing shutdown after 10 seconds');
    process.exit(1);
  }, 10000);
  
  try {
    // Import bootstrap services for cleanup
    const { queueService, recoveryManager, poolMonitor } = await import('./bootstrap');
    
    // Stop queue worker
    if (queueService) {
      console.log('[Server] Stopping queue worker...');
      await queueService.stopWorker();
    }
    
    // Stop recovery manager
    if (recoveryManager) {
      console.log('[Server] Stopping recovery manager...');
      recoveryManager.stopMonitoring();
    }
    
    // Stop pool monitor
    if (poolMonitor) {
      console.log('[Server] Stopping pool monitor...');
      poolMonitor.stopMonitoring();
    }
    
    // Stop health monitor metrics collection
    try {
      const { getHealthMonitor } = require('./health-monitor');
      const healthMonitor = getHealthMonitor();
      console.log('[Server] Stopping health monitor...');
      healthMonitor.stopMetricsCollection();
    } catch (e) {
      // Health monitor may not be initialized
    }
    
    console.log('[Server] Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('[Server] Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Port conflict detection with retry logic
async function startServerWithRetry(server: any, port: number, host: string, retryCount = 0): Promise<void> {
  const MAX_RETRIES = process.env.SERVER_SUPERVISOR === 'true' ? 1 : 0;
  
  return new Promise((resolve, reject) => {
    const errorHandler = (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server] ❌ Port ${port} is already in use!`);
        console.error(`[Server] Recovery instructions:`);
        console.error(`  1. Find process: lsof -i :${port}`);
        console.error(`  2. Kill process: kill -9 <PID>`);
        console.error(`  3. Or use a different port: PORT=5001 npm run dev`);
        
        // Emit telemetry event for port conflict
        try {
          const { telemetryService } = require('./telemetry-service');
          telemetryService.recordEvent({
            event: 'server.port_conflict',
            category: 'infrastructure',
            severity: 'error',
            metrics: {
              port,
              retry_count: retryCount
            }
          });
        } catch (e) {
          // Telemetry service may not be available
        }
        
        if (retryCount < MAX_RETRIES) {
          console.log(`[Server] Retrying in 2 seconds... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          setTimeout(() => {
            server.removeListener('error', errorHandler);
            startServerWithRetry(server, port, host, retryCount + 1)
              .then(resolve)
              .catch(reject);
          }, 2000);
        } else {
          reject(new Error(`Port ${port} is in use and all retry attempts failed`));
        }
      } else {
        reject(err);
      }
    };
    
    server.once('error', errorHandler);
    
    server.listen({
      port,
      host,
      reusePort: true,
    }, () => {
      server.removeListener('error', errorHandler);
      log(`✅ Server started successfully on port ${port}`);
      resolve();
    });
  });
}

(async () => {
  try {
    // Bootstrap database (create indexes, extensions, etc.)
    await bootstrapDatabase();
    
    const server = await registerRoutes(app);
    httpServer = server;

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ message });
      throw err;
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Other ports are firewalled. Default to 5000 if not specified.
    // this serves both the API and the client.
    // It is the only port that is not firewalled.
    const port = parseInt(process.env.PORT || '5000', 10);
    const host = "0.0.0.0";
    
    // Start server with port conflict detection
    await startServerWithRetry(server, port, host);
    
    // Register shutdown handlers
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });
    
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
})();
