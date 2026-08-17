/**
 * Types mirrored from the deployed `vaultvest-contract` (contracts/vaultvest/src/types.rs).
 *
 * This package never redefines contract logic — these shapes exist so callers of the
 * SDK get fully typed responses and errors. Keep the field names/types in sync with
 * the Rust definitions manually; the on-chain serialization uses snake_case keys,
 * which `xdr.ts` maps onto these camelCase fields.
 */

/**
 * A vesting schedule as stored on-chain by the VaultVest contract.
 *
 * All integer fields are `bigint` because they map to i128/u64 Soroban values that
 * can exceed `Number.MAX_SAFE_INTEGER`.
 */
export interface Schedule {
  /** G... address that funded the schedule (owns revoke). */
  funder: string;
  /** G... address entitled to withdraw vested tokens. */
  beneficiary: string;
  /** C... SEP-41 token contract address. */
  token: string;
  /** i128 — total token amount escrowed by the schedule. */
  totalAmount: bigint;
  /** i128 — amount already withdrawn by the beneficiary. */
  withdrawnAmount: bigint;
  /** u64 — unix seconds when vesting starts. */
  startTs: bigint;
  /** u64 — unix seconds when vesting completes. */
  endTs: bigint;
  /** u64 — unix seconds of the cliff; nothing vests before this. */
  cliffTs: bigint;
  /** G... addresses allowed to approve releases (governance signers). */
  signers: string[];
  /** u32 — number of approvals required before the beneficiary can withdraw. */
  threshold: number;
  /** Whether the funder has revoked the schedule. */
  revoked: boolean;
}

/**
 * Error codes returned by the VaultVest contract, mirrored from the Rust enum.
 *
 * The contract reverts with `Error(Contract, #N)` where `N` is the numeric value
 * below. The SDK maps those codes back onto this enum instead of surfacing raw
 * XDR strings to users.
 */
export enum VaultVestError {
  InvalidThreshold = 1,
  InvalidTimeRange = 2,
  InvalidAmount = 3,
  EmptySignerSet = 4,
  ScheduleNotFound = 5,
  NotAuthorizedSigner = 6,
  DuplicateApproval = 7,
  NothingVested = 8,
  ThresholdNotMet = 9,
  ScheduleRevoked = 10,
  NotBeneficiary = 11,
  NotFunder = 12,
}

/**
 * Reverse lookup: map a numeric contract error code (the `#N` in
 * `Error(Contract, #N)`) back to its {@link VaultVestError} member, or
 * `undefined` if the code is unknown.
 */
export function vaultVestErrorFromCode(code: number): VaultVestError | undefined {
  return Object.values(VaultVestError).find((v) => v === code) as
    | VaultVestError
    | undefined;
}

/**
 * Typed error thrown by the SDK when a VaultVest contract call reverts with a
 * known {@link VaultVestError} code.
 *
 * `code` carries the enum member so UI layers can branch on it; `message` is a
 * human-readable description that includes the enum name.
 */
export class ContractCallError extends Error {
  /** The VaultVest error code the contract reverted with. */
  readonly code: VaultVestError;

  constructor(code: VaultVestError, message?: string) {
    super(
      message ??
        `VaultVest contract call failed: ${VaultVestError[code]} (code ${code})`
    );
    this.name = 'ContractCallError';
    this.code = code;
  }
}
