// System A — Traditional Raw Data — Notary

import type { UserRecord } from '../../shared/types.js';

// System A Notary — no pre-computation required
export class NotaryA {
  setup(users: UserRecord[]): { users: UserRecord[] } {
    return { users };
  }
}
