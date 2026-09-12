import { describe, expect, it } from 'vitest';
import { ContractCallError, VaultVestError } from '@vaultvest/sdk';

import {
  apiErrorToMessage,
  getErrorMessage,
  TOKEN_CONTRACT_TRUSTLINE_ERROR_MESSAGE,
} from '@/lib/errors';

describe('apiErrorToMessage', () => {
  it('maps every VaultVest code to friendly copy, never the raw message', () => {
    for (const code of Object.values(VaultVestError).filter((v): v is number => typeof v === 'number')) {
      const msg = apiErrorToMessage({ code, message: 'HostError: Error(Contract, #1) leak' });
      expect(msg).not.toMatch(/HostError|leak/);
      expect(msg.length).toBeGreaterThan(10);
    }
  });

  it('maps ScheduleNotFound specifically', () => {
    expect(apiErrorToMessage({ code: VaultVestError.ScheduleNotFound })).toMatch(/not found/i);
  });

  it('maps the token trustline code (#13) whether numeric or embedded', () => {
    expect(apiErrorToMessage({ code: 13 })).toBe(TOKEN_CONTRACT_TRUSTLINE_ERROR_MESSAGE);
    expect(apiErrorToMessage({ message: 'x Error(Contract, #13) y' })).toBe(
      TOKEN_CONTRACT_TRUSTLINE_ERROR_MESSAGE
    );
  });

  it('falls back sensibly', () => {
    expect(apiErrorToMessage(undefined)).toMatch(/Failed to build/);
    expect(apiErrorToMessage({})).toMatch(/Failed to build/);
    expect(apiErrorToMessage({ message: 'Too many requests.' })).toBe('Too many requests.');
  });
});

describe('getErrorMessage', () => {
  it('uses the typed mapping for ContractCallError', () => {
    const err = new ContractCallError(VaultVestError.NotFunder, 'raw diagnostic');
    expect(getErrorMessage(err)).toMatch(/Only the funder/);
    expect(getErrorMessage(err)).not.toMatch(/raw diagnostic/);
  });

  it('detects the trustline revert in a plain Error', () => {
    expect(getErrorMessage(new Error('sim failed: Error(Contract, #13)'))).toBe(
      TOKEN_CONTRACT_TRUSTLINE_ERROR_MESSAGE
    );
  });

  it('never treats a typed VaultVest error as the trustline error', () => {
    // Code 13 is outside the enum, so a ContractCallError can never carry it;
    // a typed error whose *message* mentions #13 must still map by its code.
    const err = new ContractCallError(VaultVestError.ScheduleRevoked, 'Error(Contract, #13)');
    expect(getErrorMessage(err)).toMatch(/revoked/i);
  });

  it('handles non-Error throwables', () => {
    expect(getErrorMessage('boom')).toBe('Something went wrong.');
    expect(getErrorMessage(undefined)).toBe('Something went wrong.');
  });
});
