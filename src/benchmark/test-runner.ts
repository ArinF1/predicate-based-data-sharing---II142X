// Benchmark Test Runner
// Iterates through sample sizes and executes all three verification systems,
// measuring latency, CPU time, and payload size.
//
// Usage:
//   npx tsx src/benchmark/test-runner.ts
//   npx tsx src/benchmark/test-runner.ts --sample-sizes 100,1000
//   npx tsx src/benchmark/test-runner.ts --no-zkp

import { Generator } from '../data-generator/generator.js';
import { NotaryA } from '../systems/system-a/notary.js';
import { SellerA } from '../systems/system-a/seller.js';
import { BuyerA } from '../systems/system-a/buyer.js';
import { NotaryB } from '../systems/system-b/notary.js';
import { SellerB } from '../systems/system-b/seller.js';
import { BuyerB } from '../systems/system-b/buyer.js';
import { NotaryC } from '../systems/system-c/notary.js';
import { SellerC } from '../systems/system-c/seller.js';
import { BuyerC } from '../systems/system-c/buyer.js';
import { measureExecution, measurePayloadBytes, formatNs } from '../shared/measurement.js';
import { initDB, logResults, exportCSV, closeDB, clearResults } from '../shared/db.js';
import { locationToInt } from '../shared/types.js';
import {
  SAMPLE_SIZES,
  PREDICATE,
  SEED,
  CSV_OUTPUT,
  WARMUP_ITERATIONS,
  ENABLE_ZKP,
  LOG_INTERVAL,
  ZK_PROOF_TIMEOUT_MS,
  DB_FLUSH_SIZE,
} from './config.js';
import type {
  BenchmarkResult,
  UserRecord,
  SystemType,
  PredicateCommitment,
  ZKSetupArtifacts,
} from '../shared/types.js';

// ── Utilities ────────────────────────────────────────────────────────────────

/** Running statistics — avoids holding all results in memory for summary. */
interface RunningStats {
  system: string;
  count: number;
  validCount: number;        // entries with latency > 0 (actual proofs)
  totalLatencyNs: bigint;
  totalCpuMs: number;
  totalPayloadBytes: number;
  provedCount: number;       // ZK proofs successfully generated
  timedOutCount: number;     // ZK proofs that timed out
  errorCount: number;        // ZK proofs that errored
}

function emptyStats(system: string): RunningStats {
  return {
    system,
    count: 0,
    validCount: 0,
    totalLatencyNs: 0n,
    totalCpuMs: 0,
    totalPayloadBytes: 0,
    provedCount: 0,
    timedOutCount: 0,
    errorCount: 0,
  };
}

/**
 * Timeout wrapper — rejects if the promise doesn't resolve within `ms` milliseconds.
 * Prevents deadlocks from snarkjs WASM hangs.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`TIMEOUT after ${ms}ms: ${label}`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Flush a buffer of results to the database and clear it.
 * Returns the number of flushed results.
 */
async function flushBuffer(
  buffer: BenchmarkResult[],
  label: string
): Promise<number> {
  if (buffer.length === 0) return 0;
  const count = buffer.length;
  await logResults([...buffer]);
  buffer.length = 0;
  console.log(`    [${label}] Flushed ${count} results to DB`);
  return count;
}

// ── CLI Argument Parsing ─────────────────────────────────────────────────────

function parseArgs(): { sampleSizes: number[]; enableZkp: boolean } {
  const args = process.argv.slice(2);
  let sampleSizes = SAMPLE_SIZES;
  let enableZkp = ENABLE_ZKP;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sample-sizes' && args[i + 1]) {
      sampleSizes = args[i + 1].split(',').map(Number);
      i++;
    }
    if (args[i] === '--no-zkp') {
      enableZkp = false;
    }
  }

  return { sampleSizes, enableZkp };
}

// ── System A Benchmark ───────────────────────────────────────────────────────

async function benchmarkSystemA(
  users: UserRecord[],
  sampleSize: number
): Promise<RunningStats> {
  console.log(`  [System A — Traditional] Processing ${users.length} users...`);

  const notary = new NotaryA();
  const seller = new SellerA();
  const buyer = new BuyerA(PREDICATE);

  notary.setup(users);

  const stats = emptyStats('A');
  const buffer: BenchmarkResult[] = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    const { result, latencyNs, cpuTimeMs } = await measureExecution(() => {
      const payload = seller.createPayload(user);
      const verification = buyer.verify(payload);
      return { payload, verification };
    });

    const payloadBytes = measurePayloadBytes(result.payload);

    buffer.push({
      system: 'A_RAW',
      sample_size: sampleSize,
      user_id: user.id,
      latency_ns: latencyNs,
      cpu_time_ms: cpuTimeMs,
      payload_bytes: payloadBytes,
      verified: result.verification.verified,
      predicate_result: result.verification.result,
      timestamp: new Date(),
    });

    stats.count++;
    stats.validCount++;
    stats.totalLatencyNs += latencyNs;
    stats.totalCpuMs += cpuTimeMs;
    stats.totalPayloadBytes += payloadBytes;

    // Incremental DB flush
    if (buffer.length >= DB_FLUSH_SIZE) {
      await flushBuffer(buffer, 'A');
    }

    if ((i + 1) % LOG_INTERVAL === 0) {
      console.log(`    [A] ${i + 1}/${users.length} — last: ${formatNs(latencyNs)}`);
    }
  }

  // Flush remaining
  await flushBuffer(buffer, 'A');

  return stats;
}

// ── System B Benchmark ───────────────────────────────────────────────────────

async function benchmarkSystemB(
  users: UserRecord[],
  sampleSize: number
): Promise<RunningStats> {
  console.log(`  [System B — Predicate-Based] Processing ${users.length} users...`);

  const notary = new NotaryB();
  const seller = new SellerB();
  const buyer = new BuyerB();

  console.log('    [B] Setup: building commitment...');
  const setupStart = process.hrtime.bigint();
  const commitment: PredicateCommitment = notary.setup(PREDICATE, 8);
  const setupTime = process.hrtime.bigint() - setupStart;
  console.log(`    [B] Setup complete in ${formatNs(setupTime)}`);

  const stats = emptyStats('B');
  const buffer: BenchmarkResult[] = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    const { result, latencyNs, cpuTimeMs } = await measureExecution(() => {
      const witness = seller.generateWitness(user, commitment, 8);
      const verification = buyer.verify(witness, commitment.rootHash);
      return { witness, verification };
    });

    const witnessPayload = {
      result: result.witness.result,
      pathAux: result.witness.pathAux.map(b => b.toString('hex')),
      pathKeys: result.witness.pathKeys.map(b => b.toString('hex')),
      pathBits: result.witness.pathBits,
      leafHash: result.witness.leafHash.toString('hex'),
    };
    const payloadBytes = measurePayloadBytes(witnessPayload);

    buffer.push({
      system: 'B_PRED',
      sample_size: sampleSize,
      user_id: user.id,
      latency_ns: latencyNs,
      cpu_time_ms: cpuTimeMs,
      payload_bytes: payloadBytes,
      verified: result.verification.verified,
      predicate_result: result.verification.result,
      timestamp: new Date(),
    });

    stats.count++;
    stats.validCount++;
    stats.totalLatencyNs += latencyNs;
    stats.totalCpuMs += cpuTimeMs;
    stats.totalPayloadBytes += payloadBytes;

    // Incremental DB flush
    if (buffer.length >= DB_FLUSH_SIZE) {
      await flushBuffer(buffer, 'B');
    }

    if ((i + 1) % LOG_INTERVAL === 0) {
      console.log(`    [B] ${i + 1}/${users.length} — last: ${formatNs(latencyNs)}`);
    }
  }

  // Flush remaining
  await flushBuffer(buffer, 'B');

  return stats;
}

// ── System C Benchmark (with timeout protection) ─────────────────────────────

async function benchmarkSystemC(
  users: UserRecord[],
  sampleSize: number
): Promise<RunningStats> {
  console.log(`  [System C — ZK] Processing ${users.length} users...`);
  console.log(`    [C] Proof timeout: ${ZK_PROOF_TIMEOUT_MS / 1000}s per user`);

  const notary = new NotaryC();
  const seller = new SellerC();
  const buyer = new BuyerC();

  let artifacts: ZKSetupArtifacts;
  try {
    console.log('    [C] Setup: loading circuit artifacts...');
    artifacts = notary.setup('combined_check');
    console.log('    [C] Setup complete.');
  } catch (err) {
    console.error(`    [C] ERROR: ${(err as Error).message}`);
    console.error('    [C] Skipping ZK benchmarks. Run build-circuits.sh first.');
    return emptyStats('C');
  }

  const stats = emptyStats('C');
  const buffer: BenchmarkResult[] = [];

  // Log interval for System C is shorter since each iteration is much slower
  const zkLogInterval = Math.max(1, Math.min(LOG_INTERVAL, 10));

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    const canProve =
      user.age >= PREDICATE.ageThreshold &&
      user.location === PREDICATE.targetLocation;

    if (!canProve) {
      buffer.push({
        system: 'C_ZKP',
        sample_size: sampleSize,
        user_id: user.id,
        latency_ns: 0n,
        cpu_time_ms: 0,
        payload_bytes: 0,
        verified: false,
        predicate_result: false,
        timestamp: new Date(),
      });
      stats.count++;

      // Incremental DB flush (even for skipped users)
      if (buffer.length >= DB_FLUSH_SIZE) {
        await flushBuffer(buffer, 'C');
      }

      // Periodic progress for skipped users (less frequent)
      if ((i + 1) % LOG_INTERVAL === 0) {
        console.log(`    [C] ${i + 1}/${users.length} — skipped (non-qualifying)`);
      }
      continue;
    }

    // ── ZK proof generation with timeout protection ──
    try {
      const proofStartTime = Date.now();
      console.log(`    [C] ${i + 1}/${users.length} — generating proof for user ${user.id} (age=${user.age}, loc=${user.location})...`);

      const { result, latencyNs, cpuTimeMs } = await measureExecution(async () => {
        // Wrap fullProve with timeout to prevent deadlock
        const zkProof = await withTimeout(
          seller.generateProof(user, artifacts, PREDICATE),
          ZK_PROOF_TIMEOUT_MS,
          `fullProve for user ${user.id}`
        );
        // Wrap verify with timeout as well
        const verification = await withTimeout(
          buyer.verify(zkProof, artifacts.vkeyJson),
          ZK_PROOF_TIMEOUT_MS,
          `verify for user ${user.id}`
        );
        return { zkProof, verification };
      });

      const payloadBytes = measurePayloadBytes(result.zkProof);

      buffer.push({
        system: 'C_ZKP',
        sample_size: sampleSize,
        user_id: user.id,
        latency_ns: latencyNs,
        cpu_time_ms: cpuTimeMs,
        payload_bytes: payloadBytes,
        verified: result.verification.verified,
        predicate_result: result.verification.result,
        timestamp: new Date(),
      });

      stats.count++;
      stats.validCount++;
      stats.totalLatencyNs += latencyNs;
      stats.totalCpuMs += cpuTimeMs;
      stats.totalPayloadBytes += payloadBytes;
      stats.provedCount++;

      const elapsed = Date.now() - proofStartTime;
      console.log(`    [C] ${i + 1}/${users.length} — proved in ${elapsed}ms (total proofs: ${stats.provedCount}, timeouts: ${stats.timedOutCount})`);

    } catch (err) {
      const errMsg = (err as Error).message;
      const isTimeout = errMsg.startsWith('TIMEOUT');

      if (isTimeout) {
        stats.timedOutCount++;
        console.warn(`    [C] ⚠ ${i + 1}/${users.length} — TIMEOUT for user ${user.id} after ${ZK_PROOF_TIMEOUT_MS / 1000}s (total timeouts: ${stats.timedOutCount})`);
      } else {
        stats.errorCount++;
        console.error(`    [C] ✗ ${i + 1}/${users.length} — ERROR for user ${user.id}: ${errMsg}`);
      }

      buffer.push({
        system: 'C_ZKP',
        sample_size: sampleSize,
        user_id: user.id,
        latency_ns: 0n,
        cpu_time_ms: 0,
        payload_bytes: 0,
        verified: false,
        predicate_result: false,
        timestamp: new Date(),
      });
      stats.count++;
    }

    // Incremental DB flush
    if (buffer.length >= DB_FLUSH_SIZE) {
      await flushBuffer(buffer, 'C');
    }
  }

  // Flush remaining
  await flushBuffer(buffer, 'C');

  console.log(`    [C] Final: ${stats.provedCount} proofs generated, ${stats.timedOutCount} timeouts, ${stats.errorCount} errors`);

  return stats;
}

// ── JIT Warmup ───────────────────────────────────────────────────────────────

async function warmup(enableZkp: boolean): Promise<void> {
  console.log(`[Warmup] Running ${WARMUP_ITERATIONS} throwaway iterations to stabilize JIT...`);
  const gen = new Generator(99999);
  const users = gen.generate(WARMUP_ITERATIONS);

  const sellerA = new SellerA();
  const buyerA = new BuyerA(PREDICATE);
  for (const user of users) {
    const payload = sellerA.createPayload(user);
    buyerA.verify(payload);
  }
  console.log('  [Warmup] System A done');

  const notaryB = new NotaryB();
  const sellerB = new SellerB();
  const buyerB = new BuyerB();
  const commitment = notaryB.setup(PREDICATE, 8);
  for (const user of users) {
    const witness = sellerB.generateWitness(user, commitment, 8);
    buyerB.verify(witness, commitment.rootHash);
  }
  console.log('  [Warmup] System B done');

  if (enableZkp) {
    const notaryC = new NotaryC();
    const sellerC = new SellerC();
    const buyerC = new BuyerC();
    try {
      const artifacts = notaryC.setup('combined_check');
      const qualifying = users.filter(
        u => u.age >= PREDICATE.ageThreshold && u.location === PREDICATE.targetLocation
      );
      for (const user of qualifying.slice(0, 3)) {
        const proof = await withTimeout(
          sellerC.generateProof(user, artifacts, PREDICATE),
          ZK_PROOF_TIMEOUT_MS,
          `warmup proof for user ${user.id}`
        );
        await withTimeout(
          buyerC.verify(proof, artifacts.vkeyJson),
          ZK_PROOF_TIMEOUT_MS,
          `warmup verify for user ${user.id}`
        );
      }
      console.log('  [Warmup] System C done');
    } catch (err) {
      console.log(`  [Warmup] System C skipped: ${(err as Error).message}`);
    }
  }

  console.log('[Warmup] Complete.\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { sampleSizes, enableZkp } = parseArgs();

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   Predicate-Based Data Sharing — Benchmark Runner   ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ Sample sizes: ${sampleSizes.join(', ').padEnd(38)}║`);
  console.log(`║ Predicate:    age >= ${PREDICATE.ageThreshold} AND location === '${PREDICATE.targetLocation}'${' '.repeat(10)}║`);
  console.log(`║ ZK enabled:   ${String(enableZkp).padEnd(38)}║`);
  console.log(`║ ZK timeout:   ${(ZK_PROOF_TIMEOUT_MS / 1000) + 's'.padEnd(37)}║`);
  console.log(`║ Seed:         ${String(SEED).padEnd(38)}║`);
  console.log(`║ DB flush:     every ${String(DB_FLUSH_SIZE) + ' results'.padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  console.log('[Init] Connecting to PostgreSQL...');
  await initDB();

  await clearResults();
  await warmup(enableZkp);

  const generator = new Generator(SEED);

  for (const size of sampleSizes) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  SAMPLE SIZE: ${size} users`);
    console.log(`${'='.repeat(60)}`);

    const users = generator.generate(size);
    const seCount = users.filter(u => u.location === 'SE').length;
    const passCount = users.filter(
      u => u.age >= PREDICATE.ageThreshold && u.location === PREDICATE.targetLocation
    ).length;
    console.log(
      `  Dataset: ${users.length} users, ` +
      `${seCount} in SE, ${passCount} satisfy full predicate`
    );

    // System A
    const statsA = await benchmarkSystemA(users, size);
    console.log(`  [A] Complete: ${statsA.count} results`);

    // System B
    const statsB = await benchmarkSystemB(users, size);
    console.log(`  [B] Complete: ${statsB.count} results`);

    // System C
    let statsC = emptyStats('C');
    if (enableZkp) {
      statsC = await benchmarkSystemC(users, size);
      console.log(`  [C] Complete: ${statsC.count} results (${statsC.provedCount} proofs, ${statsC.timedOutCount} timeouts)`);
    } else {
      console.log('  [C] ZK disabled, skipping.');
    }

    printSummary(size, statsA, statsB, statsC);
  }

  console.log(`\n[Export] Writing results to ${CSV_OUTPUT}...`);
  await exportCSV(CSV_OUTPUT);

  await closeDB();
  console.log('\n[Done] Benchmark complete.');
}

// ── Summary Printer ──────────────────────────────────────────────────────────

function printSummary(
  size: number,
  statsA: RunningStats,
  statsB: RunningStats,
  statsC: RunningStats
): void {
  const avgLat = (s: RunningStats) =>
    s.validCount > 0 ? formatNs(s.totalLatencyNs / BigInt(s.validCount)) : 'N/A';
  const avgCpu = (s: RunningStats) =>
    s.validCount > 0 ? (s.totalCpuMs / s.validCount).toFixed(2) : 'N/A';
  const avgPayload = (s: RunningStats) =>
    s.validCount > 0 ? (s.totalPayloadBytes / s.validCount).toFixed(2) : 'N/A';

  console.log(`\n  ┌─────────────────────────────────────────────────┐`);
  console.log(`  │ Summary for N=${size}`);
  console.log(`  ├──────────┬────────────┬──────────┬──────────────┤`);
  console.log(`  │ System   │ Avg Lat    │ Avg CPU  │ Avg Payload  │`);
  console.log(`  ├──────────┼────────────┼──────────┼──────────────┤`);
  console.log(`  │ A (Raw)  │ ${avgLat(statsA).padEnd(10)} │ ${avgCpu(statsA).padEnd(8)}ms│ ${avgPayload(statsA).padEnd(10)} B │`);
  console.log(`  │ B (Pred) │ ${avgLat(statsB).padEnd(10)} │ ${avgCpu(statsB).padEnd(8)}ms│ ${avgPayload(statsB).padEnd(10)} B │`);
  if (statsC.validCount > 0) {
    console.log(`  │ C (ZK)   │ ${avgLat(statsC).padEnd(10)} │ ${avgCpu(statsC).padEnd(8)}ms│ ${avgPayload(statsC).padEnd(10)} B │`);
    if (statsC.timedOutCount > 0) {
      console.log(`  │          │ ⚠ ${statsC.timedOutCount} proofs timed out${' '.repeat(19)}│`);
    }
  }
  console.log(`  └──────────┴────────────┴──────────┴──────────────┘`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  closeDB().catch(() => {});
  process.exit(1);
});
