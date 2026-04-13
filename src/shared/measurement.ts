// High-Resolution Timing & Payload Measurement

import { cpuUsage } from 'node:process';

// Measures wall-clock latency in nanoseconds using process.hrtime.bigint().
export async function measureLatency<T>(
  fn: () => T | Promise<T>
): Promise<{ result: T; latencyNs: bigint }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  return { result, latencyNs: end - start };
}

// Measures CPU time (user + system) in milliseconds.
export async function measureCPU<T>(
  fn: () => T | Promise<T>
): Promise<{ result: T; cpuTimeMs: number }> {
  const startCpu = cpuUsage();
  const result = await fn();
  const diff = cpuUsage(startCpu);
  const cpuTimeMs = (diff.user + diff.system) / 1000;
  return { result, cpuTimeMs };
}

// Combined measurement: latency (ns), CPU time (ms), and payload size (bytes).
export async function measureExecution<T>(
  fn: () => T | Promise<T>,
  payloadFn?: (result: T) => unknown
): Promise<{
  result: T;
  latencyNs: bigint;
  cpuTimeMs: number;
  payloadBytes: number;
}> {
  const startCpu = cpuUsage();
  const startTime = process.hrtime.bigint();

  const result = await fn();

  const endTime = process.hrtime.bigint();
  const cpuDiff = cpuUsage(startCpu);

  const latencyNs = endTime - startTime;
  const cpuTimeMs = (cpuDiff.user + cpuDiff.system) / 1000;

  let payloadBytes = 0;
  if (payloadFn) {
    const payload = payloadFn(result);
    payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  }

  return { result, latencyNs, cpuTimeMs, payloadBytes };
}

// Measure the byte size of a payload (serialized to JSON).
export function measurePayloadBytes(data: unknown): number {
  return Buffer.byteLength(JSON.stringify(data), 'utf8');
}

// Format nanoseconds to a human-readable string.
export function formatNs(ns: bigint): string {
  if (ns < 1000n) return `${ns}ns`;
  if (ns < 1_000_000n) return `${(Number(ns) / 1000).toFixed(2)}µs`;
  if (ns < 1_000_000_000n) return `${(Number(ns) / 1_000_000).toFixed(2)}ms`;
  return `${(Number(ns) / 1_000_000_000).toFixed(3)}s`;
}
