/**
 * write-flow.ts — the one path every write goes through.
 *
 *   POST /api/tx  →  verify XDR in-browser  →  Freighter sign  →  submit  →  poll
 *
 * Create, Approve, Withdraw, and Revoke all follow this sequence; centralising
 * it means the security checks in `signAndSubmit` cannot be skipped by a page
 * that wires things up slightly differently, and a new write call is a
 * one-line addition rather than a copied block.
 */
import type { rpc } from '@stellar/stellar-sdk';

import { apiErrorToMessage } from '@/lib/errors';
import { signAndSubmit, type ConnectedWallet } from '@/lib/freighter';
import {
  contractErrorFromFinalizedTx,
  waitForTransaction,
} from '@/lib/soroban-client';
import type { TxExpectation } from '@/lib/tx-guard';

/** Wire body accepted by POST /api/tx (see apps/web/lib/tx-request.ts). */
export type TxRequestBody =
  | {
      type: 'create_schedule';
      params: {
        funder: string;
        beneficiary: string;
        token: string;
        totalAmount: string;
        startTs: string;
        endTs: string;
        cliffTs: string;
        signers: string[];
        threshold: number;
      };
    }
  | { type: 'approve_release'; scheduleId: string; signer: string }
  | { type: 'approve_revoke'; scheduleId: string; signer: string }
  | { type: 'withdraw'; scheduleId: string; caller: string }
  | { type: 'revoke'; scheduleId: string; caller: string };

export interface WriteResult {
  /** Transaction hash, for explorer links. */
  hash: string;
  /** Finalized transaction; `returnValue` carries the contract's return. */
  finalized: rpc.Api.GetSuccessfulTransactionResponse;
}

/**
 * Run a write call end to end and resolve only once it has succeeded on-chain.
 *
 * @param body - request for /api/tx
 * @param wallet - the connected wallet; must be the tx source
 * @param expectation - what the returned XDR must invoke (see tx-guard.ts)
 * @returns the hash and finalized transaction
 * @throws {Error} with a user-facing message when the API rejects the request
 * @throws {UnsafeTransactionError} when the returned XDR fails verification
 * @throws {ContractCallError} when the contract reverts on-chain with a known code
 * @throws {Error} on signing, submission, or timeout failures
 */
export async function submitWrite(
  body: TxRequestBody,
  wallet: ConnectedWallet,
  expectation: Omit<TxExpectation, 'source'>
): Promise<WriteResult> {
  const response = await fetch('/api/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as {
    xdr?: string;
    error?: { code?: number; message?: string };
  };
  if (!response.ok || !data.xdr) {
    throw new Error(apiErrorToMessage(data.error));
  }

  const { hash } = await signAndSubmit(data.xdr, wallet, expectation);
  const finalized = await waitForTransaction(hash);
  if (finalized.status !== 'SUCCESS') {
    throw contractErrorFromFinalizedTx(finalized) ?? new Error('Transaction failed on-chain.');
  }
  return { hash, finalized };
}
