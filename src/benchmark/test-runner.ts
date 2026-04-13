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
} from './config.js';
import type {
  BenchmarkResult,
  UserRecord,
  SystemType,
  PredicateCommitment,
  ZKSetupArtifacts,
} from '../shared/types.js';

// CLI argument parsing
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

// System A benchmark
async function benchmarkSystemA(
  users: UserRecord[],
  sampleSize: number
): Promise<BenchmarkResult[]> {
  console.log(`  [System A — Traditional] Processing ${users.length} users...`);

  const notary = new NotaryA();
  const seller = new SellerA();
  const buyer = new BuyerA(PREDICATE);

  notary.setup(users);

  const results: BenchmarkResult[] = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    const { result, latencyNs, cpuTimeMs } = await measureExecution(() => {
      const payload = seller.createPayload(user);
      const verification = buyer.verify(payload);
      return { payload, verification };
    });

    const payloadBytes = measurePayloadBytes(result.payload);

    results.push({
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

    if ((i + 1) % LOG_INTERVAL === 0) {
      console.log(`    [A] ${i + 1}/${users.length} — last: ${formatNs(latencyNs)}`);
    }
  }

  return results;
}

// System B benchmark
async function benchmarkSystemB(
  users: UserRecord[],
  sampleSize: number
): Promise<BenchmarkResult[]> {
  console.log(`  [System B — Predicate-Based] Processing ${users.length} users...`);

  const notary = new NotaryB();
  const seller = new SellerB();
  const buyer = new BuyerB();

  console.log('    [B] Setup: building commitment...');
  const setupStart = process.hrtime.bigint();
  const commitment: PredicateCommitment = notary.setup(PREDICATE, 8);
  const setupTime = process.hrtime.bigint() - setupStart;
  console.log(`    [B] Setup complete in ${formatNs(setupTime)}`);

  const results: BenchmarkResult[] = [];

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

    results.push({
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

    if ((i + 1) % LOG_INTERVAL === 0) {
      console.log(`    [B] ${i + 1}/${users.length} — last: ${formatNs(latencyNs)}`);
    }
  }

  return results;
}

// System C benchmark
async function benchmarkSystemC(
  users: UserRecord[],
  sampleSize: number
): Promise<BenchmarkResult[]> {
  console.log(`  [System C — ZK] Processing ${users.length} users...`);

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
    return [];
  }

  const results: BenchmarkResult[] = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    const canProve =
      user.age >= PREDICATE.ageThreshold &&
      user.location === PREDICATE.targetLocation;

    if (!canProve) {
      results.push({
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
      continue;
    }

    try {
      const { result, latencyNs, cpuTimeMs } = await measureExecution(async () => {
        const zkProof = await seller.generateProof(user, artifacts, PREDICATE);
        const verification = await buyer.verify(zkProof, artifacts.vkeyJson);
        return { zkProof, verification };
      });

      const payloadBytes = measurePayloadBytes(result.zkProof);

      results.push({
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
    } catch (err) {
      results.push({
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
    }

    if ((i + 1) % LOG_INTERVAL === 0) {
      const last = results[results.length - 1];
      console.log(`    [C] ${i + 1}/${users.length} — last: ${formatNs(last.latency_ns)}`);
    }
  }

  return results;
}

// JIT Warmup — stabilize V8 optimizations before measurement
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
        const proof = await sellerC.generateProof(user, artifacts, PREDICATE);
        await buyerC.verify(proof, artifacts.vkeyJson);
      }
      console.log('  [Warmup] System C done');
    } catch (err) {
      console.log(`  [Warmup] System C skipped: ${(err as Error).message}`);
    }
  }

  console.log('[Warmup] Complete.\n');
}

// Main
async function main(): Promise<void> {
  const { sampleSizes, enableZkp } = parseArgs();

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   Predicate-Based Data Sharing — Benchmark Runner   ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ Sample sizes: ${sampleSizes.join(', ').padEnd(38)}║`);
  console.log(`║ Predicate:    age >= ${PREDICATE.ageThreshold} AND location === '${PREDICATE.targetLocation}'${' '.repeat(10)}║`);
  console.log(`║ ZK enabled:   ${String(enableZkp).padEnd(38)}║`);
  console.log(`║ Seed:         ${String(SEED).padEnd(38)}║`);
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
    const resultsA = await benchmarkSystemA(users, size);
    console.log(`  [A] Complete: ${resultsA.length} results`);
    await logResults(resultsA);

    // System B
    const resultsB = await benchmarkSystemB(users, size);
    console.log(`  [B] Complete: ${resultsB.length} results`);
    await logResults(resultsB);

    // System C
    if (enableZkp) {
      const resultsC = await benchmarkSystemC(users, size);
      console.log(`  [C] Complete: ${resultsC.length} results`);
      if (resultsC.length > 0) {
        await logResults(resultsC);
      }
    } else {
      console.log('  [C] ZK disabled, skipping.');
    }

    printSummary(size, resultsA, resultsB, enableZkp ? [] : []);
  }

  console.log(`\n[Export] Writing results to ${CSV_OUTPUT}...`);
  await exportCSV(CSV_OUTPUT);

  await closeDB();
  console.log('\n[Done] Benchmark complete.');
}

// Summary printer
function printSummary(
  size: number,
  resultsA: BenchmarkResult[],
  resultsB: BenchmarkResult[],
  resultsC: BenchmarkResult[]
): void {
  const avg = (arr: BenchmarkResult[], field: 'latency_ns' | 'cpu_time_ms' | 'payload_bytes') => {
    const valid = arr.filter(r => r.latency_ns > 0n);
    if (valid.length === 0) return 'N/A';
    if (field === 'latency_ns') {
      const sum = valid.reduce((s, r) => s + r.latency_ns, 0n);
      return formatNs(sum / BigInt(valid.length));
    }
    const sum = valid.reduce((s, r) => s + (r[field] as number), 0);
    return (sum / valid.length).toFixed(2);
  };

  console.log(`\n  ┌─────────────────────────────────────────────────┐`);
  console.log(`  │ Summary for N=${size}`);
  console.log(`  ├──────────┬────────────┬──────────┬──────────────┤`);
  console.log(`  │ System   │ Avg Lat    │ Avg CPU  │ Avg Payload  │`);
  console.log(`  ├──────────┼────────────┼──────────┼──────────────┤`);
  console.log(`  │ A (Raw)  │ ${avg(resultsA, 'latency_ns').padEnd(10)} │ ${avg(resultsA, 'cpu_time_ms').padEnd(8)}ms│ ${avg(resultsA, 'payload_bytes').padEnd(10)} B │`);
  console.log(`  │ B (Pred) │ ${avg(resultsB, 'latency_ns').padEnd(10)} │ ${avg(resultsB, 'cpu_time_ms').padEnd(8)}ms│ ${avg(resultsB, 'payload_bytes').padEnd(10)} B │`);
  if (resultsC.length > 0) {
    console.log(`  │ C (ZK)   │ ${avg(resultsC, 'latency_ns').padEnd(10)} │ ${avg(resultsC, 'cpu_time_ms').padEnd(8)}ms│ ${avg(resultsC, 'payload_bytes').padEnd(10)} B │`);
  }
  console.log(`  └──────────┴────────────┴──────────┴──────────────┘`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  closeDB().catch(() => {});
  process.exit(1);
});
