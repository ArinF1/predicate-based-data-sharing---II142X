// System B — Predicate-Based — OBDD (Ordered Binary Decision Diagram)
// Constructs reduced OBDDs for age and location predicates.

import type { OBDDNode } from '../../shared/types.js';

// Terminal node IDs
export const TERMINAL_FALSE_ID = -1;
export const TERMINAL_TRUE_ID = -2;

// Build an OBDD for "value >= threshold" on an n-bit unsigned integer.
// Checks bits from MSB (level 0) to LSB (level n-1).
// Produces a reduced OBDD with at most n+2 nodes.
export function buildGreaterEqOBDD(threshold: number, numBits: number): OBDDNode[] {
  const nodes: OBDDNode[] = [];
  let nodeId = 0;

  const termFalse: OBDDNode = {
    id: TERMINAL_FALSE_ID,
    level: numBits,
    lowChild: TERMINAL_FALSE_ID,
    highChild: TERMINAL_FALSE_ID,
    isTerminal: true,
    terminalValue: false,
  };

  const termTrue: OBDDNode = {
    id: TERMINAL_TRUE_ID,
    level: numBits,
    lowChild: TERMINAL_TRUE_ID,
    highChild: TERMINAL_TRUE_ID,
    isTerminal: true,
    terminalValue: true,
  };

  nodes.push(termFalse, termTrue);

  const levelNodes: OBDDNode[] = new Array(numBits);

  for (let level = numBits - 1; level >= 0; level--) {
    const bit = (threshold >> (numBits - 1 - level)) & 1;

    const continueChild =
      level === numBits - 1
        ? TERMINAL_TRUE_ID
        : levelNodes[level + 1].id;

    const id = nodeId++;

    if (bit === 0) {
      levelNodes[level] = {
        id,
        level,
        lowChild: continueChild,
        highChild: TERMINAL_TRUE_ID,
        isTerminal: false,
      };
    } else {
      levelNodes[level] = {
        id,
        level,
        lowChild: TERMINAL_FALSE_ID,
        highChild: continueChild,
        isTerminal: false,
      };
    }

    nodes.push(levelNodes[level]);
  }

  return nodes;
}

/**
 * Build an OBDD for "value === target" on an n-bit unsigned integer.
 */
export function buildEqualityOBDD(target: number, numBits: number): OBDDNode[] {
  const nodes: OBDDNode[] = [];
  let nodeId = 100;

  const termFalse: OBDDNode = {
    id: TERMINAL_FALSE_ID,
    level: numBits,
    lowChild: TERMINAL_FALSE_ID,
    highChild: TERMINAL_FALSE_ID,
    isTerminal: true,
    terminalValue: false,
  };

  const termTrue: OBDDNode = {
    id: TERMINAL_TRUE_ID,
    level: numBits,
    lowChild: TERMINAL_TRUE_ID,
    highChild: TERMINAL_TRUE_ID,
    isTerminal: true,
    terminalValue: true,
  };

  nodes.push(termFalse, termTrue);

  const levelNodes: OBDDNode[] = new Array(numBits);

  for (let level = numBits - 1; level >= 0; level--) {
    const bit = (target >> (numBits - 1 - level)) & 1;
    const continueChild =
      level === numBits - 1
        ? TERMINAL_TRUE_ID
        : levelNodes[level + 1].id;

    const id = nodeId++;

    if (bit === 0) {
      levelNodes[level] = {
        id,
        level,
        lowChild: continueChild,
        highChild: TERMINAL_FALSE_ID,
        isTerminal: false,
      };
    } else {
      levelNodes[level] = {
        id,
        level,
        lowChild: TERMINAL_FALSE_ID,
        highChild: continueChild,
        isTerminal: false,
      };
    }

    nodes.push(levelNodes[level]);
  }

  return nodes;
}

/** Evaluate an OBDD for a given input value. Returns the terminal value. */
export function evaluateOBDD(nodes: OBDDNode[], rootId: number, input: number, numBits: number): boolean {
  const nodeMap = new Map<number, OBDDNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  let currentId = rootId;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const node = nodeMap.get(currentId);
    if (!node) throw new Error(`OBDD node ${currentId} not found`);

    if (node.isTerminal) {
      return node.terminalValue!;
    }

    const bit = (input >> (numBits - 1 - node.level)) & 1;
    currentId = bit === 0 ? node.lowChild : node.highChild;
  }
}

/** Get the root node ID (non-terminal node at level 0). */
export function getRootId(nodes: OBDDNode[]): number {
  const root = nodes.find(n => !n.isTerminal && n.level === 0);
  if (!root) throw new Error('No root node found in OBDD');
  return root.id;
}

/** Trace the path through the OBDD for a given input. */
export function tracePath(
  nodes: OBDDNode[],
  rootId: number,
  input: number,
  numBits: number
): { nodeIds: number[]; bits: number[]; terminalValue: boolean } {
  const nodeMap = new Map<number, OBDDNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const nodeIds: number[] = [];
  const bits: number[] = [];
  let currentId = rootId;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const node = nodeMap.get(currentId);
    if (!node) throw new Error(`OBDD node ${currentId} not found`);

    nodeIds.push(currentId);

    if (node.isTerminal) {
      return { nodeIds, bits, terminalValue: node.terminalValue! };
    }

    const bit = (input >> (numBits - 1 - node.level)) & 1;
    bits.push(bit);
    currentId = bit === 0 ? node.lowChild : node.highChild;
  }
}
