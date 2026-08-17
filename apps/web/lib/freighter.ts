/**
 * freighter.ts — wallet connect + sign/submit helpers for the Freighter browser
 * extension.
 *
 * These functions touch browser-only APIs (`window.freighter`) and must only be
 * imported from client components ("use client"). No keys or wallet data ever
 * leave the browser — signing happens here via Freighter, and the app only ever
 * sees the public address.
 *
 * Verified against @stellar/freighter-api 6.0.1:
 *  - `getPublicKey` was removed in this major version; use `getAddress()`.
 *  - `signTransaction(xdr, { networkPassphrase, address })` returns
 *    `{ signedTxXdr, signerAddress, error? }`.
 *  - Errors are returned in-band as `{ code, message }`, not thrown — every call
 *    below normalizes that into a thrown `Error` for the UI to catch.
 */
import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';

import { getSorobanClient } from '@vaultvest/sdk';

/** FreighterApiError shape (code, message) as returned in-band by the API. */
interface FreighterApiError {
  code: number;
  message: string;
  ext?: string[];
}

function throwOnFreighterError(error: FreighterApiError | undefined, action: string): void {
  if (error) {
    throw new Error(`Freighter ${action} failed (${error.code}): ${error.message}`);
  }
}

/** Network details reported by the wallet. */
export interface WalletNetwork {
  /** Network name as Freighter reports it, e.g. "TESTNET". */
  network: string;
  /** Network passphrase, e.g. "Test SDF Network ; September 2015". */
  networkPassphrase: string;
}

/** A connected wallet: its public address and the network it is on. */
export interface ConnectedWallet extends WalletNetwork {
  /** G... address of the connected account. */
  address: string;
}

/**
 * Prompt the user to approve this dApp in Freighter and return the connected
 * account plus the wallet's current network. Throws if the user rejects or
 * Freighter is not installed.
 *
 * @returns the connected wallet address and network
 * @throws {Error} if Freighter is unavailable or the user denies access
 */
export async function connectWallet(): Promise<ConnectedWallet> {
  const { address, error } = await requestAccess();
  throwOnFreighterError(error, 'connect');
  if (!address) {
    throw new Error('Freighter connect returned no address.');
  }
  const network = await getWalletNetwork();
  return { address, ...network };
}

/**
 * Read the currently authorized account address without prompting. Returns
 * `null` when the user has not yet granted access.
 *
 * @returns the authorized G... address, or `null`
 */
export async function getWalletAddress(): Promise<string | null> {
  const { address, error } = await getAddress();
  if (error || !address) {
    return null;
  }
  return address;
}

/**
 * Whether Freighter is installed and this dApp is authorized.
 *
 * @returns `true` when connected
 */
export async function isWalletConnected(): Promise<boolean> {
  const { isConnected: connected } = await isConnected();
  return connected;
}

/**
 * Read the network the wallet is currently on.
 *
 * @returns the wallet's network name and passphrase
 * @throws {Error} if Freighter is unavailable
 */
export async function getWalletNetwork(): Promise<WalletNetwork> {
  const { network, networkPassphrase, error } = await getNetwork();
  throwOnFreighterError(error, 'getNetwork');
  if (!network || !networkPassphrase) {
    throw new Error('Freighter getNetwork returned incomplete network info.');
  }
  return { network, networkPassphrase };
}

/**
 * Sign an unsigned (prepared) transaction XDR with Freighter and submit it to
 * the network via the SDK client. The signed transaction never leaves the
 * browser except as a submission to Soroban RPC.
 *
 * Note: `sendTransaction` only enqueues the transaction; callers should poll
 * `getSorobanClient().getTransaction(hash)` for the final result and map any
 * execution failure via `contractErrorFromTransactionMeta`.
 *
 * @param unsignedXdr - base64 XDR of the unsigned prepared transaction
 * @param networkPassphrase - passphrase to sign for (must match the wallet's
 *   network, which the caller should verify against the app's configured network)
 * @returns the send response with the transaction hash
 * @throws {Error} if signing fails
 * @throws {ContractCallError} if the network rejects the submission with a known
 *   VaultVest error code
 */
export async function signAndSubmit(
  unsignedXdr: string,
  networkPassphrase: string
): Promise<{ hash: string; status: string }> {
  const { signedTxXdr, signerAddress, error } = await signTransaction(
    unsignedXdr,
    { networkPassphrase }
  );
  throwOnFreighterError(error, 'sign');
  if (!signedTxXdr) {
    throw new Error('Freighter sign returned no signed XDR.');
  }
  if (!signerAddress) {
    throw new Error('Freighter sign returned no signer address.');
  }

  const parsed = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
  if (!(parsed instanceof Transaction)) {
    // We only ever sign regular transactions; fee-bump envelopes are unexpected.
    throw new Error('Freighter returned a fee-bump transaction; expected a regular transaction.');
  }
  const response = await getSorobanClient().send(parsed);
  return { hash: response.hash, status: response.status };
}
