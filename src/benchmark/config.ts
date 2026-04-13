// Benchmark

import type { PredicateConfig } from '../shared/types.js';

/** Sample sizes to iterate through. */
export const SAMPLE_SIZES = [100000, 50000, 10000];

/** The predicate under test. */
export const PREDICATE: PredicateConfig = {
  ageThreshold: 18,
  targetLocation: 'SE',
};

/** PRNG seed for data generation (deterministic). */
export const SEED = 12345;

/** PostgreSQL connection string. */
export const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://bench:bench123@localhost:5432/benchmark';

/** Output CSV */
export const CSV_OUTPUT = process.env.CSV_OUTPUT || 'results/results.csv';

/** Whether to run ZK benchmarks (requires compiled circuits). */
export const ENABLE_ZKP = process.env.ENABLE_ZKP !== 'false';

/** Progress logging interval (log every N users). */
export const LOG_INTERVAL = 100;

/** Number of throwaway warmup iterations to stabilize JIT before measurement. */
export const WARMUP_ITERATIONS = 500;
