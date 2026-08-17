import { NextRequest, NextResponse } from 'next/server';

import {
  buildApproveReleaseTx,
  buildCreateScheduleTx,
  buildRevokeTx,
  buildWithdrawTx,
  ContractCallError,
  type CreateScheduleParams,
} from '@vaultvest/sdk';

/**
 * POST /api/tx — builds a prepared, **unsigned** transaction for one of the four
 * VaultVest write calls and returns its base64 XDR for Freighter to sign
 * client-side. Nothing is signed or submitted here; the transaction is simulated
 * and prepared against Soroban RPC (auth entries, footprint, and resource fees
 * attached) so signing succeeds in the browser.
 *
 * The route dispatches to the SDK's typed builders (packages/sdk/src/contract.ts)
 * rather than re-encoding ScVal args ad hoc — those builders are verified against
 * the deployed contract and map reverts to typed {@link ContractCallError}s,
 * which are returned to the client as structured JSON for the UI to display
 * (see commit 13's error mapping).
 *
 * Request body (JSON — integers travel as decimal strings since JSON has no
 * bigint):
 *   { type: 'create_schedule', params: { funder, beneficiary, token,
 *     totalAmount, startTs, endTs, cliffTs, signers, threshold } }
 *   { type: 'approve_release', scheduleId, signer }
 *   { type: 'withdraw', scheduleId, caller }
 *   { type: 'revoke', scheduleId, caller }
 *
 * Success: 200 { xdr }
 * Failure: 400 { error: { code?, message } } — `code` is a VaultVestError when the
 * contract rejected the call during simulation.
 */

/** Wire shape for create_schedule (integer fields as decimal strings). */
export interface CreateScheduleBody {
  funder: string;
  beneficiary: string;
  token: string;
  totalAmount: string;
  startTs: string;
  endTs: string;
  cliffTs: string;
  signers: string[];
  threshold: number;
}

export type TxRequestBody =
  | { type: 'create_schedule'; params: CreateScheduleBody }
  | { type: 'approve_release'; scheduleId: string; signer: string }
  | { type: 'withdraw'; scheduleId: string; caller: string }
  | { type: 'revoke'; scheduleId: string; caller: string };

function toU64(value: string, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer (got "${value}").`);
  }
}

function toCreateScheduleParams(body: CreateScheduleBody): CreateScheduleParams {
  return {
    funder: body.funder,
    beneficiary: body.beneficiary,
    token: body.token,
    totalAmount: toU64(body.totalAmount, 'totalAmount'),
    startTs: toU64(body.startTs, 'startTs'),
    endTs: toU64(body.endTs, 'endTs'),
    cliffTs: toU64(body.cliffTs, 'cliffTs'),
    signers: body.signers,
    threshold: body.threshold,
  };
}

export async function POST(req: NextRequest) {
  let body: TxRequestBody;
  try {
    body = (await req.json()) as TxRequestBody;
  } catch {
    return NextResponse.json(
      { error: { message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }

  try {
    let xdr: string;
    switch (body.type) {
      case 'create_schedule':
        xdr = (
          await buildCreateScheduleTx(toCreateScheduleParams(body.params))
        ).toXDR();
        break;
      case 'approve_release':
        xdr = (
          await buildApproveReleaseTx(
            toU64(body.scheduleId, 'scheduleId'),
            body.signer
          )
        ).toXDR();
        break;
      case 'withdraw':
        xdr = (
          await buildWithdrawTx(
            toU64(body.scheduleId, 'scheduleId'),
            body.caller
          )
        ).toXDR();
        break;
      case 'revoke':
        xdr = (
          await buildRevokeTx(
            toU64(body.scheduleId, 'scheduleId'),
            body.caller
          )
        ).toXDR();
        break;
      default:
        return NextResponse.json(
          {
            error: {
              message: `Unknown tx type: ${(body as { type?: unknown }).type}.`,
            },
          },
          { status: 400 }
        );
    }
    return NextResponse.json({ xdr });
  } catch (error) {
    if (error instanceof ContractCallError) {
      // Contract reverted during simulation — surface the typed VaultVest code
      // so the client can show a friendly message (never a raw XDR string).
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 400 }
      );
    }
    const message =
      error instanceof Error ? error.message : 'Unknown error building transaction.';
    return NextResponse.json({ error: { message } }, { status: 400 });
  }
}
