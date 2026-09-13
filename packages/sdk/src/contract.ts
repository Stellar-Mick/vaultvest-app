/**
 * contract.ts — typed wrappers for the functions of the deployed VaultVest
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
import type { ApprovalKind, Schedule } from './types.js';
import {
  decodeAddressVec,
  decodeI128,
  decodeSchedule,
  decodeU32,
  decodeU64,
  encodeAddress,
  encodeAddressVec,
  encodeApprovalKind,
  encodeI128,
  encodeU32,
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

/**
 * Read how many signers have approved *revocation* of a schedule
 * (`get_revoke_approval_count`). Revoke approvals are a separate pool from
 * release approvals and cannot be spent on a withdrawal, or vice versa.
 *
 * @param scheduleId - u64 schedule id
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the current revoke approval count as a `u32` `number`
 * @throws {ContractCallError} with {@link VaultVestError.ScheduleNotFound} when
 *   the schedule does not exist
 * @throws {Error} on RPC/network failures, or if the deployed contract predates
 *   this entrypoint
 */
export async function getRevokeApprovalCount(
  scheduleId: bigint | number,
  client: SorobanClient = getSorobanClient()
): Promise<number> {
  const source = await client.getReadOnlyAccount();
  const tx = client.buildTransaction(
    source,
    client.contract.call('get_revoke_approval_count', encodeU64(toU64(scheduleId))),
    { fee: READ_ONLY_FEE }
  );
  const sim = await client.simulate(tx);
  return decodeU32(requireRetval(sim.result, 'get_revoke_approval_count'));
}

/**
 * Read which signers have approved `kind` on a schedule, in approval order
 * (`get_approvers`).
 *
 * @param scheduleId - u64 schedule id
 * @param kind - `'Release'` or `'Revoke'`
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the approving signers' G... addresses
 * @throws {ContractCallError} with {@link VaultVestError.ScheduleNotFound} when
 *   the schedule does not exist
 * @throws {Error} on RPC/network failures, or if the deployed contract predates
 *   this entrypoint
 */
export async function getApprovers(
  scheduleId: bigint | number,
  kind: ApprovalKind,
  client: SorobanClient = getSorobanClient()
): Promise<string[]> {
  const source = await client.getReadOnlyAccount();
  const tx = client.buildTransaction(
    source,
    client.contract.call(
      'get_approvers',
      encodeU64(toU64(scheduleId)),
      encodeApprovalKind(kind)
    ),
    { fee: READ_ONLY_FEE }
  );
  const sim = await client.simulate(tx);
  return decodeAddressVec(requireRetval(sim.result, 'get_approvers'));
}

/**
 * Read the number of schedules ever created (`schedule_count`). Ids are dense
 * in `0..count`, so this is the enumeration primitive: iterate
 * {@link getSchedule} over the range and filter by role to find a wallet's
 * schedules — the contract keeps no per-address index.
 *
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the schedule count as a `u64` `bigint`
 * @throws {Error} on RPC/network failures, or if the deployed contract predates
 *   this entrypoint
 */
export async function getScheduleCount(
  client: SorobanClient = getSorobanClient()
): Promise<bigint> {
  const source = await client.getReadOnlyAccount();
  const tx = client.buildTransaction(
    source,
    client.contract.call('schedule_count'),
    { fee: READ_ONLY_FEE }
  );
  const sim = await client.simulate(tx);
  return decodeU64(requireRetval(sim.result, 'schedule_count'));
}

/**
 * Arguments for {@link buildCreateScheduleTx}, mirroring the `create_schedule`
 * function signature (see Section 3 of the spec).
 */
export interface CreateScheduleParams {
  /** G... address funding the schedule (owns revoke; signs this call). */
  funder: string;
  /** G... address entitled to withdraw vested tokens. */
  beneficiary: string;
  /** C... SEP-41 token contract address escrowed by the schedule. */
  token: string;
  /** i128 total amount of tokens escrowed. */
  totalAmount: bigint | number;
  /** u64 unix seconds when vesting starts. */
  startTs: bigint | number;
  /** u64 unix seconds when vesting completes. */
  endTs: bigint | number;
  /** u64 unix seconds of the cliff; nothing vests before this. */
  cliffTs: bigint | number;
  /** G... addresses allowed to approve releases. */
  signers: string[];
  /** u32 approvals required before the beneficiary can withdraw. */
  threshold: number;
}

/**
 * Build a prepared, unsigned `create_schedule` transaction for the funder to sign
 * with Freighter. The transaction is simulated and prepared server-side (auth,
 * footprint, and resource fees attached) but is **not** signed or submitted.
 *
 * @param params - schedule parameters; `funder` is the transaction source and the
 *   required signing account
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the prepared unsigned `Transaction`; serialize with `.toXDR()`
 * @throws {ContractCallError} with {@link VaultVestError.InvalidThreshold},
 *   {@link VaultVestError.InvalidTimeRange}, {@link VaultVestError.InvalidAmount},
 *   or {@link VaultVestError.EmptySignerSet} when the contract rejects the args;
 *   other {@link VaultVestError} variants may surface per Section 3 of the spec
 * @throws {Error} if the funder account does not exist or on RPC failures
 */
export async function buildCreateScheduleTx(
  params: CreateScheduleParams,
  client: SorobanClient = getSorobanClient()
): Promise<Transaction> {
  const source = await client.getAccount(params.funder);
  const tx = client.buildTransaction(
    source,
    client.contract.call(
      'create_schedule',
      encodeAddress(params.funder),
      encodeAddress(params.beneficiary),
      encodeAddress(params.token),
      encodeI128(params.totalAmount),
      encodeU64(params.startTs),
      encodeU64(params.endTs),
      encodeU64(params.cliffTs),
      encodeAddressVec(params.signers),
      encodeU32(params.threshold)
    )
  );
  return client.prepare(tx);
}

/**
 * Build a prepared, unsigned `approve_release` transaction for a signer to sign
 * with Freighter.
 *
 * @param scheduleId - u64 schedule id to approve a release for
 * @param signer - G... address of the approving signer (transaction source)
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the prepared unsigned `Transaction`; serialize with `.toXDR()`
 * @throws {ContractCallError} with {@link VaultVestError.ScheduleNotFound},
 *   {@link VaultVestError.NotAuthorizedSigner},
 *   {@link VaultVestError.DuplicateApproval}, or
 *   {@link VaultVestError.ScheduleRevoked} when the contract rejects the call;
 *   other {@link VaultVestError} variants may surface per Section 3 of the spec
 * @throws {Error} if the signer account does not exist or on RPC failures
 */
export async function buildApproveReleaseTx(
  scheduleId: bigint | number,
  signer: string,
  client: SorobanClient = getSorobanClient()
): Promise<Transaction> {
  const source = await client.getAccount(signer);
  const tx = client.buildTransaction(
    source,
    client.contract.call(
      'approve_release',
      encodeU64(toU64(scheduleId)),
      encodeAddress(signer)
    )
  );
  return client.prepare(tx);
}

/**
 * Build a prepared, unsigned `approve_revoke` transaction for a signer to sign
 * with Freighter. Revoke approvals gate `revoke` only; they cannot be spent on
 * a withdrawal.
 *
 * @param scheduleId - u64 schedule id to approve revocation of
 * @param signer - G... address of the approving signer (transaction source)
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the prepared unsigned `Transaction`; serialize with `.toXDR()`
 * @throws {ContractCallError} with {@link VaultVestError.ScheduleNotFound},
 *   {@link VaultVestError.NotAuthorizedSigner},
 *   {@link VaultVestError.DuplicateApproval}, or
 *   {@link VaultVestError.ScheduleRevoked} when the contract rejects the call
 * @throws {Error} if the signer account does not exist, on RPC failures, or if
 *   the deployed contract predates this entrypoint
 */
export async function buildApproveRevokeTx(
  scheduleId: bigint | number,
  signer: string,
  client: SorobanClient = getSorobanClient()
): Promise<Transaction> {
  const source = await client.getAccount(signer);
  const tx = client.buildTransaction(
    source,
    client.contract.call(
      'approve_revoke',
      encodeU64(toU64(scheduleId)),
      encodeAddress(signer)
    )
  );
  return client.prepare(tx);
}

/**
 * Build a prepared, unsigned `withdraw` transaction for the beneficiary to sign
 * with Freighter.
 *
 * @param scheduleId - u64 schedule id to withdraw from
 * @param caller - G... address of the caller; must be the schedule's beneficiary
 *   (transaction source)
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the prepared unsigned `Transaction`; serialize with `.toXDR()`
 * @throws {ContractCallError} with {@link VaultVestError.ScheduleNotFound},
 *   {@link VaultVestError.NothingVested}, {@link VaultVestError.ThresholdNotMet},
 *   {@link VaultVestError.ScheduleRevoked}, or
 *   {@link VaultVestError.NotBeneficiary} when the contract rejects the call;
 *   other {@link VaultVestError} variants may surface per Section 3 of the spec
 * @throws {Error} if the caller account does not exist or on RPC failures
 */
export async function buildWithdrawTx(
  scheduleId: bigint | number,
  caller: string,
  client: SorobanClient = getSorobanClient()
): Promise<Transaction> {
  const source = await client.getAccount(caller);
  const tx = client.buildTransaction(
    source,
    client.contract.call(
      'withdraw',
      encodeU64(toU64(scheduleId)),
      encodeAddress(caller)
    )
  );
  return client.prepare(tx);
}

/**
 * Build a prepared, unsigned `revoke` transaction for the funder to sign with
 * Freighter.
 *
 * @param scheduleId - u64 schedule id to revoke
 * @param caller - G... address of the caller; must be the schedule's funder
 *   (transaction source)
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the prepared unsigned `Transaction`; serialize with `.toXDR()`
 * @throws {ContractCallError} with {@link VaultVestError.ScheduleNotFound},
 *   {@link VaultVestError.ScheduleRevoked}, or
 *   {@link VaultVestError.NotFunder} when the contract rejects the call; other
 *   {@link VaultVestError} variants may surface per Section 3 of the spec
 * @throws {Error} if the caller account does not exist or on RPC failures
 */
export async function buildRevokeTx(
  scheduleId: bigint | number,
  caller: string,
  client: SorobanClient = getSorobanClient()
): Promise<Transaction> {
  const source = await client.getAccount(caller);
  const tx = client.buildTransaction(
    source,
    client.contract.call(
      'revoke',
      encodeU64(toU64(scheduleId)),
      encodeAddress(caller)
    )
  );
  return client.prepare(tx);
}
