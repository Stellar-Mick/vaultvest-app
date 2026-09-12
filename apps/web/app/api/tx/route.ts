import { NextRequest, NextResponse } from 'next/server';

import {
  buildApproveReleaseTx,
  buildCreateScheduleTx,
  buildRevokeTx,
  buildWithdrawTx,
  ContractCallError,
  type CreateScheduleParams,
} from '@vaultvest/sdk';

import { clientKey, rateLimit } from '@/lib/rate-limit';
import {
  MAX_BODY_BYTES,
  TxValidationError,
  validateTxRequest,
  type ValidatedCreateScheduleBody,
  type ValidatedTxRequest,
} from '@/lib/tx-request';

/**
 * POST /api/tx — builds a prepared, **unsigned** transaction for one of the four
 * VaultVest write calls and returns its base64 XDR for Freighter to sign
 * client-side. Nothing is signed or submitted here; the transaction is simulated
 * and prepared against Soroban RPC (auth entries, footprint, and resource fees
 * attached) so signing succeeds in the browser.
 *
 * The route dispatches to the SDK's typed builders (packages/sdk/src/contract.ts)
 * rather than re-encoding ScVal args ad hoc — those builders are verified against
 * the deployed contract and map reverts to typed {@link ContractCallError}s.
 *
 * Security posture of this endpoint:
 *  - It is public and unauthenticated, so every field is validated at runtime by
 *    `lib/tx-request.ts` before it reaches the SDK. The `as` casts that used to
 *    stand in for validation are gone; they were erased at runtime.
 *  - It is rate limited, because each call fans out into Soroban RPC and is
 *    therefore an amplification vector (`lib/rate-limit.ts`).
 *  - Failures are redacted. Contract reverts are returned as a numeric `code`
 *    only; raw errors from the RPC layer are logged server-side and replaced
 *    with a generic message, because they carry endpoint URLs and host
 *    diagnostics that the caller has no business seeing.
 *  - The XDR this route returns is **not trusted by the client**. The browser
 *    re-parses and checks it against the configured contract before handing it
 *    to the wallet (`lib/tx-guard.ts`), so a compromised or spoofed response
 *    cannot turn into a signature over an attacker's transaction.
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
 * Failure: 400 { error: { code?, message } } — `code` is the numeric contract
 *   error code when the contract rejected the call during simulation.
 *   429 { error: { message } } when rate limited.
 */

/** Requests permitted per client per window. */
const RATE_LIMIT = 20;
/** Rate-limit window length, in milliseconds. */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Matches a raw Soroban `Error(Contract, #N)` string inside an error message. */
const CONTRACT_ERROR_PATTERN = /Error\(\s*Contract\s*,\s*#(\d+)\s*\)/;

/**
 * Message returned for any failure that is not a contract revert or a
 * validation error. Deliberately uninformative: the underlying error is logged
 * server-side instead.
 */
const GENERIC_FAILURE =
  'Could not build the transaction. Check your inputs and try again.';

function errorResponse(
  message: string,
  status: number,
  code?: number,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { error: code === undefined ? { message } : { code, message } },
    { status, headers }
  );
}

function toCreateScheduleParams(
  body: ValidatedCreateScheduleBody
): CreateScheduleParams {
  // Every string below was pattern-checked and range-checked by
  // validateTxRequest, so BigInt() cannot throw here.
  return {
    funder: body.funder,
    beneficiary: body.beneficiary,
    token: body.token,
    totalAmount: BigInt(body.totalAmount),
    startTs: BigInt(body.startTs),
    endTs: BigInt(body.endTs),
    cliffTs: BigInt(body.cliffTs),
    signers: body.signers,
    threshold: body.threshold,
  };
}

async function buildXdr(request: ValidatedTxRequest): Promise<string> {
  switch (request.type) {
    case 'create_schedule':
      return (
        await buildCreateScheduleTx(toCreateScheduleParams(request.params))
      ).toXDR();
    case 'approve_release':
      return (
        await buildApproveReleaseTx(BigInt(request.scheduleId), request.signer)
      ).toXDR();
    case 'withdraw':
      return (
        await buildWithdrawTx(BigInt(request.scheduleId), request.caller)
      ).toXDR();
    case 'revoke':
      return (
        await buildRevokeTx(BigInt(request.scheduleId), request.caller)
      ).toXDR();
  }
}

/**
 * Turn a caught error into a client-safe response.
 *
 * Contract reverts keep their numeric code — the client maps codes to friendly
 * copy in `lib/errors.ts`, including the SEP-41 token trustline case (#13) that
 * previously depended on the raw error string being echoed back. The string
 * itself is never returned: `ContractCallError.message` can carry the full
 * `HostError: ...` diagnostic from the RPC, and non-contract errors can carry
 * the RPC endpoint and internal stack detail.
 */
function failureResponse(error: unknown): NextResponse {
  if (error instanceof TxValidationError) {
    // Authored by this app; safe to return verbatim.
    return errorResponse(error.message, 400);
  }
  if (error instanceof ContractCallError) {
    return errorResponse('The contract rejected this call.', 400, error.code);
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = CONTRACT_ERROR_PATTERN.exec(message);
  if (match) {
    // A revert from a nested contract (e.g. the SEP-41 token) that the SDK did
    // not map to a VaultVestError. Pass the code, drop the raw text.
    return errorResponse(
      'The contract rejected this call.',
      400,
      Number(match[1])
    );
  }
  console.error('[api/tx] transaction build failed', error);
  return errorResponse(GENERIC_FAILURE, 400);
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(
    clientKey(req.headers),
    RATE_LIMIT,
    RATE_LIMIT_WINDOW_MS
  );
  if (!limit.allowed) {
    return errorResponse(
      'Too many requests. Please wait a moment and try again.',
      429,
      undefined,
      { 'Retry-After': String(limit.retryAfterSeconds) }
    );
  }

  // Require an explicit JSON content type. Beyond catching malformed clients,
  // this rejects the "simple request" forms (text/plain, form encodings) that a
  // cross-origin page can submit without a CORS preflight.
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().split(';')[0].trim().endsWith('/json')) {
    return errorResponse('Content-Type must be application/json.', 415);
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse('Request body is too large.', 413);
  }

  let parsed: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return errorResponse('Request body is too large.', 413);
    }
    parsed = JSON.parse(text);
  } catch {
    return errorResponse('Invalid JSON body.', 400);
  }

  try {
    return NextResponse.json({ xdr: await buildXdr(validateTxRequest(parsed)) });
  } catch (error) {
    return failureResponse(error);
  }
}
