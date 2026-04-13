// System C — ZK — Buyer (Server / Verifier)
// Verifies the Groth16 proof using the verification key.

// @ts-expect-error snarkjs has no type declarations
import * as snarkjs from 'snarkjs';
import type { ZKProof, VerificationResult } from '../../shared/types.js';

// System C Buyer — Verifies ZK proofs against the verification key.
export class BuyerC {
  async verify(zkProof: ZKProof, vkey: object): Promise<VerificationResult> {
    const isValid = await snarkjs.groth16.verify(
      vkey,
      zkProof.publicSignals,
      zkProof.proof
    );

    return {
      verified: isValid,
      result: isValid,
    };
  }
}
