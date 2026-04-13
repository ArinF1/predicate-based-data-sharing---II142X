// System C — ZK — Seller (Client / Prover)
// Generates a Groth16 proof that the user's data satisfies the predicate.

// @ts-expect-error snarkjs has no type declarations
import * as snarkjs from 'snarkjs';
import { locationToInt } from '../../shared/types.js';
import type { UserRecord, ZKSetupArtifacts, ZKProof, PredicateConfig } from '../../shared/types.js';

/** System C Seller — Generates ZK proofs for user attributes. */
export class SellerC {
  async generateProof(
    user: UserRecord,
    artifacts: ZKSetupArtifacts,
    predicate: PredicateConfig = { ageThreshold: 18, targetLocation: 'SE' }
  ): Promise<ZKProof> {
    const input = {
      age: user.age,
      location: locationToInt(user.location),
      threshold: predicate.ageThreshold,
      target: locationToInt(predicate.targetLocation),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      artifacts.wasmFile,
      artifacts.zkeyFile
    );

    return { proof, publicSignals };
  }
}
