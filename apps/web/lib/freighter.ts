/**
 * freighter.ts — wallet connect + sign/submit helpers for the Freighter browser
 * extension.
 *
 * These functions touch browser-only APIs (`window.freighter`) and must only
 * be imported from client components ("use client"). No keys or wallet data
 * ever leave the browser — signing happens here via Freighter, and the app
 * only ever sees the public address.
 *
 * Verified against @stellar/freighter-api 6.0.1:
 *  - `getPublicKey` was removed in this major version; use `getAddress()`.
 *  - `signTransaction(xdr, { networkPassphrase, address })` returns
 *    `{ signedTxXdr, signerAddress, error? }`.
 *  - Errors are returned in-band as `{ code, message }`, not thrown — every
 *    call below normalizes that into a thrown `Error` for the UI to catch.
 */
import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';

import { sdkClient } from './soroban-client';

// ---------------------------------------------------------------------------
// Wallet detection
// ---------------------------------------------------------------------------

/** Check if the Freighter extension is installed in the browser. */
function isFreighterInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  // Freighter injects `window.freighter` when the extension is active.
  return 'freighter' in window;
}

/**
 * Detect whether a Stellar wallet extension is available. Checks for
 * Freighter first (the only wallet supported by @stellar/freighter-api).
 *
 * Returns a result object so callers can show a clear message instead of
 * hanging on an endless "Connecting…" spinner.
 */
export interface WalletAvailability {
  available: boolean;
  /** Human-readable reason when `available` is false. */
  reason?: string;
}

export function detectWallet(): WalletAvailability {
  if (typeof window === 'undefined') {
    return { available: false, reason: 'Wallet detection requires a browser.' };
  }
  if (!isFreighterInstalled()) {
    return {
      available: false,
      reason:
        'No Stellar wallet detected. Install the Freighter browser extension to connect.',
    };
  }
  return { available: true };
}

// ---------------------------------------------------------------------------
// Timeout helper — Freighter API calls can hang when the extension is in a
// bad state. Wrap them so we fail gracefully instead of spinning forever.
// ---------------------------------------------------------------------------

const WALLET_TIMEOUT_MS = 8_000;

/**
 * Race an async Freighter API call against a timeout. If the wallet extension
 * doesn't respond within `ms` milliseconds, reject with a clear error.
 */
function withTimeout<T>(promise: Promise<T>, label: string, ms = WALLET_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Wallet ${label} timed out — the extension may not be responding. ` +
                'Try reloading the page or reinstalling Freighter.'
            )
          ),
        ms
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Freighter API wrappers
// ---------------------------------------------------------------------------

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
 * account plus the wallet's current network. Throws if the wallet is not
 * installed, the user rejects, or the extension doesn't respond.
 *
 * @returns the connected wallet address and network
 * @throws {Error} if Freighter is unavailable, unresponsive, or the user denies access
 */
export async function connectWallet(): Promise<ConnectedWallet> {
  // 1. Pre-flight: is the extension even installed?
  const availability = detectWallet();
  if (!availability.available) {
    throw new Error(availability.reason);
  }

  // 2. Request access with timeout protection.
  let address: string | undefined;
  let error: FreighterApiError | undefined;
  try {
    const result = await withTimeout(requestAccess(), 'connect');
    address = result.address;
    error = result.error;
  } catch (err) {
    // Timeout or extension-level failure
    if (err instanceof Error) throw err;
    throw new Error('Freighter connect failed unexpectedly.');
  }

  throwOnFreighterError(error, 'connect');
  if (!address) {
    throw new Error('Freighter connect returned no address.');
  }

  // 3. Read network info with timeout.
  const network = await getWalletNetwork();
  return { address, ...network };
}

/**
 * Read the currently authorized account address without prompting. Returns
 * `null` when the wallet is not installed, not authorized, or unresponsive.
 *
 * @returns the authorized G... address, or `null`
 */
export async function getWalletAddress(): Promise<string | null> {
  if (!isFreighterInstalled()) return null;
  try {
    const { address, error } = await withTimeout(getAddress(), 'getAddress');
    if (error || !address) return null;
    return address;
  } catch {
    // Wallet not responding — treat as not connected rather than crashing.
    return null;
  }
}

/**
 * Whether Freighter is installed and this dApp is authorized.
 *
 * @returns `true` when connected
 */
export async function isWalletConnected(): Promise<boolean> {
  if (!isFreighterInstalled()) return false;
  try {
    const { isConnected: connected } = await withTimeout(isConnected(), 'isConnected');
    return connected;
  } catch {
    return false;
  }
}

/**
 * Read the network the wallet is currently on.
 *
 * @returns the wallet's network name and passphrase
 * @throws {Error} if Freighter is unavailable or unresponsive
 */
export async function getWalletNetwork(): Promise<WalletNetwork> {
  const { network, networkPassphrase, error } = await withTimeout(getNetwork(), 'getNetwork');
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
 * `sdkClient.getTransaction(hash)` for the final result and map any execution
 * failure via `contractErrorFromTransactionMeta`.
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
  const response = await sdkClient.send(parsed);
  return { hash: response.hash, status: response.status };
}
