// System A — Traditional Raw Data — Seller

import type { UserRecord, RawPayload } from '../../shared/types.js';

// Sends raw user attributes as plaintext JSON to the Buyer.
export class SellerA {
  createPayload(user: UserRecord): RawPayload {
    return {
      age: user.age,
      location: user.location,
    };
  }
}
