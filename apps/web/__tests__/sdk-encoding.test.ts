import { describe, expect, it } from 'vitest';
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { encodeApprovalKind, VaultVestError, vaultVestErrorFromCode } from '@vaultvest/sdk';

describe('encodeApprovalKind', () => {
  it('encodes unit enum variants as a one-symbol vec, as Soroban expects', () => {
    for (const kind of ['Release', 'Revoke'] as const) {
      const scv = encodeApprovalKind(kind);
      expect(scv.switch()).toBe(xdr.ScValType.scvVec());
      const native = scValToNative(scv);
      expect(native).toEqual([kind]);
    }
  });
});

describe('VaultVestError codes', () => {
  it('knows the new contract codes and leaves 13-19 unassigned', () => {
    expect(vaultVestErrorFromCode(20)).toBe(VaultVestError.DuplicateSigner);
    expect(vaultVestErrorFromCode(21)).toBe(VaultVestError.TooManySigners);
    // 13 is the SAC trustline error and must never resolve to a VaultVest code.
    for (let c = 13; c <= 19; c++) {
      expect(vaultVestErrorFromCode(c)).toBeUndefined();
    }
  });
});
