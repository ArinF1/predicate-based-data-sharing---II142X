// System B — Predicate-Based — Seller (Client / Prover)
// Generates a witness for a specific user's age value that the Buyer
// can use to reconstruct the root hash and verify against the commitment.

import { createHash } from 'node:crypto';
import { getRootId, TERMINAL_FALSE_ID, TERMINAL_TRUE_ID } from './obdd.js';
import type {
  UserRecord,
  PredicateCommitment,
  PredicateWitness,
  OBDDNode,
} from '../../shared/types.js';

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

// System B Seller — Generates witnesses for user data.
export class SellerB {
  // Generate a witness proving a user's age satisfies the predicate,
  // without revealing the actual age to the Buyer.
  generateWitness(
    user: UserRecord,
    commitment: PredicateCommitment,
    numBits: number = 8
  ): PredicateWitness {
    const { obdd, levelKeys, auxValues } = commitment;

    const nodeMap = new Map<number, OBDDNode>();
    for (const n of obdd) {
      nodeMap.set(n.id, n);
    }

    const rootId = getRootId(obdd);
    const inputValue = user.age;

    // Traverse the OBDD from root to terminal, collecting witness data
    const pathAux: Buffer[] = [];
    const pathKeys: Buffer[] = [];
    const pathBits: number[] = [];

    let currentId = rootId;

    while (true) {
      const node = nodeMap.get(currentId);
      if (!node) throw new Error(`Node ${currentId} not found`);

      if (node.isTerminal) {
        const resultByte = Buffer.from([node.terminalValue ? 1 : 0]);
        const leafHash = sha256(resultByte);

        return {
          result: node.terminalValue!,
          pathAux,
          pathKeys,
          pathBits,
          leafHash,
        };
      }

      const bit = (inputValue >> (numBits - 1 - node.level)) & 1;
      pathBits.push(bit);

      const aux = auxValues.get(node.id);
      if (aux) {
        pathAux.push(aux);
      } else {
        pathAux.push(Buffer.alloc(32, 0));
      }

      if (bit === 0) {
        pathKeys.push(levelKeys[node.level].L);
      } else {
        pathKeys.push(levelKeys[node.level].R);
      }

      currentId = bit === 0 ? node.lowChild : node.highChild;
    }
  }
}
