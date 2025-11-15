// Load environment variables from .env file (must be first)
import 'dotenv/config';

import { queueService } from '../bootstrap';

async function main() {
  console.log('[Worker] Worker process started. Polling the job queue...');
  await queueService.startWorker();
}

main();

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`[Worker] Received ${signal}, shutting down worker...`);
  try {
    if (queueService && typeof queueService.stopWorker === 'function') {
      await queueService.stopWorker();
      console.log('[Worker] Worker stopped gracefully.');
    }
  } catch (err) {
    console.error('[Worker] Error during shutdown:', err);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
