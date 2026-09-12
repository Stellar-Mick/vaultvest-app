/**
 * tx-guard.ts — verify a server-built transaction before the wallet signs it.
 *
 * Why this exists
 * ---------------
 * The write flows POST to `/api/tx`, receive base64 XDR, and hand it straight to
 * Freighter. Until this module existed, the browser signed whatever came back.
 * That put the server (and anything able to impersonate it or tamper with the
 * response) inside the trust boundary for signing: a swapped payload would have
 * produced a valid user signature over an attacker's transaction — a payment, an
 * account merge, or a token `transfer` authorized through a Soroban auth entry.
 * The wallet prompt is not a backstop here; users approve prompts they cannot
 * read.
 *
 * Everything below is checked in the browser against values the browser already
 * knows — the connected address and the build-time `NEXT_PUBLIC_*` config — so a
 * malicious response cannot pass the checks by also supplying the expectation.
 *
 * What is verified
 * ----------------
 *  1. The envelope parses under the app's own network passphrase, and is a plain
 *     transaction rather than a fee-bump wrapper.
 *  2. Its source account is the connected wallet.
 *  3. It carries exactly one operation, and that operation invokes a contract.
 *  4. The invoked contract is the configured VaultVest contract, and the function
 *     is the one this flow asked for.
 *  5. Every Soroban authorization entry covered by the transaction signature
 *     (source-account credentials) invokes only allow-listed contracts, across
 *     the whole sub-invocation tree. This is the check that stops a smuggled
 *     token transfer riding along with a legitimate-looking call.
 */
import {
  Address,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * Configured VaultVest contract, read in the Next.js app where `NEXT_PUBLIC_*`
 * replacement applies (it does not reach the workspace SDK — see
 * lib/soroban-client.ts).
 */
const APP_CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';

/** Network passphrase this deployment builds and signs for. */
export const APP_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? '';

/** Raised when a transaction fails verification. Never sign past this. */
export class UnsafeTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTransactionError';
  }
}

function reject(detail: string): never {
  throw new UnsafeTransactionError(
    'Refusing to sign: the transaction returned by the server does not match ' +
      `what this app requested (${detail}). Do not approve this in your wallet.`
  );
}

/** What the calling flow expects the transaction to do. */
export interface TxExpectation {
  /** Contract function this flow asked to invoke, e.g. `withdraw`. */
  functionName: string;
  /** Address that must be the transaction source (the connected wallet). */
  source: string;
  /**
   * Contracts, besides the VaultVest contract itself, that may legitimately
   * appear in the signed authorization tree — in practice the SEP-41 token the
   * schedule escrows.
   */
  extraAuthorizedContracts?: string[];
}

/** Read an `xdr.ScAddress` back as a strkey, or `null` if it cannot be decoded. */
function scAddressToString(address: xdr.ScAddress): string | null {
  try {
    return Address.fromScAddress(address).toString();
  } catch {
    return null;
  }
}

/** js-xdr surfaces contract symbols as `Buffer` in some builds and `string` in others. */
function symbolToString(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

/**
 * Walk an authorization invocation tree, collecting every contract address it
 * touches.
 *
 * A non-contract node (e.g. a contract-creation authorization) is reported as
 * `null`, which callers treat as disallowed: this app only ever asks users to
 * authorize contract calls.
 */
function collectAuthorizedContracts(
  invocation: xdr.SorobanAuthorizedInvocation,
  found: (string | null)[] = []
): (string | null)[] {
  const fn = invocation.function();
  if (fn.switch().name === 'sorobanAuthorizedFunctionTypeContractFn') {
    found.push(scAddressToString(fn.contractFn().contractAddress()));
  } else {
    found.push(null);
  }
  for (const sub of invocation.subInvocations()) {
    collectAuthorizedContracts(sub, found);
  }
  return found;
}

/**
 * Parse and verify a server-built transaction, returning it only if every check
 * passes.
 *
 * @param unsignedXdr - base64 XDR as returned by POST /api/tx
 * @param expectation - what the calling flow asked the server to build
 * @returns the parsed transaction, safe to hand to the wallet
 * @throws {UnsafeTransactionError} if the transaction is anything other than the
 *   single contract call this flow requested
 */
export function assertSafeToSign(
  unsignedXdr: string,
  expectation: TxExpectation
): Transaction {
  if (!APP_CONTRACT_ID || !APP_NETWORK_PASSPHRASE) {
    throw new UnsafeTransactionError(
      'Refusing to sign: this deployment is missing NEXT_PUBLIC_CONTRACT_ID or ' +
        'NEXT_PUBLIC_NETWORK_PASSPHRASE, so the transaction cannot be verified.'
    );
  }

  let decoded: Transaction | ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    // Parsing under the app's own passphrase — not one supplied alongside the
    // payload — is itself a check: a transaction built for another network
    // cannot be validated here.
    decoded = TransactionBuilder.fromXDR(unsignedXdr, APP_NETWORK_PASSPHRASE);
  } catch {
    reject('it could not be decoded');
  }
  if (!(decoded instanceof Transaction)) {
    reject('it is a fee-bump envelope rather than a plain transaction');
  }
  const tx: Transaction = decoded;

  if (tx.source !== expectation.source) {
    reject('its source account is not your connected wallet');
  }
  if (tx.operations.length !== 1) {
    reject(`it contains ${tx.operations.length} operations instead of one`);
  }

  const operation = tx.operations[0];
  if (operation.type !== 'invokeHostFunction') {
    reject(`it contains a ${operation.type} operation`);
  }
  if (operation.source !== undefined && operation.source !== expectation.source) {
    reject('its operation is sourced from a different account');
  }

  const func = operation.func;
  if (func.switch().name !== 'hostFunctionTypeInvokeContract') {
    reject('it is not a contract invocation');
  }

  const invocation = func.invokeContract();
  if (scAddressToString(invocation.contractAddress()) !== APP_CONTRACT_ID) {
    reject('it invokes a contract other than VaultVest');
  }
  if (symbolToString(invocation.functionName()) !== expectation.functionName) {
    reject(`it invokes a function other than ${expectation.functionName}`);
  }

  const allowed = new Set<string>([
    APP_CONTRACT_ID,
    ...(expectation.extraAuthorizedContracts ?? []),
  ]);
  for (const entry of operation.auth ?? []) {
    // Only source-account credentials are covered by the signature this wallet
    // is about to produce. Address credentials carry their own signatures and
    // are authorized elsewhere, so they are not this check's concern.
    if (
      entry.credentials().switch().name !== 'sorobanCredentialsSourceAccount'
    ) {
      continue;
    }
    for (const contract of collectAuthorizedContracts(entry.rootInvocation())) {
      if (contract === null || !allowed.has(contract)) {
        reject('it asks you to authorize a call to an unexpected contract');
      }
    }
  }

  return tx;
}
