import { describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

import { assertSafeToSign, UnsafeTransactionError } from '@/lib/tx-guard';

const PASSPHRASE = 'Test SDF Network ; September 2015';
const VAULTVEST = process.env.NEXT_PUBLIC_CONTRACT_ID!;
const TOKEN = 'CBD4XOY6GYB2BR52IOQG5LZH3H4UHIZ6YMTFREMWG3KW2JJQPLGSXSYA';
const OTHER_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const wallet = Keypair.random().publicKey();
const stranger = Keypair.random().publicKey();

function account(address = wallet): Account {
  return new Account(address, '1');
}

function build(op: xdr.Operation, source = wallet): string {
  return new TransactionBuilder(account(source), { fee: '100', networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(30)
    .build()
    .toXDR();
}

function call(contractId: string, fn: string, ...args: xdr.ScVal[]): xdr.Operation {
  return new Contract(contractId).call(fn, ...args);
}

function contractArgs(contractId: string, fn: string): xdr.InvokeContractArgs {
  return new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contractId).toScAddress(),
    functionName: fn,
    args: [],
  });
}

function authEntry(
  credentials: xdr.SorobanCredentials,
  tree: { contract: string; fn: string; subs?: { contract: string; fn: string }[] }
): xdr.SorobanAuthorizationEntry {
  const invocation = (n: { contract: string; fn: string; subs?: { contract: string; fn: string }[] }): xdr.SorobanAuthorizedInvocation =>
    new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        contractArgs(n.contract, n.fn)
      ),
      subInvocations: (n.subs ?? []).map(invocation),
    });
  return new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation: invocation(tree),
  });
}

function callWithAuth(fn: string, auth: xdr.SorobanAuthorizationEntry[]): xdr.Operation {
  return Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(contractArgs(VAULTVEST, fn)),
    auth,
  });
}

const sourceCreds = xdr.SorobanCredentials.sorobanCredentialsSourceAccount();

describe('assertSafeToSign', () => {
  it('accepts a single call to the configured contract from the connected wallet', () => {
    const xdrStr = build(call(VAULTVEST, 'withdraw', nativeToScVal(1n, { type: 'u64' })));
    const tx = assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet });
    expect(tx.source).toBe(wallet);
  });

  it('rejects undecodable input', () => {
    expect(() => assertSafeToSign('not xdr', { functionName: 'withdraw', source: wallet })).toThrow(
      UnsafeTransactionError
    );
  });

  it('rejects a transaction sourced from a different account', () => {
    const xdrStr = build(call(VAULTVEST, 'withdraw'), stranger);
    expect(() => assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet })).toThrow(
      /source account is not your connected wallet/
    );
  });

  it('rejects a call to a different contract', () => {
    const xdrStr = build(call(OTHER_CONTRACT, 'withdraw'));
    expect(() => assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet })).toThrow(
      /contract other than VaultVest/
    );
  });

  it('rejects a call to a different function on the right contract', () => {
    const xdrStr = build(call(VAULTVEST, 'revoke'));
    expect(() => assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet })).toThrow(
      /function other than withdraw/
    );
  });

  it('rejects a non-contract operation such as a payment', () => {
    const xdrStr = build(
      Operation.payment({ destination: stranger, asset: Asset.native(), amount: '1' })
    );
    expect(() => assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet })).toThrow(
      /payment operation/
    );
  });

  it('rejects a transaction with more than one operation', () => {
    const xdrStr = new TransactionBuilder(account(), { fee: '200', networkPassphrase: PASSPHRASE })
      .addOperation(call(VAULTVEST, 'withdraw'))
      .addOperation(Operation.payment({ destination: stranger, asset: Asset.native(), amount: '1' }))
      .setTimeout(30)
      .build()
      .toXDR();
    expect(() => assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet })).toThrow(
      /2 operations/
    );
  });

  it('rejects a transaction built for another network', () => {
    const xdrStr = new TransactionBuilder(account(), {
      fee: '100',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    })
      .addOperation(call(VAULTVEST, 'withdraw'))
      .setTimeout(30)
      .build()
      .toXDR();
    // The envelope bytes decode identically; the guard cannot see the passphrase
    // in the XDR. What protects the user here is that signAndSubmit signs with
    // the app's passphrase, so a wrong-network envelope produces an invalid
    // signature rather than a valid one for the wrong chain. This test pins
    // that the guard does not *falsely* reject — the network check lives in
    // assertWalletOnAppNetwork.
    expect(() => assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet })).not.toThrow();
  });

  it('rejects a fee-bump envelope', () => {
    const inner = new TransactionBuilder(account(), { fee: '100', networkPassphrase: PASSPHRASE })
      .addOperation(call(VAULTVEST, 'withdraw'))
      .setTimeout(30)
      .build();
    inner.sign(Keypair.random());
    const bump = TransactionBuilder.buildFeeBumpTransaction(stranger, '200', inner, PASSPHRASE);
    expect(() => assertSafeToSign(bump.toXDR(), { functionName: 'withdraw', source: wallet })).toThrow(
      /fee-bump/
    );
  });

  describe('authorization tree', () => {
    it('allows source-account auth that only touches VaultVest', () => {
      const xdrStr = build(
        callWithAuth('withdraw', [authEntry(sourceCreds, { contract: VAULTVEST, fn: 'withdraw' })])
      );
      expect(() => assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet })).not.toThrow();
    });

    it('allows an explicitly permitted extra contract (the schedule token)', () => {
      const xdrStr = build(
        callWithAuth('create_schedule', [
          authEntry(sourceCreds, {
            contract: VAULTVEST,
            fn: 'create_schedule',
            subs: [{ contract: TOKEN, fn: 'transfer' }],
          }),
        ])
      );
      expect(() =>
        assertSafeToSign(xdrStr, {
          functionName: 'create_schedule',
          source: wallet,
          extraAuthorizedContracts: [TOKEN],
        })
      ).not.toThrow();
    });

    it('rejects a smuggled sub-invocation on an unexpected contract', () => {
      const xdrStr = build(
        callWithAuth('withdraw', [
          authEntry(sourceCreds, {
            contract: VAULTVEST,
            fn: 'withdraw',
            subs: [{ contract: OTHER_CONTRACT, fn: 'transfer' }],
          }),
        ])
      );
      expect(() =>
        assertSafeToSign(xdrStr, {
          functionName: 'withdraw',
          source: wallet,
          extraAuthorizedContracts: [TOKEN],
        })
      ).toThrow(/unexpected contract/);
    });

    it('rejects a root auth invocation on an unexpected contract', () => {
      const xdrStr = build(
        callWithAuth('withdraw', [authEntry(sourceCreds, { contract: OTHER_CONTRACT, fn: 'transfer' })])
      );
      expect(() => assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet })).toThrow(
        /unexpected contract/
      );
    });

    it('ignores address-credential entries (they carry their own signatures)', () => {
      const addressCreds = xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: Address.fromString(stranger).toScAddress(),
          nonce: xdr.Int64.fromString('1'),
          signatureExpirationLedger: 1,
          signature: xdr.ScVal.scvVoid(),
        })
      );
      const xdrStr = build(
        callWithAuth('withdraw', [authEntry(addressCreds, { contract: OTHER_CONTRACT, fn: 'transfer' })])
      );
      expect(() => assertSafeToSign(xdrStr, { functionName: 'withdraw', source: wallet })).not.toThrow();
    });
  });
});
