/**
 * discover.ts — find every schedule a wallet has a role on.
 *
 * The contract keeps no per-address index. What it does guarantee is that
 * schedule ids are dense in `0..schedule_count`, so a client can enumerate:
 * read the count, walk the ids newest-first, and keep the ones where the
 * wallet is funder, beneficiary, or signer. Each id costs one read-only
 * simulation, so the scan is capped and batched.
 */
import { getSchedule, getScheduleCount, type Schedule } from '@vaultvest/sdk';

import { rememberSchedule, rolesFor, type ScheduleRole } from '@/lib/recents';
import { getSdkClient } from '@/lib/soroban-client';

export interface DiscoveredSchedule {
  id: bigint;
  schedule: Schedule;
  roles: ScheduleRole[];
}

export interface DiscoveryResult {
  matches: DiscoveredSchedule[];
  /** Total schedules on the contract. */
  total: bigint;
  /** How many ids were actually read (≤ total, ≤ maxScan). */
  scanned: number;
  /** True when `total` exceeded `maxScan` and older schedules were skipped. */
  truncated: boolean;
}

/** Thrown when the deployed contract predates `schedule_count`. */
export class DiscoveryUnsupportedError extends Error {
  constructor() {
    super(
      'The deployed contract does not expose schedule_count yet, so schedules ' +
        'cannot be listed. Recent schedules remembered on this device are still available.'
    );
    this.name = 'DiscoveryUnsupportedError';
  }
}

const DEFAULT_MAX_SCAN = 200;
const BATCH = 8;

/**
 * Enumerate schedules newest-first and return those `address` has a role on.
 *
 * @param address - the connected wallet
 * @param options.maxScan - cap on ids read (default 200)
 * @param options.onProgress - called after each batch with ids read so far
 * @throws {DiscoveryUnsupportedError} if the contract has no `schedule_count`
 */
export async function discoverSchedules(
  address: string,
  options: { maxScan?: number; onProgress?: (scanned: number, total: number) => void } = {}
): Promise<DiscoveryResult> {
  const client = getSdkClient();
  const maxScan = options.maxScan ?? DEFAULT_MAX_SCAN;

  let total: bigint;
  try {
    total = await getScheduleCount(client);
  } catch (err) {
    // A missing function surfaces as a host error naming the symbol; anything
    // else (network, RPC) should propagate as-is.
    const msg = err instanceof Error ? err.message : String(err);
    if (/schedule_count|MissingValue|not found|no such function|InvalidAction/i.test(msg)) {
      throw new DiscoveryUnsupportedError();
    }
    throw err;
  }

  const count = Number(total > BigInt(maxScan) ? BigInt(maxScan) : total);
  const start = total - 1n;
  const matches: DiscoveredSchedule[] = [];
  let scanned = 0;

  for (let offset = 0; offset < count; offset += BATCH) {
    const ids: bigint[] = [];
    for (let i = offset; i < Math.min(offset + BATCH, count); i++) {
      ids.push(start - BigInt(i));
    }
    const schedules = await Promise.all(
      ids.map((id) => getSchedule(id, client).then((s) => ({ id, s })).catch(() => null))
    );
    for (const entry of schedules) {
      if (!entry) continue;
      const roles = rolesFor(entry.s, address);
      if (roles.length > 0) {
        matches.push({ id: entry.id, schedule: entry.s, roles });
        rememberSchedule(entry.id.toString(), roles);
      }
    }
    scanned += ids.length;
    options.onProgress?.(scanned, count);
  }

  return { matches, total, scanned, truncated: total > BigInt(maxScan) };
}
