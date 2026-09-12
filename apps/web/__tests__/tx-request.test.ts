import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';

import { MAX_SIGNERS, TxValidationError, validateTxRequest } from '@/lib/tx-request';

const G = () => Keypair.random().publicKey();
const TOKEN = 'CBD4XOY6GYB2BR52IOQG5LZH3H4UHIZ6YMTFREMWG3KW2JJQPLGSXSYA';

function validCreate() {
  return {
    type: 'create_schedule',
    params: {
      funder: G(),
      beneficiary: G(),
      token: TOKEN,
      totalAmount: '1000000000',
      startTs: '1700000000',
      endTs: '1800000000',
      cliffTs: '1750000000',
      signers: [G(), G()],
      threshold: 2,
    },
  };
}

describe('validateTxRequest', () => {
  it('accepts a well-formed create_schedule', () => {
    const body = validCreate();
    const out = validateTxRequest(body);
    expect(out.type).toBe('create_schedule');
    if (out.type === 'create_schedule') {
      expect(out.params.signers).toHaveLength(2);
      expect(out.params.threshold).toBe(2);
    }
  });

  it('accepts the three id-based calls', () => {
    const signer = G();
    expect(validateTxRequest({ type: 'approve_release', scheduleId: '7', signer })).toEqual({
      type: 'approve_release',
      scheduleId: '7',
      signer,
    });
    expect(validateTxRequest({ type: 'withdraw', scheduleId: '0', caller: signer }).type).toBe('withdraw');
    expect(validateTxRequest({ type: 'revoke', scheduleId: '18446744073709551615', caller: signer }).type).toBe(
      'revoke'
    );
  });

  it('rejects non-object bodies and unknown types without echoing them', () => {
    expect(() => validateTxRequest(null)).toThrow(TxValidationError);
    expect(() => validateTxRequest('x')).toThrow(TxValidationError);
    expect(() => validateTxRequest({ type: '<script>' })).toThrow(/Unknown transaction type/);
    expect(() => validateTxRequest({ type: '<script>' })).not.toThrow(/<script>/);
  });

  it('rejects malformed addresses', () => {
    expect(() => validateTxRequest({ type: 'withdraw', scheduleId: '1', caller: 'GABC' })).toThrow(
      /valid Stellar account address/
    );
    const body = validCreate();
    body.params.token = 'G' + body.params.funder.slice(1); // an account, not a contract
    expect(() => validateTxRequest(body)).toThrow(/contract address/);
  });

  it('rejects integer strings BigInt would otherwise accept', () => {
    const base = { type: 'withdraw', caller: G() };
    for (const bad of ['0x10', '1e5', ' 1', '1 ', '-1', '+1', '1.0', '', '01']) {
      expect(() => validateTxRequest({ ...base, scheduleId: bad }), bad).toThrow(TxValidationError);
    }
  });

  it('rejects scheduleId above u64', () => {
    expect(() =>
      validateTxRequest({ type: 'withdraw', scheduleId: '18446744073709551616', caller: G() })
    ).toThrow(/out of range/);
  });

  it('rejects a zero amount and one above i128', () => {
    const zero = validCreate();
    zero.params.totalAmount = '0';
    expect(() => validateTxRequest(zero)).toThrow(/greater than zero/);
    const huge = validCreate();
    huge.params.totalAmount = '170141183460469231731687303715884105728'; // 2^127
    expect(() => validateTxRequest(huge)).toThrow(/out of range/);
  });

  it('caps the signer set', () => {
    const body = validCreate();
    body.params.signers = Array.from({ length: MAX_SIGNERS + 1 }, G);
    body.params.threshold = 1;
    expect(() => validateTxRequest(body)).toThrow(new RegExp(`at most ${MAX_SIGNERS}`));
  });

  it('rejects an empty signer set', () => {
    const body = validCreate();
    body.params.signers = [];
    expect(() => validateTxRequest(body)).toThrow(/at least one signer/);
  });

  it('bounds threshold to [1, signers.length] and requires an integer', () => {
    for (const t of [0, 3, 1.5, -1, '2' as unknown as number, NaN]) {
      const body = validCreate();
      body.params.threshold = t;
      expect(() => validateTxRequest(body), String(t)).toThrow(/threshold/);
    }
  });

  it('rejects a non-array signers field', () => {
    const body = validCreate();
    (body.params as { signers: unknown }).signers = 'GABC,GDEF';
    expect(() => validateTxRequest(body)).toThrow(/must be an array/);
  });
});
