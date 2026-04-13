// System C — ZK — Notary (Issuer)
// Loads pre-built circuit artifacts from the circuits/build/ directory.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZKSetupArtifacts } from '../../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CIRCUITS_BUILD = join(__dirname, '..', '..', '..', 'circuits', 'build');

/** System C Notary — Manages ZK circuit artifacts. */
export class NotaryC {
  setup(circuitName: string = 'combined_check'): ZKSetupArtifacts {
    const circuitDir = join(CIRCUITS_BUILD, circuitName);

    const wasmFile = join(circuitDir, `${circuitName}_js`, `${circuitName}.wasm`);
    const zkeyFile = join(circuitDir, `${circuitName}.zkey`);
    const vkeyPath = join(circuitDir, 'verification_key.json');

    if (!existsSync(wasmFile)) {
      throw new Error(
        `Circuit WASM not found: ${wasmFile}\n` +
        `Run 'bash circuits/build-circuits.sh' to compile circuits first.`
      );
    }
    if (!existsSync(zkeyFile)) {
      throw new Error(
        `Proving key not found: ${zkeyFile}\n` +
        `Run 'bash circuits/build-circuits.sh' to run trusted setup first.`
      );
    }
    if (!existsSync(vkeyPath)) {
      throw new Error(
        `Verification key not found: ${vkeyPath}\n` +
        `Run 'bash circuits/build-circuits.sh' to export verification key first.`
      );
    }

    const vkeyJson = JSON.parse(readFileSync(vkeyPath, 'utf8'));

    return { wasmFile, zkeyFile, vkeyJson };
  }

  isBuilt(circuitName: string = 'combined_check'): boolean {
    const circuitDir = join(CIRCUITS_BUILD, circuitName);
    const wasmFile = join(circuitDir, `${circuitName}_js`, `${circuitName}.wasm`);
    return existsSync(wasmFile);
  }
}
