/**
 * token.ts — read-only SEP-41 token metadata and amount formatting.
 *
 * VaultVest schedules escrow an arbitrary SEP-41 token, and every amount the
 * contract stores or returns is in that token's raw integer units. Showing
 * those to a user is only meaningful alongside the token's `decimals` and
 * `symbol`, which the token contract itself exposes. These helpers read them
 * through the same simulation path as the VaultVest read calls.
 */
import { Contract, scValToNative, type xdr } from '@stellar/stellar-sdk';

import { getSorobanClient, SorobanClient } from './client.js';

/** Base fee (stroops) used for read-only simulations — no resources are charged. */
const READ_ONLY_FEE = '100';

/** SEP-41 metadata needed to present token amounts. */
export interface TokenMetadata {
  /** C... contract address of the token. */
  contractId: string;
  /** Number of decimal places, e.g. 7 for XLM-like tokens. */
  decimals: number;
  /** Short ticker, e.g. "USDC". */
  symbol: string;
  /** Long name, e.g. "USD Coin". */
  name: string;
}

async function readTokenScVal(
  client: SorobanClient,
  contract: Contract,
  fn: 'decimals' | 'symbol' | 'name'
): Promise<xdr.ScVal> {
  const source = await client.getReadOnlyAccount();
  const tx = client.buildTransaction(source, contract.call(fn), {
    fee: READ_ONLY_FEE,
  });
  const sim = await client.simulate(tx);
  if (!sim.result) {
    throw new Error(`${fn}: token simulation returned no result`);
  }
  return sim.result.retval;
}

/**
 * Read a SEP-41 token's `decimals`, `symbol`, and `name`.
 *
 * @param contractId - C... address of the token contract
 * @param client - client to use; defaults to the shared env-configured client
 * @returns the token's presentation metadata
 * @throws {Error} on RPC failure or if the contract does not implement SEP-41
 */
export async function getTokenMetadata(
  contractId: string,
  client: SorobanClient = getSorobanClient()
): Promise<TokenMetadata> {
  const contract = new Contract(contractId);
  const [decimalsScv, symbolScv, nameScv] = await Promise.all([
    readTokenScVal(client, contract, 'decimals'),
    readTokenScVal(client, contract, 'symbol'),
    readTokenScVal(client, contract, 'name'),
  ]);

  const decimals = Number(scValToNative(decimalsScv));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new Error(`Token ${contractId} reported an invalid decimals value.`);
  }
  return {
    contractId,
    decimals,
    symbol: String(scValToNative(symbolScv)),
    name: String(scValToNative(nameScv)),
  };
}

/**
 * Format a raw token amount for display.
 *
 * Done with `bigint` arithmetic end to end — amounts are i128 and routinely
 * exceed `Number.MAX_SAFE_INTEGER`, so going through `Number` would silently
 * corrupt the digits. Integer part is grouped with thousands separators;
 * trailing zeros in the fraction are trimmed, and a fraction of all zeros is
 * dropped entirely.
 *
 * @param raw - amount in the token's smallest unit
 * @param decimals - the token's `decimals`
 * @param options.maxFractionDigits - cap on fraction digits shown (default: all)
 * @returns e.g. `"1,250.5"` for raw `12505000000n` with 7 decimals
 */
export function formatTokenAmount(
  raw: bigint,
  decimals: number,
  options: { maxFractionDigits?: number } = {}
): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  let fraction = (abs % scale).toString().padStart(decimals, '0');

  const cap = options.maxFractionDigits ?? decimals;
  fraction = fraction.slice(0, Math.max(0, Math.min(cap, decimals)));
  fraction = fraction.replace(/0+$/, '');

  const wholeGrouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fraction ? `${wholeGrouped}.${fraction}` : wholeGrouped;
  return negative ? `-${body}` : body;
}
