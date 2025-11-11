import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { sql } from "drizzle-orm";

export async function bootstrapDatabase() {
  // Skip bootstrap if no database configured (MemStorage mode, local CI, etc.)
  if (!process.env.DATABASE_URL) {
    console.log('[DB Bootstrap] Skipped - no DATABASE_URL configured (MemStorage mode)');
    return;
  }
  
  console.log('[DB Bootstrap] Running database initialization...');
  
  // Configure WebSocket for Neon serverless (same as storage.ts)
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  
  try {
    // Create GIN index on art_sessions.styles for fast catalogue search
    // Drizzle doesn't support custom index types in schema, so we create it here
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS art_sessions_styles_gin_idx 
      ON art_sessions USING gin (styles)
    `);
    
    console.log('[DB Bootstrap] ✓ GIN index on styles created/verified');
    
    // Future: Add more bootstrap operations here (extensions, functions, etc.)
    
  } catch (error) {
    console.error('[DB Bootstrap] Failed to initialize database:', error);
    throw error;
  } finally {
    // Critical: Close the pool to prevent connection leaks
    await pool.end();
  }
}
