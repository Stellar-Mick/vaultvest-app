/**
 * soroban-client.ts — app-side wrapper around the shared SDK client
 * (packages/sdk). Centralizes the client instance and the post-submission
 * polling/error-decoding helpers used by the write flows.
 *
 * The SDK reads its configuration from `NEXT_PUBLIC_*` env vars (see
 * apps/web/.env.example), so no addresses or URLs are hardcoded here.
 */
import {
  contractErrorFromTransactionMeta,
  ContractCallError,
  getSorobanClient,
} from '@vaultvest/sdk';

/** Shared SDK client, configured from env vars. */
export const sorobanClient = getSorobanClient();

/** Finalized transaction statuses from `getTransaction`. */
export type FinalizedTxStatus = 'SUCCESS' | 'FAILED';

/**
 * Poll `getTransaction` until a submitted transaction finalizes.
 *
 * @param hash - transaction hash from `signAndSubmit`
 * @param attempts - max poll attempts (default 12)
 * @param intervalMs - delay between polls (default 3000)
 * @returns the finalized `GetTransactionResponse`
 * @throws {Error} if the transaction does not finalize in time
 */
export async function waitForTransaction(
  hash: string,
  attempts = 12,
  intervalMs = 3000
): Promise<Awaited<ReturnType<typeof sorobanClient.getTransaction>>> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const response = await sorobanClient.getTransaction(hash);
    // In @stellar/stellar-sdk 16.2.0 the parsed GetTransactionStatus is
    // SUCCESS | NOT_FOUND | FAILED (no PENDING): NOT_FOUND means the tx is not
    // visible yet, so keep waiting; SUCCESS/FAILED are final.
    if (response.status !== 'NOT_FOUND') {
      return response;
    }
  }
  throw new Error('Transaction did not finalize in time.');
}

/**
 * Decode a VaultVest contract error from a failed transaction's meta, if the
 * meta carries one. Returns `null` when the failure is not a VaultVest revert.
 *
 * @param response - finalized `GetTransactionResponse`
 * @returns a typed {@link ContractCallError}, or `null`
 */
export function contractErrorFromFinalizedTx(
  response: Awaited<ReturnType<typeof sorobanClient.getTransaction>>
): ContractCallError | null {
  // In @stellar/stellar-sdk 16.2.0 the parsed GetTransactionResponse already
  // carries resultMetaXdr as a decoded xdr.TransactionMeta.
  if (response.status === 'FAILED' && response.resultMetaXdr) {
    return contractErrorFromTransactionMeta(response.resultMetaXdr);
  }
  return null;
}
