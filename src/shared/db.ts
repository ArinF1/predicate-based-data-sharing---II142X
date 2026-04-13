// PostgreSQL Database — Results Storage & CSV Export

import pg from 'pg';
import { writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import type { BenchmarkResult } from './types.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/** Get or create the PostgreSQL connection pool. */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ||
      'postgres://bench:bench123@localhost:5432/benchmark';
    pool = new Pool({ connectionString });
  }
  return pool;
}

// Initialize the database
export async function initDB(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS benchmark_results (
      id              SERIAL PRIMARY KEY,
      system          VARCHAR(10) NOT NULL,
      sample_size     INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      latency_ns      BIGINT NOT NULL,
      cpu_time_ms     DOUBLE PRECISION NOT NULL,
      payload_bytes   INTEGER NOT NULL,
      verified        BOOLEAN NOT NULL,
      predicate_result BOOLEAN NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[DB] benchmark_results table ready');
}

/** Log a single benchmark result to PostgreSQL. */
export async function logResult(result: BenchmarkResult): Promise<void> {
  const p = getPool();
  await p.query(
    `INSERT INTO benchmark_results
       (system, sample_size, user_id, latency_ns, cpu_time_ms, payload_bytes, verified, predicate_result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      result.system,
      result.sample_size,
      result.user_id,
      result.latency_ns.toString(),
      result.cpu_time_ms,
      result.payload_bytes,
      result.verified,
      result.predicate_result,
    ]
  );
}

/**
 * Batch-insert multiple benchmark results.
 * Chunks inserts to avoid PostgreSQL's 65535 parameter limit.
 */
export async function logResults(results: BenchmarkResult[]): Promise<void> {
  if (results.length === 0) return;

  const p = getPool();
  const BATCH_SIZE = 500;

  for (let start = 0; start < results.length; start += BATCH_SIZE) {
    const batch = results.slice(start, start + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];
      const offset = i * 8;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`
      );
      values.push(
        r.system,
        r.sample_size,
        r.user_id,
        r.latency_ns.toString(),
        r.cpu_time_ms,
        r.payload_bytes,
        r.verified,
        r.predicate_result
      );
    }

    await p.query(
      `INSERT INTO benchmark_results
         (system, sample_size, user_id, latency_ns, cpu_time_ms, payload_bytes, verified, predicate_result)
       VALUES ${placeholders.join(', ')}`,
      values
    );
  }
}

/** Export all benchmark results to a CSV file. */
export async function exportCSV(filepath: string): Promise<void> {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT system, sample_size, user_id, latency_ns, cpu_time_ms,
            payload_bytes, verified, predicate_result, created_at
     FROM benchmark_results
     ORDER BY system, sample_size, user_id`
  );

  const header =
    'system,sample_size,user_id,latency_ns,cpu_time_ms,payload_bytes,verified,predicate_result,created_at';
  const lines = rows.map(
    (r: Record<string, unknown>) =>
      `${r.system},${r.sample_size},${r.user_id},${r.latency_ns},${r.cpu_time_ms},${r.payload_bytes},${r.verified},${r.predicate_result},${r.created_at}`
  );

  const dir = filepath.substring(0, filepath.lastIndexOf('/'));
  if (dir) mkdirSync(dir, { recursive: true });

  writeFileSync(filepath, [header, ...lines].join('\n'), 'utf8');
  console.log(`[DB] Exported ${rows.length} rows to ${filepath}`);
}

/** Clear all previous benchmark results from the database. */
export async function clearResults(): Promise<void> {
  const p = getPool();
  await p.query('TRUNCATE TABLE benchmark_results');
  console.log('[DB] Cleared all previous benchmark results');
}

/** Close the database pool. */
export async function closeDB(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
