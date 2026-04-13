// Synthetic Data Generator — Deterministic User Dataset

import seedrandom from 'seedrandom';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserRecord } from '../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

const LOCATIONS = ['SE', 'US', 'DE', 'GB', 'FR', 'JP', 'BR', 'IN'];

/**
 * Deterministic data generator using a seeded PRNG.
 * Same seed always produces identical datasets.
 */
export class Generator {
  private rng: seedrandom.PRNG;

  constructor(private seed: number = 12345) {
    this.rng = seedrandom(seed.toString());
  }

  reset(): void {
    this.rng = seedrandom(this.seed.toString());
  }

  private randInt(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min + 1)) + min;
  }

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  generate(n: number): UserRecord[] {
    this.reset();
    const users: UserRecord[] = [];

    for (let i = 0; i < n; i++) {
      users.push({
        id: i + 1,
        age: this.randInt(18, 80),
        location: this.pick(LOCATIONS),
      });
    }

    return users;
  }

  generateAndSave(sizes: number[]): void {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    for (const n of sizes) {
      const users = this.generate(n);
      const filepath = join(DATA_DIR, `users_${n}.json`);
      writeFileSync(filepath, JSON.stringify(users, null, 2), 'utf8');

      const seCount = users.filter(u => u.location === 'SE').length;
      const agePass = users.filter(u => u.age >= 18).length;
      console.log(
        `[Generator] Saved ${n} users to ${filepath} ` +
        `(age>=18: ${agePass}/${n}, SE: ${seCount}/${n})`
      );
    }
  }
}

// CLI entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\\\/g, '/'))) {
  const gen = new Generator(12345);
  gen.generateAndSave([100, 1000, 10000]);
}
