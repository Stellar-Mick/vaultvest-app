import { describe, expect, it } from 'vitest';
import { formatTokenAmount } from '@vaultvest/sdk';

import { explorerAddressUrl, explorerTxUrl, NETWORK_LABEL, shorten } from '@/lib/explorer';
import { formatDuration } from '@/lib/format';

describe('formatTokenAmount', () => {
  it('scales by decimals and groups thousands', () => {
    expect(formatTokenAmount(12505000000n, 7)).toBe('1,250.5');
    expect(formatTokenAmount(1000000000n, 7)).toBe('100');
    expect(formatTokenAmount(1n, 7)).toBe('0.0000001');
    expect(formatTokenAmount(0n, 7)).toBe('0');
  });

  it('handles zero decimals and negatives', () => {
    expect(formatTokenAmount(1234567n, 0)).toBe('1,234,567');
    expect(formatTokenAmount(-12500000n, 6)).toBe('-12.5');
  });

  it('does not lose precision above 2^53', () => {
    // 2^80 raw units at 7 decimals — Number() would mangle these digits.
    expect(formatTokenAmount(1208925819614629174706176n, 7)).toBe('120,892,581,961,462,917.4706176');
  });

  it('caps fraction digits when asked', () => {
    expect(formatTokenAmount(12345678n, 7, { maxFractionDigits: 2 })).toBe('1.23');
    expect(formatTokenAmount(10000000n, 7, { maxFractionDigits: 2 })).toBe('1');
  });
});

describe('explorer', () => {
  it('derives the network from the configured passphrase', () => {
    expect(NETWORK_LABEL).toBe('Testnet');
    expect(explorerTxUrl('abc')).toBe('https://stellar.expert/explorer/testnet/tx/abc');
  });

  it('picks account vs contract by prefix', () => {
    expect(explorerAddressUrl('GABC')).toContain('/account/GABC');
    expect(explorerAddressUrl('CABC')).toContain('/contract/CABC');
  });

  it('shortens long values and leaves short ones alone', () => {
    expect(shorten('GBXDABCDEFGHIJKLMNOP1234', 4, 4)).toBe('GBXD…1234');
    expect(shorten('short')).toBe('short');
  });
});

describe('formatDuration', () => {
  it('shows the two most significant units', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(formatDuration(90_000)).toBe('1d 1h');
    expect(formatDuration(86_400 * 3)).toBe('3d');
  });
});
