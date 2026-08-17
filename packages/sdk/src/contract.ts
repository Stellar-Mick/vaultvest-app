/**
 * contract.ts — typed wrappers for the 7 functions of the deployed VaultVest
 * contract. This file only calls the contract; it never redefines contract logic.
 *
 * Read-only calls (`vested_amount`, `get_schedule`, `get_approval_count`) build an
 * unsigned transaction and simulate it against Soroban RPC directly — no
 * signature, no `/api/tx` round trip. Write calls (`create_schedule`,
 * `approve_release`, `withdraw`, `revoke`) are builders that produce unsigned
 * (prepared) XDR for Freighter to sign client-side; they live in the same module
 * and are split across commits 5 and 6.
 *
 * Every wrapper surfaces contract reverts as typed {@link ContractCallError}s
 * carrying a {@link VaultVestError} code, never a raw XDR string.
 */
import type { Transaction, xdr } from '@stellar/stellar-sdk';

import { getSorobanClient, SorobanClient } from './client.js';
import type { Schedule } from './types.js';
import {
  decodeI128,
  decodeSchedule,
  decodeU32,
  encodeU64,
} from './xdr.js';

/** Base fee (stroops) used for read-only simulations — no resources are charged. */
const READ_ONLY_FEE = '100';

function toU64(value: bigint | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function requireRetval(
  simResult: { retval: xdr.ScVal } | undefined,
  fn: string
): xdr.ScVal {
  if (!simResult) {
    throw new Error(
      `${fn}: simulation returned no result (unexpected RPC response)`
    );
  }
  return simResult.retval;
}

/**
 * Read the amount currently vested for a schedule, per the contract's own vesting
 * math (`vested_amount`). This is the single source of truth for withdrawable
 * amounts — the app never recomputes vesting client-side.
 *
 * @param scheduleId - u64 schedule id returned by `create_schedule`
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the vested amount as an `i128` `bigint`
 * @throws {ContractCallError} with {@link VaultVestError.ScheduleNotFound} when
 *   the schedule does not exist; other {@link VaultVestError} variants may surface
 *   per Section 3 of the spec
 * @throws {Error} on RPC/network failures
 */
export async function getVestedAmount(
  scheduleId: bigint | number,
  client: SorobanClient = getSorobanClient()
): Promise<bigint> {
  const source = await client.getReadOnlyAccount();
  const tx = client.buildTransaction(
    source,
    client.contract.call('vested_amount', encodeU64(toU64(scheduleId))),
    { fee: READ_ONLY_FEE }
  );
  const sim = await client.simulate(tx);
  return decodeI128(requireRetval(sim.result, 'vested_amount'));
}

/**
 * Read a full vesting schedule (`get_schedule`).
 *
 * @param scheduleId - u64 schedule id returned by `create_schedule`
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the decoded {@link Schedule}
 * @throws {ContractCallError} with {@link VaultVestError.ScheduleNotFound} when
 *   the schedule does not exist; other {@link VaultVestError} variants may surface
 *   per Section 3 of the spec
 * @throws {Error} on RPC/network failures or if the response cannot be decoded
 */
export async function getSchedule(
  scheduleId: bigint | number,
  client: SorobanClient = getSorobanClient()
): Promise<Schedule> {
  const source = await client.getReadOnlyAccount();
  const tx = client.buildTransaction(
    source,
    client.contract.call('get_schedule', encodeU64(toU64(scheduleId))),
    { fee: READ_ONLY_FEE }
  );
  const sim = await client.simulate(tx);
  return decodeSchedule(requireRetval(sim.result, 'get_schedule'));
}

/**
 * Read how many of the schedule's signers have approved the current release
 * (`get_approval_count`).
 *
 * @param scheduleId - u64 schedule id returned by `create_schedule`
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the current approval count as a `u32` `number`
 * @throws {ContractCallError} with {@link VaultVestError.ScheduleNotFound} when
 *   the schedule does not exist; other {@link VaultVestError} variants may surface
 *   per Section 3 of the spec
 * @throws {Error} on RPC/network failures
 */
export async function getApprovalCount(
  scheduleId: bigint | number,
  client: SorobanClient = getSorobanClient()
): Promise<number> {
  const source = await client.getReadOnlyAccount();
  const tx = client.buildTransaction(
    source,
    client.contract.call('get_approval_count', encodeU64(toU64(scheduleId))),
    { fee: READ_ONLY_FEE }
  );
  const sim = await client.simulate(tx);
  return decodeU32(requireRetval(sim.result, 'get_approval_count'));
}
