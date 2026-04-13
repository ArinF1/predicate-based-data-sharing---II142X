// System A — Traditional Raw Data — Buyer

import type { RawPayload, VerificationResult, PredicateConfig } from '../../shared/types.js';

/** Verifies raw data against the predicate. */
export class BuyerA {
  constructor(private predicate: PredicateConfig = { ageThreshold: 18, targetLocation: 'SE' }) {}

  verify(payload: RawPayload): VerificationResult {
    const result =
      payload.age >= this.predicate.ageThreshold &&
      payload.location === this.predicate.targetLocation;

    return {
      verified: true,
      result,
    };
  }
}
