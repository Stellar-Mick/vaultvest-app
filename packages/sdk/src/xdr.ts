/**
 * xdr.ts — ScVal argument encoding and response decoding helpers for the
 * VaultVest contract interface.
 *
 * Encoding uses `nativeToScVal` with explicit types (verified against
 * @stellar/stellar-sdk 16.2.0: `u64`, `i128`, and `u32` are supported integer
 * type hints) and `Address.toScVal()` for contract/public-key addresses.
 * Decoding uses `scValToNative`, which returns `bigint` for u64/i128, `string`
 * for addresses, `number` for u32, `boolean` for bool, and plain objects for
 * maps — all of which the decoders below rely on and coerce defensively.
 */
import { Address, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import type { Schedule } from './types.js';

const U64_MIN = 0n;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;

function assertU64Range(value: bigint, label: string): void {
  if (value < U64_MIN || value > U64_MAX) {
    throw new RangeError(
      `${label} ${value} is outside the u64 range [0, 2^64-1]`
    );
  }
}

function assertI128Range(value: bigint, label: string): void {
  if (value < I128_MIN || value > I128_MAX) {
    throw new RangeError(
      `${label} ${value} is outside the i128 range [-2^127, 2^127-1]`
    );
  }
}

/**
 * Encode a non-negative integer as an `scvU64` ScVal.
 *
 * @param value - u64 value (must fit in [0, 2^64-1])
 * @returns the ScVal to pass as a `u64` contract argument
 * @throws {RangeError} if `value` is outside the u64 range
 */
export function encodeU64(value: bigint | number): xdr.ScVal {
  const big = BigInt(value);
  assertU64Range(big, 'encodeU64');
  return nativeToScVal(big, { type: 'u64' });
}

/**
 * Encode a signed integer as an `scvI128` ScVal.
 *
 * @param value - i128 value (must fit in [-2^127, 2^127-1])
 * @returns the ScVal to pass as an `i128` contract argument
 * @throws {RangeError} if `value` is outside the i128 range
 */
export function encodeI128(value: bigint | number): xdr.ScVal {
  const big = BigInt(value);
  assertI128Range(big, 'encodeI128');
  return nativeToScVal(big, { type: 'i128' });
}

/**
 * Encode a non-negative integer as an `scvU32` ScVal.
 *
 * @param value - u32 value (must be an integer in [0, 2^32-1])
 * @returns the ScVal to pass as a `u32` contract argument
 * @throws {RangeError} if `value` is outside the u32 range
 */
export function encodeU32(value: number): xdr.ScVal {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(
      `encodeU32 ${value} is outside the u32 range [0, 2^32-1]`
    );
  }
  return nativeToScVal(value, { type: 'u32' });
}

/**
 * Encode a boolean as an `scvBool` ScVal.
 *
 * @param value - the boolean to encode
 * @returns the ScVal to pass as a `bool` contract argument
 */
export function encodeBool(value: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(value);
}

/**
 * Encode a G.../C... address as an `scvAddress` ScVal.
 *
 * @param address - strkey address (G... public key or C... contract)
 * @returns the ScVal to pass as an `Address` contract argument
 * @throws {TypeError} if `address` is not a valid strkey address
 */
export function encodeAddress(address: string): xdr.ScVal {
  return Address.fromString(address).toScVal();
}

/**
 * Encode a list of G.../C... addresses as an `scvVec` of `scvAddress` ScVals.
 *
 * @param addresses - strkey addresses
 * @returns the ScVal to pass as a `Vec<Address>` contract argument
 * @throws {TypeError} if any entry is not a valid strkey address
 */
export function encodeAddressVec(addresses: string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(addresses.map(encodeAddress));
}

/**
 * Decode an `scvU64` ScVal into a `bigint`.
 *
 * @param scv - the ScVal to decode
 * @returns the u64 value as a `bigint`
 */
export function decodeU64(scv: xdr.ScVal): bigint {
  return BigInt(scValToNative(scv));
}

/**
 * Decode an `scvI128` ScVal into a `bigint`.
 *
 * @param scv - the ScVal to decode
 * @returns the i128 value as a `bigint`
 */
export function decodeI128(scv: xdr.ScVal): bigint {
  return BigInt(scValToNative(scv));
}

/**
 * Decode an `scvU32` ScVal into a `number`.
 *
 * @param scv - the ScVal to decode
 * @returns the u32 value as a `number`
 */
export function decodeU32(scv: xdr.ScVal): number {
  return Number(scValToNative(scv));
}

/**
 * Decode an `scvBool` ScVal into a `boolean`.
 *
 * @param scv - the ScVal to decode
 * @returns the boolean value
 */
export function decodeBool(scv: xdr.ScVal): boolean {
  return Boolean(scValToNative(scv));
}

/**
 * Decode an `scvAddress` ScVal into its strkey string.
 *
 * @param scv - the ScVal to decode
 * @returns the G.../C... address string
 */
export function decodeAddress(scv: xdr.ScVal): string {
  return String(scValToNative(scv));
}

/**
 * Decode an `scvVec` of `scvAddress` ScVals into an array of strkey strings.
 *
 * @param scv - the ScVal to decode
 * @returns the address strings
 */
export function decodeAddressVec(scv: xdr.ScVal): string[] {
  const native = scValToNative(scv);
  return Array.isArray(native) ? native.map(String) : [];
}

/**
 * Decode a `get_schedule` return value (an `scvMap` mirroring the Rust
 * `Schedule` struct) into the typed {@link Schedule}.
 *
 * The Rust struct serializes with snake_case keys (`total_amount`, `start_ts`, …)
 * which map onto the camelCase TS fields below. Values are coerced defensively
 * because the payload is untrusted on-chain data: i128/u64 fields become
 * `bigint`, addresses become strings, the signers vector becomes `string[]`,
 * threshold becomes `number`, and revoked becomes `boolean`.
 *
 * @param scv - the ScVal returned by the contract
 * @returns the decoded {@link Schedule}
 * @throws {Error} if a required field is missing or cannot be coerced
 */
export function decodeSchedule(scv: xdr.ScVal): Schedule {
  const native = scValToNative(scv);
  if (native === null || typeof native !== 'object' || Array.isArray(native)) {
    throw new Error('decodeSchedule: expected an scvMap, got something else');
  }
  const raw = native as Record<string, unknown>;

  const get = (field: string): unknown => {
    if (!(field in raw)) {
      throw new Error(`decodeSchedule: missing field "${field}"`);
    }
    return raw[field];
  };

  const asBigInt = (field: string): bigint => {
    const value = get(field);
    if (typeof value !== 'bigint' && typeof value !== 'number') {
      throw new Error(`decodeSchedule: field "${field}" is not an integer`);
    }
    return BigInt(value);
  };

  const asString = (field: string): string => {
    const value = get(field);
    if (typeof value !== 'string') {
      throw new Error(`decodeSchedule: field "${field}" is not a string`);
    }
    return value;
  };

  const asNumber = (field: string): number => {
    const value = get(field);
    if (typeof value !== 'number') {
      throw new Error(`decodeSchedule: field "${field}" is not a number`);
    }
    return value;
  };

  const asBoolean = (field: string): boolean => {
    const value = get(field);
    if (typeof value !== 'boolean') {
      throw new Error(`decodeSchedule: field "${field}" is not a boolean`);
    }
    return value;
  };

  const asStringArray = (field: string): string[] => {
    const value = get(field);
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      throw new Error(`decodeSchedule: field "${field}" is not a string array`);
    }
    return value as string[];
  };

  return {
    funder: asString('funder'),
    beneficiary: asString('beneficiary'),
    token: asString('token'),
    totalAmount: asBigInt('total_amount'),
    withdrawnAmount: asBigInt('withdrawn_amount'),
    startTs: asBigInt('start_ts'),
    endTs: asBigInt('end_ts'),
    cliffTs: asBigInt('cliff_ts'),
    signers: asStringArray('signers'),
    threshold: asNumber('threshold'),
    revoked: asBoolean('revoked'),
  };
}
