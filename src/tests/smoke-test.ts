// Smoke Test — Verify Systems A and B work correctly

import { Generator } from '../data-generator/generator.js';
import { NotaryA } from '../systems/system-a/notary.js';
import { SellerA } from '../systems/system-a/seller.js';
import { BuyerA } from '../systems/system-a/buyer.js';
import { NotaryB } from '../systems/system-b/notary.js';
import { SellerB } from '../systems/system-b/seller.js';
import { BuyerB } from '../systems/system-b/buyer.js';
import { measureExecution, formatNs, measurePayloadBytes } from '../shared/measurement.js';
import { DEFAULT_PREDICATE, locationToInt, intToLocation } from '../shared/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

async function testDataGenerator(): Promise<void> {
  console.log('\n=== Data Generator ===');

  const gen = new Generator(12345);
  const users100 = gen.generate(100);
  assert(users100.length === 100, 'Generates 100 users');
  assert(users100[0].id === 1, 'First user id is 1');
  assert(users100[0].age >= 18 && users100[0].age <= 80, 'Age in range 18-80');
  assert(['SE','US','DE','GB','FR','JP','BR','IN'].includes(users100[0].location), 'Valid location');

  const gen2 = new Generator(12345);
  const users100b = gen2.generate(100);
  assert(
    JSON.stringify(users100) === JSON.stringify(users100b),
    'Same seed produces identical output (deterministic)'
  );

  const gen3 = new Generator(99999);
  const users100c = gen3.generate(100);
  assert(
    JSON.stringify(users100) !== JSON.stringify(users100c),
    'Different seed produces different output'
  );

  console.log(`  Sample user: id=${users100[0].id}, age=${users100[0].age}, location=${users100[0].location}`);
}

async function testLocationEncoding(): Promise<void> {
  console.log('\n=== Location Encoding ===');

  assert(locationToInt('SE') === 21317, "'SE' encodes to 21317");
  assert(locationToInt('US') === 21843, "'US' encodes to 21843");
  assert(intToLocation(21317) === 'SE', '21317 decodes to SE');
  assert(intToLocation(21843) === 'US', '21843 decodes to US');
}

async function testSystemA(): Promise<void> {
  console.log('\n=== System A — Traditional ===');

  const seller = new SellerA();
  const buyer = new BuyerA(DEFAULT_PREDICATE);

  const user1 = { id: 1, age: 25, location: 'SE' };
  const payload1 = seller.createPayload(user1);
  assert(payload1.age === 25, 'Payload contains raw age');
  assert(payload1.location === 'SE', 'Payload contains raw location');

  const result1 = buyer.verify(payload1);
  assert(result1.verified === true, 'Verification succeeds');
  assert(result1.result === true, 'Predicate holds: age=25, location=SE');

  const user2 = { id: 2, age: 15, location: 'SE' };
  const result2 = buyer.verify(seller.createPayload(user2));
  assert(result2.result === false, 'Predicate fails: age=15 < 18');

  const user3 = { id: 3, age: 30, location: 'US' };
  const result3 = buyer.verify(seller.createPayload(user3));
  assert(result3.result === false, 'Predicate fails: location=US ≠ SE');

  const bytes = measurePayloadBytes(payload1);
  assert(bytes > 0, `Payload size: ${bytes} bytes`);
}

async function testSystemB(): Promise<void> {
  console.log('\n=== System B — Predicate-Based ===');

  const notary = new NotaryB();
  const seller = new SellerB();
  const buyer = new BuyerB();

  const commitment = notary.setup(DEFAULT_PREDICATE, 8);
  assert(commitment.rootHash.length === 32, 'Root hash is 32 bytes (SHA-256)');
  assert(commitment.levelKeys.length === 8, '8 level keys (8-bit age)');

  const user1 = { id: 1, age: 25, location: 'SE' };
  const witness1 = seller.generateWitness(user1, commitment, 8);
  assert(witness1.result === true, 'Witness result: age=25 >= 18');

  const verification1 = buyer.verify(witness1, commitment.rootHash);
  assert(verification1.verified === true, 'Root hash reconstruction matches');
  assert(verification1.result === true, 'Predicate result is true');

  const user2 = { id: 2, age: 17, location: 'SE' };
  const witness2 = seller.generateWitness(user2, commitment, 8);
  assert(witness2.result === false, 'Witness result: age=17 < 18');

  const verification2 = buyer.verify(witness2, commitment.rootHash);
  assert(verification2.verified === true, 'Root hash still verifies (proof is valid)');
  assert(verification2.result === false, 'But predicate result is false');

  const user3 = { id: 3, age: 18, location: 'SE' };
  const witness3 = seller.generateWitness(user3, commitment, 8);
  assert(witness3.result === true, 'Witness result: age=18 >= 18');

  const verification3 = buyer.verify(witness3, commitment.rootHash);
  assert(verification3.verified === true, 'Root hash verifies for edge case');
  assert(verification3.result === true, 'Predicate holds for age=18');

  // Tamper test
  const tamperedWitness = { ...witness1, result: false, leafHash: Buffer.alloc(32, 0xFF) };
  const tamperedVerification = buyer.verify(tamperedWitness, commitment.rootHash);
  assert(tamperedVerification.verified === false, 'Tampered witness fails verification');

  // Age sweep
  console.log('\n  --- Age sweep (0-80) ---');
  let allCorrect = true;
  for (let age = 0; age <= 80; age++) {
    const user = { id: age, age, location: 'SE' };
    const witness = seller.generateWitness(user, commitment, 8);
    const verification = buyer.verify(witness, commitment.rootHash);
    const expected = age >= 18;
    if (witness.result !== expected || !verification.verified) {
      console.error(`  ✗ Age ${age}: expected=${expected}, got result=${witness.result}, verified=${verification.verified}`);
      allCorrect = false;
    }
  }
  assert(allCorrect, 'All ages 0-80 produce correct results');

  const witnessPayload = {
    result: witness1.result,
    pathAux: witness1.pathAux.map(b => b.toString('hex')),
    pathKeys: witness1.pathKeys.map(b => b.toString('hex')),
    pathBits: witness1.pathBits,
    leafHash: witness1.leafHash.toString('hex'),
  };
  const bytes = measurePayloadBytes(witnessPayload);
  assert(bytes > 0, `Witness payload size: ${bytes} bytes`);
}

async function testMeasurement(): Promise<void> {
  console.log('\n=== Measurement Utilities ===');

  const { result, latencyNs, cpuTimeMs } = await measureExecution(() => {
    let sum = 0;
    for (let i = 0; i < 100000; i++) sum += i;
    return sum;
  });

  assert(result === 4999950000, 'measureExecution returns correct result');
  assert(latencyNs > 0n, `Latency measured: ${formatNs(latencyNs)}`);
  assert(cpuTimeMs >= 0, `CPU time measured: ${cpuTimeMs.toFixed(2)}ms`);
}

async function testBenchmarkIntegration(): Promise<void> {
  console.log('\n=== Benchmark Integration (5 users, no DB) ===');

  const gen = new Generator(12345);
  const users = gen.generate(5);

  const sellerA = new SellerA();
  const buyerA = new BuyerA(DEFAULT_PREDICATE);
  const notaryB = new NotaryB();
  const sellerB = new SellerB();
  const buyerB = new BuyerB();

  const commitment = notaryB.setup(DEFAULT_PREDICATE, 8);

  for (const user of users) {
    const { latencyNs: latA } = await measureExecution(() => {
      const payload = sellerA.createPayload(user);
      return buyerA.verify(payload);
    });

    const { latencyNs: latB } = await measureExecution(() => {
      const witness = sellerB.generateWitness(user, commitment, 8);
      return buyerB.verify(witness, commitment.rootHash);
    });

    console.log(
      `  User ${user.id}: age=${user.age}, loc=${user.location} | ` +
      `A: ${formatNs(latA)} | B: ${formatNs(latB)}`
    );
  }
  assert(true, 'Integration test completed without errors');
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        Smoke Test — Systems A & B Verification      ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  await testDataGenerator();
  await testLocationEncoding();
  await testSystemA();
  await testSystemB();
  await testMeasurement();
  await testBenchmarkIntegration();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
