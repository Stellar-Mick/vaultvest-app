/**
 * client.ts — thin Soroban RPC client wrapper for the deployed VaultVest contract.
 *
 * Responsibilities:
 *  - Read SDK configuration from environment variables (Section 6 of the spec) and
 *    fail fast with a descriptive error when a required variable is missing.
 *  - Wrap `rpc.Server` primitives (`simulate`, `prepare`, `send`, `getAccount`) so
 *    contract reverts surface as typed {@link ContractCallError}s instead of raw
 *    XDR strings.
 *  - Provide the transaction-building helper shared by read-only and write calls.
 *
 * Verified against @stellar/stellar-sdk 16.2.0:
 *  - `simulateTransaction` returns a parsed response; a failed simulation has a
 *    top-level `error` string (detectable via `rpc.Api.isSimulationError`), e.g.
 *    `"Error(Contract, #5)"`.
 *  - `prepareTransaction` throws a plain `Error` whose `.message` carries that same
 *    string when the simulation fails.
 *  - Post-submission execution failures carry the numeric contract error code in the
 *    diagnostic events of `TransactionMeta` (protocol 20 has no dedicated
 *    `contractError` case on `InvokeHostFunctionResult`), decoded by
 *    {@link contractErrorFromTransactionMeta}.
 */
import {
  Account,
  Contract,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

import {
  ContractCallError,
  VaultVestError,
  vaultVestErrorFromCode,
} from './types.js';

/**
 * Public address of a disposable testnet account used as the *simulation source*
 * for read-only calls. Read-only simulation requires the source account to exist
 * on-chain (for its sequence number) but does not require it to hold funds or sign
 * anything. This account was created via friendbot and holds no funds; its secret
 * key was discarded. If it ever ceases to exist (testnet reset), the client falls
 * back to funding a fresh ephemeral account via the RPC's friendbot.
 */
export const READ_ONLY_SOURCE_ACCOUNT =
  'GDP7WSRTOREL4ZZDGDVVWT2RHMM67OSEBUM4XZUPHU5ONVLLXDDYNQYZ';

/** Environment-driven configuration for the SDK (see Section 6 of the spec). */
export interface SdkConfig {
  /** Deployed VaultVest contract address (C...). */
  contractId: string;
  /** Soroban RPC endpoint, e.g. https://soroban-testnet.stellar.org. */
  rpcUrl: string;
  /** Network passphrase used when building transactions. */
  networkPassphrase: string;
  /** Optional SEP-41 token contract address used for demo vesting schedules. */
  tokenContractId?: string;
}

/**
 * Read SDK configuration from the environment, throwing a descriptive error if a
 * required variable is missing. Nothing is hardcoded in source — all values come
 * from `process.env` (Next.js inlines `NEXT_PUBLIC_*` into browser bundles).
 *
 * @param env - environment map; defaults to `process.env` (overridable for tests)
 * @returns validated {@link SdkConfig}
 * @throws {Error} if `NEXT_PUBLIC_CONTRACT_ID`, `NEXT_PUBLIC_SOROBAN_RPC_URL`, or
 *   `NEXT_PUBLIC_NETWORK_PASSPHRASE` is missing
 */
export function getSdkConfig(
  env: Record<string, string | undefined> = process.env
): SdkConfig {
  const contractId = env.NEXT_PUBLIC_CONTRACT_ID;
  const rpcUrl = env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  const networkPassphrase = env.NEXT_PUBLIC_NETWORK_PASSPHRASE;
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
    tokenContractId: env.NEXT_PUBLIC_TOKEN_CONTRACT_ID,
  };
}

/** Matches `Error(Contract, #N)` as returned by failed Soroban simulations. */
const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

/**
 * Pull a human-readable message out of the various error shapes the SDK and RPC
 * layer can throw or return (strings, `Error`s, and axios-style `{ response }`
 * payloads).
 *
 * @param error - any thrown/returned error value
 * @returns the extracted message, or `null` if nothing usable was found
 */
export function extractErrorMessage(error: unknown): string | null {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const candidates: unknown[] = [obj.error, obj.message];
    const response = obj.response;
    if (response !== null && typeof response === 'object') {
      const resp = response as Record<string, unknown>;
      candidates.push(resp.error, resp.message);
      const result = resp.result;
      if (result !== null && typeof result === 'object') {
        candidates.push((result as Record<string, unknown>).error);
      }
    }
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Map any thrown/returned error to a typed {@link ContractCallError} when it
 * carries a `Error(Contract, #N)` string with a known {@link VaultVestError} code.
 *
 * @param error - the error to inspect
 * @returns a typed {@link ContractCallError}, or `null` when the error is not a
 *   recognizable VaultVest contract revert
 */
export function parseContractError(error: unknown): ContractCallError | null {
  if (error instanceof ContractCallError) {
    return error;
  }
  const message = extractErrorMessage(error);
  if (!message) {
    return null;
  }
  const match = CONTRACT_ERROR_PATTERN.exec(message);
  if (!match) {
    return null;
  }
  const code = vaultVestErrorFromCode(Number(match[1]));
  if (code === undefined) {
    return null;
  }
  return new ContractCallError(code, message.trim());
}

/**
 * Throw a typed {@link ContractCallError} when a simulation response indicates a
 * failed invocation; otherwise narrow the response to the success shape.
 *
 * @param sim - parsed simulation response from `rpc.Server.simulateTransaction`
 * @throws {ContractCallError} when the simulation failed with a known VaultVest
 *   error code
 * @throws {Error} when the simulation failed for another reason (raw error kept)
 */
export function throwIfSimulationError(
  sim: rpc.Api.SimulateTransactionResponse
): asserts sim is rpc.Api.SimulateTransactionSuccessResponse {
  if (!rpc.Api.isSimulationError(sim)) {
    return;
  }
  const mapped = parseContractError(sim.error);
  if (mapped) {
    throw mapped;
  }
  throw new Error(`Soroban simulation failed: ${sim.error}`);
}

/**
 * Decode the numeric contract error code from the diagnostic events of a failed
 * transaction's meta, when present. Protocol 20 carries contract reverts only in
 * diagnostics — `InvokeHostFunctionResult` has no dedicated `contractError` case —
 * so this is the post-submission counterpart to {@link parseContractError}.
 *
 * @param meta - parsed `TransactionMeta` from `GetTransactionResponse.resultMetaXdr`
 * @returns a typed {@link ContractCallError}, or `null` if no VaultVest error code
 *   is present or the meta shape is unexpected
 */
export function contractErrorFromTransactionMeta(
  meta: xdr.TransactionMeta
): ContractCallError | null {
  try {
    const sorobanMeta = meta.v3()?.sorobanMeta();
    if (!sorobanMeta) {
      return null;
    }
    for (const diagnostic of sorobanMeta.diagnosticEvents()) {
      if (diagnostic.inSuccessfulContractCall()) {
        continue;
      }
      const data = diagnostic.event().body().v0().data();
      if (data.switch() !== xdr.ScValType.scvError()) {
        continue;
      }
      const scError = data.error();
      if (scError.switch() !== xdr.ScErrorType.sceContract()) {
        continue;
      }
      const code = vaultVestErrorFromCode(scError.contractCode());
      if (code !== undefined) {
        return new ContractCallError(code);
      }
    }
  } catch {
    // Meta shapes vary across protocol versions; treat anything unexpected as
    // unmappable rather than crashing the caller.
  }
  return null;
}

/** Options for {@link SorobanClient.buildTransaction}. */
export interface BuildTransactionOptions {
  /** Base fee in stroops; defaults to '1000' for write calls. */
  fee?: string;
  /** Timeout in seconds; defaults to 30. */
  timeout?: number;
}

/**
 * Soroban RPC wrapper around the deployed VaultVest contract. Instances are cheap;
 * use {@link getSorobanClient} for the shared default, or construct directly with a
 * custom {@link SdkConfig} (e.g. in tests).
 */
export class SorobanClient {
  /** Underlying `rpc.Server` for low-level access when needed. */
  readonly server: rpc.Server;
  /** `Contract` handle bound to the deployed VaultVest contract. */
  readonly contract: Contract;
  /** Deployed VaultVest contract address (C...). */
  readonly contractId: string;
  /** Network passphrase used when building transactions. */
  readonly networkPassphrase: string;

  private readOnlyAccountCache: Account | null = null;

  /**
   * @param config - SDK configuration; defaults to environment variables via
   *   {@link getSdkConfig}
   * @throws {Error} when required env vars are missing
   */
  constructor(config: SdkConfig = getSdkConfig()) {
    this.server = new rpc.Server(config.rpcUrl);
    this.contractId = config.contractId;
    this.contract = new Contract(config.contractId);
    this.networkPassphrase = config.networkPassphrase;
  }

  /**
   * Fetch an account's current state (sequence number) from the network.
   *
   * @param address - G... account address
   * @returns the account with its current sequence number
   * @throws {Error} if the account does not exist on-chain
   */
  async getAccount(address: string): Promise<Account> {
    return this.server.getAccount(address);
  }

  /**
   * Build an unsigned transaction containing a single contract-call operation.
   *
   * @param source - the source account (must exist on-chain for its sequence number)
   * @param operation - the operation to include (typically `contract.call(...)`)
   * @param options - fee and timeout overrides
   * @returns an unsigned, un-prepared `Transaction`
   */
  buildTransaction(
    source: Account,
    operation: xdr.Operation<Operation.InvokeHostFunction>,
    options: BuildTransactionOptions = {}
  ): Transaction {
    return new TransactionBuilder(source, {
      fee: options.fee ?? '1000',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(options.timeout ?? 30)
      .build();
  }

  /**
   * Simulate a transaction against the contract, throwing typed errors on revert.
   *
   * @param tx - the transaction to simulate
   * @returns the successful simulation response (with `result.retval` available)
   * @throws {ContractCallError} when the call reverts with a known VaultVest code
   * @throws {Error} when the simulation fails for another reason
   */
  async simulate(
    tx: Transaction
  ): Promise<rpc.Api.SimulateTransactionSuccessResponse> {
    const sim = await this.server.simulateTransaction(tx);
    throwIfSimulationError(sim);
    return sim;
  }

  /**
   * Prepare a transaction (attach auth, footprint, and resource fees from
   * simulation), throwing typed errors when the simulation reverts.
   *
   * @param tx - the transaction to prepare (exactly one host-function op)
   * @returns the prepared transaction, ready for signing
   * @throws {ContractCallError} when the call reverts with a known VaultVest code
   * @throws {Error} when preparation fails for another reason
   */
  async prepare(tx: Transaction): Promise<Transaction> {
    try {
      return await this.server.prepareTransaction(tx);
    } catch (error) {
      const mapped = parseContractError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }

  /**
   * Submit a signed transaction to the network. Note that Soroban RPC only
   * enqueues the transaction; poll {@link getTransaction} for the final result.
   *
   * @param tx - the signed transaction to submit
   * @returns the send response
   * @throws {ContractCallError} when the network rejects the submission with a
   *   known VaultVest code
   * @throws {Error} when the submission is rejected for another reason
   */
  async send(tx: Transaction): Promise<rpc.Api.SendTransactionResponse> {
    const response = await this.server.sendTransaction(tx);
    if (response.status === 'ERROR') {
      const mapped = parseContractError(response.errorResult);
      if (mapped) {
        throw mapped;
      }
      throw new Error(
        `Transaction rejected by network (status ${response.status}). ` +
          'Poll getTransaction for execution details.'
      );
    }
    return response;
  }

  /**
   * Fetch the final status of a submitted transaction.
   *
   * @param hash - transaction hash returned by {@link send}
   * @returns the transaction status response
   */
  async getTransaction(
    hash: string
  ): Promise<rpc.Api.GetTransactionResponse> {
    return this.server.getTransaction(hash);
  }

  /**
   * Resolve an account to use as the source for read-only simulations (which need
   * an existing account for its sequence number but never sign). Uses the
   * well-known {@link READ_ONLY_SOURCE_ACCOUNT} constant, falling back to funding
   * a fresh ephemeral account via friendbot if that account no longer exists.
   * Cached after the first successful resolution.
   *
   * @returns an account usable as the source of read-only calls
   * @throws {Error} if no source account can be resolved
   */
  async getReadOnlyAccount(): Promise<Account> {
    if (this.readOnlyAccountCache) {
      return this.readOnlyAccountCache;
    }
    try {
      this.readOnlyAccountCache =
        await this.server.getAccount(READ_ONLY_SOURCE_ACCOUNT);
      return this.readOnlyAccountCache;
    } catch {
      try {
        // Read-only simulation does not require funds, only existence. If the
        // constant account is gone (e.g. after a testnet reset), fund a fresh
        // disposable one via the network's friendbot.
        const keypair = Keypair.random();
        this.readOnlyAccountCache = await this.server.requestAirdrop(
          keypair.publicKey()
        );
        return this.readOnlyAccountCache;
      } catch (faucetError) {
        throw new Error(
          `Could not resolve a source account for read-only calls: ` +
            `failed to load ${READ_ONLY_SOURCE_ACCOUNT} and friendbot funding failed.`,
          { cause: faucetError }
        );
      }
    }
  }
}

let defaultClient: SorobanClient | null = null;

/**
 * Shared default {@link SorobanClient} configured from environment variables.
 * Constructed lazily on first use so missing env vars only fail when the SDK is
 * actually exercised.
 *
 * @returns the shared client instance
 * @throws {Error} when required env vars are missing
 */
export function getSorobanClient(): SorobanClient {
  defaultClient ??= new SorobanClient();
  return defaultClient;
}
