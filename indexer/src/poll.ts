/**
 * poll.ts — lightweight polling service that reads VaultVest contract events from
 * Soroban RPC and logs them as JSON lines.
 *
 * Design notes:
 *  - No database: the event cursor is kept in memory and advances as events are
 *    read. On restart the indexer resumes from `INDEXER_START_LEDGER` (default:
 *    the latest ledger at startup), so events emitted while it was offline are
 *    skipped — acceptable for this phase; durable cursors are a follow-up.
 *  - Structured logging only (JSON lines), per Section 9 of the spec.
 *  - RPC failures are retried with exponential backoff (1s doubling to a 60s
 *    cap); a single failed poll never crashes the process.
 *
 * Env vars (same NEXT_PUBLIC_* set as the rest of the app, plus):
 *  - INDEXER_POLL_INTERVAL_MS  poll interval (default 5000)
 *  - INDEXER_START_LEDGER      ledger to start from when no cursor exists
 */
import { scValToNative } from '@stellar/stellar-sdk';

import { getSorobanClient } from '@vaultvest/sdk';

const client = getSorobanClient();

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000);
const START_LEDGER = process.env.INDEXER_START_LEDGER
  ? Number(process.env.INDEXER_START_LEDGER)
  : undefined;
const PAGE_LIMIT = 100;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  fields: Record<string, unknown> = {}
): void {
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      message,
      ...fields,
    })
  );
}

/**
 * Make a value JSON-serializable: bigints become strings, undefined becomes
 * null, and objects/arrays are mapped recursively.
 */
function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'undefined' || typeof value === 'function') {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        toJsonSafe(val),
      ])
    );
  }
  return value;
}

/** Event filter for the deployed VaultVest contract. */
function contractFilter(): { type: 'contract'; contractIds: string[] } {
  return { type: 'contract', contractIds: [client.contractId] };
}

/**
 * Fetch one page of contract events since the given cursor (or since
 * START_LEDGER / the latest ledger on first run) and log each as a JSON line.
 *
 * @param cursor - last event cursor, or `null` for the initial ledger-range read
 * @returns the new cursor to continue from
 */
async function pollOnce(cursor: string | null): Promise<string> {
  const request = cursor
    ? {
        filters: [contractFilter()],
        cursor,
        limit: PAGE_LIMIT,
      }
    : {
        filters: [contractFilter()],
        startLedger: START_LEDGER ?? (await client.server.getLatestLedger()).sequence,
        limit: PAGE_LIMIT,
      };

  const response = await client.server.getEvents(request);

  for (const event of response.events) {
    log('info', 'contract event', {
      id: event.id,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
      txHash: event.txHash,
      inSuccessfulContractCall: event.inSuccessfulContractCall,
      topic: toJsonSafe(event.topic.map((scv) => scValToNative(scv))),
      value: toJsonSafe(scValToNative(event.value)),
    });
  }

  return response.cursor ?? cursor ?? '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll forever (until SIGINT/SIGTERM), retrying failures with exponential
 * backoff and never crashing on a single bad poll.
 */
async function run(): Promise<void> {
  log('info', 'indexer starting', {
    contractId: client.contractId,
    pollIntervalMs: POLL_INTERVAL_MS,
    startLedger: START_LEDGER ?? 'latest',
  });

  let cursor: string | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let shuttingDown = false;
  const shutdown = () => {
    shuttingDown = true;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (!shuttingDown) {
    try {
      cursor = await pollOnce(cursor);
      backoffMs = INITIAL_BACKOFF_MS;
    } catch (error) {
      log('error', 'poll failed, will retry', {
        error: error instanceof Error ? error.message : String(error),
        backoffMs,
      });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      continue;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  log('info', 'indexer stopped');
}

run().catch((error) => {
  log('error', 'indexer crashed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
