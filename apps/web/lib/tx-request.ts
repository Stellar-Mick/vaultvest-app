/**
 * tx-request.ts — runtime validation for the JSON body of POST /api/tx.
 *
 * The route is public and unauthenticated: anything the client sends is
 * attacker-controlled. TypeScript's `as TxRequestBody` cast at the route
 * boundary is erased at runtime and provides no protection, so every field is
 * re-checked here before it reaches the SDK builders — which would otherwise
 * forward unvalidated values into ScVal encoding and into outbound Soroban RPC
 * calls.
 *
 * Validation is deliberately *shape and range* only. Schedule semantics
 * (threshold rules, vesting windows, balances) stay where they belong: on-chain.
 * What this module enforces is that a request cannot spend unbounded server CPU
 * or produce a nonsensical RPC round trip.
 */
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Upper bound on the signer set accepted by this route.
 *
 * Without a cap, a single request carrying a large `signers` array forces the
 * server to strkey-decode every entry before any other work happens — an
 * unauthenticated CPU amplification vector. The on-chain signer set for a real
 * schedule is small; this bound is generous.
 */
export const MAX_SIGNERS = 25;

/** Maximum accepted request body size, in bytes. */
export const MAX_BODY_BYTES = 16 * 1024;

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const I128_MAX = (1n << 127n) - 1n;

/** A decimal, non-negative integer with no sign, exponent, or whitespace. */
const DECIMAL_UINT = /^(0|[1-9][0-9]{0,39})$/;

/**
 * A rejected request. Its `message` is written by this module and is safe to
 * return to the caller verbatim — unlike errors thrown deeper in the stack,
 * which can carry RPC endpoints and host diagnostics.
 */
export class TxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TxValidationError';
  }
}

function fail(message: string): never {
  throw new TxValidationError(message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

/** Require a G... account address (Ed25519 public key). */
function accountAddress(value: unknown, label: string): string {
  if (typeof value !== 'string' || !StrKey.isValidEd25519PublicKey(value)) {
    fail(`${label} must be a valid Stellar account address (G...).`);
  }
  return value;
}

/** Require a C... contract address. */
function contractAddress(value: unknown, label: string): string {
  if (typeof value !== 'string' || !StrKey.isValidContract(value)) {
    fail(`${label} must be a valid Soroban contract address (C...).`);
  }
  return value;
}

/**
 * Require a decimal integer string within `[0, max]`.
 *
 * Integers travel as strings because JSON has no bigint. `BigInt()` accepts
 * forms this protocol does not (`"0x10"`, `"1e5"`, leading/trailing space,
 * `"-1"`), so the string is pattern-checked before conversion rather than
 * relying on `BigInt` to throw.
 */
function uintString(value: unknown, label: string, max: bigint): string {
  if (typeof value !== 'string' || !DECIMAL_UINT.test(value)) {
    fail(`${label} must be a non-negative decimal integer string.`);
  }
  if (BigInt(value) > max) {
    fail(`${label} is out of range.`);
  }
  return value;
}

function positiveUintString(value: unknown, label: string, max: bigint): string {
  const parsed = uintString(value, label, max);
  if (BigInt(parsed) === 0n) {
    fail(`${label} must be greater than zero.`);
  }
  return parsed;
}

/** Validated `create_schedule` parameters, with integers still as strings. */
export interface ValidatedCreateScheduleBody {
  funder: string;
  beneficiary: string;
  token: string;
  totalAmount: string;
  startTs: string;
  endTs: string;
  cliffTs: string;
  signers: string[];
  threshold: number;
}

export type ValidatedTxRequest =
  | { type: 'create_schedule'; params: ValidatedCreateScheduleBody }
  | { type: 'approve_release'; scheduleId: string; signer: string }
  | { type: 'withdraw'; scheduleId: string; caller: string }
  | { type: 'revoke'; scheduleId: string; caller: string };

function validateCreateSchedule(raw: unknown): ValidatedCreateScheduleBody {
  const params = asRecord(raw, 'params');

  const signersRaw = params.signers;
  if (!Array.isArray(signersRaw)) {
    fail('params.signers must be an array of Stellar account addresses.');
  }
  if (signersRaw.length === 0) {
    fail('params.signers must contain at least one signer.');
  }
  if (signersRaw.length > MAX_SIGNERS) {
    fail(`params.signers may contain at most ${MAX_SIGNERS} addresses.`);
  }
  const signers = signersRaw.map((s, i) =>
    accountAddress(s, `params.signers[${i}]`)
  );

  const threshold = params.threshold;
  if (
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > signers.length
  ) {
    fail(
      `params.threshold must be an integer between 1 and the number of signers (${signers.length}).`
    );
  }

  return {
    funder: accountAddress(params.funder, 'params.funder'),
    beneficiary: accountAddress(params.beneficiary, 'params.beneficiary'),
    token: contractAddress(params.token, 'params.token'),
    totalAmount: positiveUintString(
      params.totalAmount,
      'params.totalAmount',
      I128_MAX
    ),
    startTs: uintString(params.startTs, 'params.startTs', U64_MAX),
    endTs: uintString(params.endTs, 'params.endTs', U64_MAX),
    cliffTs: uintString(params.cliffTs, 'params.cliffTs', U64_MAX),
    signers,
    threshold,
  };
}

/**
 * Validate a parsed `/api/tx` request body.
 *
 * @param raw - the value returned by `req.json()`
 * @returns the request with every field checked and narrowed
 * @throws {TxValidationError} with a caller-safe message when the body is
 *   malformed, out of range, or of an unknown type
 */
export function validateTxRequest(raw: unknown): ValidatedTxRequest {
  const body = asRecord(raw, 'Request body');

  switch (body.type) {
    case 'create_schedule':
      return {
        type: 'create_schedule',
        params: validateCreateSchedule(body.params),
      };
    case 'approve_release':
      return {
        type: 'approve_release',
        scheduleId: uintString(body.scheduleId, 'scheduleId', U64_MAX),
        signer: accountAddress(body.signer, 'signer'),
      };
    case 'withdraw':
      return {
        type: 'withdraw',
        scheduleId: uintString(body.scheduleId, 'scheduleId', U64_MAX),
        caller: accountAddress(body.caller, 'caller'),
      };
    case 'revoke':
      return {
        type: 'revoke',
        scheduleId: uintString(body.scheduleId, 'scheduleId', U64_MAX),
        caller: accountAddress(body.caller, 'caller'),
      };
    default:
      // The unknown value is never echoed back — it is attacker-controlled and
      // would be reflected into the response body.
      fail(
        'Unknown transaction type. Expected one of: create_schedule, approve_release, withdraw, revoke.'
      );
  }
}
