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
 * Map any thrown error to a user-facing message. Contract reverts (typed
 * {@link ContractCallError}) get their friendly copy; everything else falls back
 * to the raw error message.
 *
 * @param error - the caught error
 * @returns a message safe to show in the UI
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ContractCallError) {
    return VAULTVEST_ERROR_MESSAGES[error.code] ?? error.message;
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
    return VAULTVEST_ERROR_MESSAGES[error.code as VaultVestError];
  }
  return error.message ?? 'Failed to build transaction.';
}
