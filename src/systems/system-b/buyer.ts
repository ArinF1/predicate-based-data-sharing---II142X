// System B — Predicate-Based — Buyer (Server / Verifier)

import { createHash } from 'node:crypto';
import type { PredicateWitness, VerificationResult } from '../../shared/types.js';

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

function xorBuffers(a: Buffer, b: Buffer): Buffer {
  if (a.length !== b.length) throw new Error('XOR buffer length mismatch');
  const result = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

// System B Buyer — Reconstructs root hash from witness and verifies against the commitment.
export class BuyerB {
  verify(witness: PredicateWitness, rootHash: Buffer): VerificationResult {
    const { pathAux, pathKeys, pathBits, leafHash } = witness;
    const depth = pathBits.length;

    let H = leafHash;

    // Reconstruct bottom-up
    for (let i = depth - 1; i >= 0; i--) {
      const bit = pathBits[i];
      const key = pathKeys[i];
      const aux = pathAux[i];

      const chosenHash = sha256(Buffer.concat([H, key]));
      const otherHash = xorBuffers(chosenHash, aux);

      if (bit === 0) {
        H = sha256(Buffer.concat([chosenHash, otherHash]));
      } else {
        H = sha256(Buffer.concat([otherHash, chosenHash]));
      }
    }

    const verified = H.equals(rootHash);

    return {
      verified,
      result: witness.result,
    };
  }
}
