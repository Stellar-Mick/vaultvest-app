import { ContractCallError, VaultVestError } from '@vaultvest/sdk';

/**
 * User-facing messages for every VaultVestError code (Section 3 of the spec).
 * A raw XDR error string must never reach the user — the SDK maps contract
 * reverts to typed {@link ContractCallError}s and this module turns those into
 * friendly copy. Where a message depends on live state (e.g. how many signers
 * have approved), the page surfaces that state alongside (see
 * ApprovalProgress), keeping these messages accurate without re-deriving
 * contract logic.
 */
const VAULTVEST_ERROR_MESSAGES: Record<VaultVestError, string> = {
  [VaultVestError.InvalidThreshold]:
    'Invalid approval threshold — it must be between 1 and the number of signers.',
  [VaultVestError.InvalidTimeRange]:
    'Invalid time range — the end must be after the start, and the cliff must fall within the range.',
  [VaultVestError.InvalidAmount]:
    'Invalid amount — the total must be positive.',
  [VaultVestError.EmptySignerSet]:
    'The signer set cannot be empty — add at least one signer.',
  [VaultVestError.ScheduleNotFound]:
    'Schedule not found — double-check the schedule ID.',
  [VaultVestError.NotAuthorizedSigner]:
    'You are not an authorized signer for this schedule.',
  [VaultVestError.DuplicateApproval]:
    'You have already approved this release.',
  [VaultVestError.NothingVested]:
    'Nothing has vested yet — no tokens are withdrawable at this time.',
  [VaultVestError.ThresholdNotMet]:
    'Approval threshold not met — more signers need to approve before the beneficiary can withdraw.',
  [VaultVestError.ScheduleRevoked]:
    'This schedule has been revoked by its funder.',
  [VaultVestError.NotBeneficiary]:
    'Only the beneficiary can withdraw from this schedule.',
  [VaultVestError.NotFunder]:
    'Only the funder can revoke this schedule.',
};

/**
 * SEP-41 token contract error code for "trustline entry is missing for account".
 *
 * This is a *token-contract* error, NOT a VaultVestError: the VaultVestError
 * enum above spans only codes 1-12, so a `#13` revert can never come from the
 * VaultVest contract itself. It surfaces as a raw `Error(Contract, #13)` string
 * during `create_schedule` simulation, when the funder has no trustline for the
 * token being escrowed (the operation nests a call into the token contract).
 *
 * Deliberately kept OUT of VAULTVEST_ERROR_MESSAGES and handled in a separate
 * branch below so the code keeps the two rejection sources distinct: VaultVest
 * did not reject this call — the token contract did.
 */
export const TOKEN_CONTRACT_TRUSTLINE_ERROR_CODE = 13;

/** User-facing copy for the token-contract trustline error (see above). */
export const TOKEN_CONTRACT_TRUSTLINE_ERROR_MESSAGE =
  "Your account doesn't have a trustline for this token yet. Add a trustline before creating a schedule.";

/** Matches a raw Soroban `Error(Contract, #N)` string inside an error message. */
const CONTRACT_ERROR_PATTERN = /Error\(\s*Contract\s*,\s*#(\d+)\s*\)/;

/**
 * Detect a token-contract-level "trustline entry is missing" revert (code 13)
 * in a non-VaultVest error and return its user-facing message, or `null`.
 *
 * Typed {@link ContractCallError}s are VaultVest reverts (codes 1-12) and can
 * never carry code 13, so they short-circuit here — this branch only ever
 * handles errors that did NOT originate from the VaultVest contract.
 *
 * @param error - the caught error to inspect
 * @returns the trustline message, or `null` when this is not a token code-13 error
 */
function tokenTrustlineErrorMessage(error: unknown): string | null {
  if (error instanceof ContractCallError) {
    return null;
  }
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  const match = CONTRACT_ERROR_PATTERN.exec(message);
  if (!match || Number(match[1]) !== TOKEN_CONTRACT_TRUSTLINE_ERROR_CODE) {
    return null;
  }
  return TOKEN_CONTRACT_TRUSTLINE_ERROR_MESSAGE;
}

/**
 * Map any thrown error to a user-facing message. Contract reverts (typed
 * {@link ContractCallError}) get their friendly copy; everything else falls back
 * to the raw error message.
 *
 * @param error - the caught error
 * @returns a message safe to show in the UI
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ContractCallError) {
    // VaultVest rejected the call (codes 1-12) — use its typed mapping.
    return VAULTVEST_ERROR_MESSAGES[error.code] ?? error.message;
  }
  // Not a VaultVest revert — check the token-contract-level trustline error
  // (code 13) before falling back to the raw message.
  if (tokenTrustlineErrorMessage(error) !== null) {
    return TOKEN_CONTRACT_TRUSTLINE_ERROR_MESSAGE;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * Map the structured error returned by POST /api/tx to a user-facing message.
 * The route returns `{ error: { code, message } }` where `code` is a
 * VaultVestError when the contract rejected the call during simulation.
 *
 * @param error - the `error` field of the API response body
 * @returns a message safe to show in the UI
 */
export function apiErrorToMessage(
  error: { code?: number; message?: string } | undefined
): string {
  if (!error) {
    return 'Failed to build transaction.';
  }
  if (error.code !== undefined && error.code in VAULTVEST_ERROR_MESSAGES) {
    // VaultVest rejected the call (codes 1-12).
    return VAULTVEST_ERROR_MESSAGES[error.code as VaultVestError];
  }
  // Token-contract-level errors live outside the VaultVestError range and get
  // their own branch (see TOKEN_CONTRACT_TRUSTLINE_ERROR_CODE). Code 13 may
  // arrive as a numeric `code` or embedded in the raw `message`.
  if (
    error.code === TOKEN_CONTRACT_TRUSTLINE_ERROR_CODE ||
    tokenTrustlineErrorMessage(error.message) !== null
  ) {
    return TOKEN_CONTRACT_TRUSTLINE_ERROR_MESSAGE;
  }
  return error.message ?? 'Failed to build transaction.';
}
