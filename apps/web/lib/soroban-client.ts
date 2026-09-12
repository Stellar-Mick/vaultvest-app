/**
 * soroban-client.ts — app-side wrapper around the shared SDK client
 * (packages/sdk). Centralizes the client instance and the post-submission
 * polling/error-decoding helpers used by the write flows.
 *
 * The client is initialized **lazily**: env vars are only read (and validated)
 * when a write flow actually runs, never at module load. This keeps the app
 * buildable and prerenderable without env vars present (e.g. in CI, where
 * `.env.local` does not exist) — see apps/web/.env.example for the required
 * `NEXT_PUBLIC_*` variables.
 */
import {
  contractErrorFromTransactionMeta,
  ContractCallError,
  SorobanClient,
  type SdkConfig,
} from '@vaultvest/sdk';

let client: SorobanClient | null = null;

/**
 * Build SDK config from Next.js env vars.
 *
 * IMPORTANT: Because the SDK lives in a workspace package (`packages/sdk`),
 * Next.js's `NEXT_PUBLIC_*` webpack replacement does NOT reach it —
 * `transpilePackages` transpiles but does not inject env values. We must
 * read `process.env` here (inside the Next.js project directory) where the
 * replacement DOES work, then pass the values to the SDK explicitly.
 */
function buildConfig(): SdkConfig {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  const networkPassphrase = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE;
  if (!contractId) {
    throw new Error(
      'Missing required env var NEXT_PUBLIC_CONTRACT_ID (deployed VaultVest contract address).'
    );
  }
  if (!rpcUrl) {
    throw new Error(
      'Missing required env var NEXT_PUBLIC_SOROBAN_RPC_URL (Soroban RPC endpoint).'
    );
  }
  if (!networkPassphrase) {
    throw new Error(
      'Missing required env var NEXT_PUBLIC_NETWORK_PASSPHRASE (network identifier for tx building).'
    );
  }
  return {
    contractId,
    rpcUrl,
    networkPassphrase,
    tokenContractId: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID,
  };
}

/**
 * Configured SDK client, constructed on first use.
 *
 * Call this instead of the SDK's own `getSorobanClient()` — the SDK reads
 * `process.env` directly, which Next.js does NOT replace inside workspace
 * packages (see {@link buildConfig}).
 *
 * This must stay a function. An eagerly-evaluated `export const` ran
 * {@link buildConfig} at module load, which threw during prerender whenever the
 * `NEXT_PUBLIC_*` vars were absent — defeating the lazy initialization this
 * module documents and breaking builds in environments without `.env.local`.
 *
 * @returns the shared client instance
 * @throws {Error} when required `NEXT_PUBLIC_*` env vars are missing
 */
export function getSdkClient(): SorobanClient {
  client ??= new SorobanClient(buildConfig());
  return client;
}

/** Parsed response of `rpc.Server.getTransaction`. */
type GetTransactionResponse = Awaited<
  ReturnType<SorobanClient['getTransaction']>
>;

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
): Promise<GetTransactionResponse> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const response = await getSdkClient().getTransaction(hash);
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
  response: GetTransactionResponse
): ContractCallError | null {
  // In @stellar/stellar-sdk 16.2.0 the parsed GetTransactionResponse already
  // carries resultMetaXdr as a decoded xdr.TransactionMeta.
  if (response.status === 'FAILED' && response.resultMetaXdr) {
    return contractErrorFromTransactionMeta(response.resultMetaXdr);
  }
  return null;
}
