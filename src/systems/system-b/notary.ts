// System B — Predicate-Based — Notary (Issuer)

import { createHash, randomBytes } from 'node:crypto';
import {
  buildGreaterEqOBDD,
  getRootId,
  TERMINAL_FALSE_ID,
  TERMINAL_TRUE_ID,
} from './obdd.js';
import type {
  OBDDNode,
  LevelKeys,
  PredicateCommitment,
  PredicateConfig,
} from '../../shared/types.js';

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

// System B Notary — Builds predicate commitments from OBDDs.
export class NotaryB {
  // Build a commitment for the age predicate (age >= threshold).
  setup(
    predicate: PredicateConfig = { ageThreshold: 18, targetLocation: 'SE' },
    numBits: number = 8
  ): PredicateCommitment {
    const obdd = buildGreaterEqOBDD(predicate.ageThreshold, numBits);
    const rootId = getRootId(obdd);

    // Generate random keys {L_i, R_i} for each level
    const levelKeys: LevelKeys[] = [];
    for (let i = 0; i < numBits; i++) {
      levelKeys.push({
        L: randomBytes(32),
        R: randomBytes(32),
      });
    }

    const nodeMap = new Map<number, OBDDNode>();
    for (const n of obdd) {
      nodeMap.set(n.id, n);
    }

    // Compute hashes bottom-up
    const nodeHashes = new Map<number, Buffer>();
    const auxValues = new Map<number, Buffer>();

    function computeHash(nodeId: number): Buffer {
      if (nodeHashes.has(nodeId)) return nodeHashes.get(nodeId)!;

      const node = nodeMap.get(nodeId);
      if (!node) throw new Error(`Node ${nodeId} not found`);

      if (node.isTerminal) {
        const resultByte = Buffer.from([node.terminalValue ? 1 : 0]);
        const h = sha256(resultByte);
        nodeHashes.set(nodeId, h);
        return h;
      }

      const hLow = computeHash(node.lowChild);
      const hHigh = computeHash(node.highChild);

      const level = node.level;
      const hashLowKeyed = sha256(Buffer.concat([hLow, levelKeys[level].L]));
      const hashHighKeyed = sha256(Buffer.concat([hHigh, levelKeys[level].R]));

      const hNode = sha256(Buffer.concat([hashLowKeyed, hashHighKeyed]));
      const auxNode = xorBuffers(hashLowKeyed, hashHighKeyed);

      nodeHashes.set(nodeId, hNode);
      auxValues.set(nodeId, auxNode);

      return hNode;
    }

    const rootHash = computeHash(rootId);

    return {
      rootHash,
      levelKeys,
      nodeHashes,
      auxValues,
      obdd,
    };
  }
}
