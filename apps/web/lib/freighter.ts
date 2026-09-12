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

import { getSdkClient } from './soroban-client';
import {
  APP_NETWORK_PASSPHRASE,
  assertSafeToSign,
  UnsafeTransactionError,
  type TxExpectation,
} from './tx-guard';

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
 * Refuse to proceed unless the wallet is on the same network this deployment is
 * configured for.
 *
 * Transactions are built server-side against `NEXT_PUBLIC_NETWORK_PASSPHRASE`.
 * Signing them with whatever passphrase the wallet happens to report — which is
 * what the write flows used to pass through — means a user whose wallet is on
 * mainnet can be walked through a flow whose transaction was built for testnet,
 * and vice versa. Checking first turns a confusing signature failure (or, worse,
 * a signature over the wrong chain) into a clear, actionable message.
 *
 * @param wallet - the connected wallet, as reported by Freighter
 * @throws {Error} when the wallet's network differs from the app's
 */
export function assertWalletOnAppNetwork(wallet: WalletNetwork): void {
  if (!APP_NETWORK_PASSPHRASE) {
    throw new Error(
      'This deployment is missing NEXT_PUBLIC_NETWORK_PASSPHRASE, so the wallet ' +
        'network cannot be verified.'
    );
  }
  if (wallet.networkPassphrase !== APP_NETWORK_PASSPHRASE) {
    throw new Error(
      `Your wallet is on ${wallet.network}, but this app is configured for a ` +
        'different Stellar network. Switch networks in Freighter before continuing.'
    );
  }
}

/**
 * Verify a server-built transaction, sign it with Freighter, and submit it.
 *
 * The XDR is **not** trusted on arrival: {@link assertSafeToSign} re-parses it in
 * the browser and confirms it is the single VaultVest call this flow asked for,
 * sourced from the connected wallet, before the wallet ever sees it. Signing
 * uses the app's configured passphrase rather than one travelling with the
 * payload. The signed envelope is then checked to be the same transaction that
 * was verified, so nothing can be substituted between approval and submission.
 *
 * Note: `sendTransaction` only enqueues the transaction; callers should poll
 * `getSdkClient().getTransaction(hash)` for the final result and map any
 * execution failure via `contractErrorFromTransactionMeta`.
 *
 * @param unsignedXdr - base64 XDR of the unsigned prepared transaction
 * @param wallet - the connected wallet; its address must be the tx source and
 *   its network must match the app's
 * @param expectation - the contract function this flow requested, plus any
 *   additional contracts (e.g. the SEP-41 token) the authorization tree may touch
 * @returns the send response with the transaction hash
 * @throws {UnsafeTransactionError} if the returned XDR is not what was requested
 * @throws {Error} if the wallet is on the wrong network or signing fails
 * @throws {ContractCallError} if the network rejects the submission with a known
 *   VaultVest error code
 */
export async function signAndSubmit(
  unsignedXdr: string,
  wallet: ConnectedWallet,
  expectation: Omit<TxExpectation, 'source'>
): Promise<{ hash: string; status: string }> {
  assertWalletOnAppNetwork(wallet);

  // Verify BEFORE the wallet prompt: a user cannot audit base64 XDR in a popup.
  const verified = assertSafeToSign(unsignedXdr, {
    ...expectation,
    source: wallet.address,
  });

  const { signedTxXdr, signerAddress, error } = await signTransaction(
    unsignedXdr,
    { networkPassphrase: APP_NETWORK_PASSPHRASE, address: wallet.address }
  );
  throwOnFreighterError(error, 'sign');
  if (!signedTxXdr) {
    throw new Error('Freighter sign returned no signed XDR.');
  }
  if (!signerAddress) {
    throw new Error('Freighter sign returned no signer address.');
  }
  if (signerAddress !== wallet.address) {
    throw new Error(
      `Freighter signed with ${signerAddress}, not the connected account ` +
        `${wallet.address}. Aborting.`
    );
  }

  const parsed = TransactionBuilder.fromXDR(
    signedTxXdr,
    APP_NETWORK_PASSPHRASE
  );
  if (!(parsed instanceof Transaction)) {
    // We only ever sign regular transactions; fee-bump envelopes are unexpected.
    throw new Error('Freighter returned a fee-bump transaction; expected a regular transaction.');
  }
  // Signing does not alter the transaction body, so the hash must be unchanged.
  // A mismatch means the payload was swapped during the wallet round trip.
  if (!parsed.hash().equals(verified.hash())) {
    throw new UnsafeTransactionError(
      'Refusing to submit: the signed transaction differs from the one that was ' +
        'verified. Do not retry until you know why.'
    );
  }

  const response = await getSdkClient().send(parsed);
  return { hash: response.hash, status: response.status };
}
