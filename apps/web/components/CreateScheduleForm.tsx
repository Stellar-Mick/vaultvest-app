'use client';

import { useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { StrKey } from '@stellar/stellar-sdk';

import { WalletConnectButton } from '@/components/WalletConnectButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorToMessage, getErrorMessage } from '@/lib/errors';
import {
  signAndSubmit,
  type ConnectedWallet,
} from '@/lib/freighter';
import {
  contractErrorFromFinalizedTx,
  waitForTransaction,
} from '@/lib/soroban-client';

/** Default SEP-41 token for demo schedules (from env, inlined at build time). */
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? '';

function isValidAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address.trim());
}

/** Convert a datetime-local input value to unix seconds, or NaN when invalid. */
function toUnixSeconds(datetimeLocal: string): number {
  const millis = Date.parse(datetimeLocal);
  return Number.isNaN(millis) ? NaN : Math.floor(millis / 1000);
}

function parseSigners(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Funder flow: create a vesting schedule. The funder connects their wallet,
 * fills in the schedule parameters, and the unsigned transaction is built by
 * POST /api/tx (which simulates it against the contract), signed by Freighter
 * in the browser, and submitted. Contract reverts surface as typed errors
 * (commit 13 maps them to friendly copy).
 *
 * This form only collects parameters and drives the flow — all schedule
 * semantics (threshold, time range, amounts) are enforced by the contract.
 */
export function CreateScheduleForm() {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [beneficiary, setBeneficiary] = useState('');
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [totalAmount, setTotalAmount] = useState('');
  const [startTs, setStartTs] = useState('');
  const [endTs, setEndTs] = useState('');
  const [cliffTs, setCliffTs] = useState('');
  const [signers, setSigners] = useState('');
  const [threshold, setThreshold] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successHash, setSuccessHash] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!wallet) return 'Connect your wallet first.';
    if (!isValidAddress(beneficiary)) return 'Beneficiary must be a valid G... address.';
    if (!token || !token.startsWith('C')) return 'Token must be a valid C... contract address.';
    const amount = Number(totalAmount);
    if (!Number.isFinite(amount) || amount <= 0) return 'Total amount must be a positive number.';
    const start = toUnixSeconds(startTs);
    const end = toUnixSeconds(endTs);
    const cliff = toUnixSeconds(cliffTs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(cliff)) {
      return 'Start, end, and cliff times must be valid dates.';
    }
    if (end <= start) return 'End time must be after start time.';
    if (cliff < start) return 'Cliff time must be on or after start time.';
    const signerList = parseSigners(signers);
    if (signerList.length === 0) return 'Add at least one signer (comma-separated G... addresses).';
    if (signerList.some((s) => !isValidAddress(s))) return 'One or more signers are not valid G... addresses.';
    const t = Number(threshold);
    if (!Number.isInteger(t) || t < 1) return 'Threshold must be a positive integer.';
    if (t > signerList.length) return 'Threshold cannot exceed the number of signers.';
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessHash(null);

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (!wallet) return;

    setSubmitting(true);
    try {
      const start = toUnixSeconds(startTs);
      const end = toUnixSeconds(endTs);
      const cliff = toUnixSeconds(cliffTs);
      const response = await fetch('/api/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'create_schedule',
          params: {
            funder: wallet.address,
            beneficiary: beneficiary.trim(),
            token: token.trim(),
            totalAmount: String(totalAmount.trim()),
            startTs: String(start),
            endTs: String(end),
            cliffTs: String(cliff),
            signers: parseSigners(signers),
            threshold: Number(threshold),
          },
        }),
      });
      const data = (await response.json()) as {
        xdr?: string;
        error?: { code?: number; message?: string };
      };
      if (!response.ok || !data.xdr) {
        throw new Error(apiErrorToMessage(data.error));
      }

      const { hash } = await signAndSubmit(data.xdr, wallet.networkPassphrase);
      const finalized = await waitForTransaction(hash);
      if (finalized.status !== 'SUCCESS') {
        const mapped = contractErrorFromFinalizedTx(finalized);
        throw mapped ?? new Error('Transaction failed on-chain.');
      }
      setSuccessHash(hash);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New vesting schedule</CardTitle>
        <CardDescription>
          Escrow tokens into a governance-gated vesting schedule. Signing happens
          in your wallet; nothing is stored server-side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-4 w-4" />
            {wallet ? `Funder: ${wallet.address}` : 'Connect your wallet to fund this schedule'}
          </div>
          <WalletConnectButton onConnected={setWallet} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="beneficiary">Beneficiary (G... address)</Label>
            <Input
              id="beneficiary"
              placeholder="G... who receives vested tokens"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="token">Token contract (C... address)</Label>
            <Input
              id="token"
              placeholder="C... SEP-41 token contract"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="totalAmount">Total amount (raw token units)</Label>
            <Input
              id="totalAmount"
              type="number"
              min="1"
              step="any"
              placeholder="e.g. 1000000000"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Amounts are escrowed in raw units (no decimal adjustment is applied
              client-side).
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="startTs">Start time</Label>
              <Input
                id="startTs"
                type="datetime-local"
                value={startTs}
                onChange={(e) => setStartTs(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTs">End time</Label>
              <Input
                id="endTs"
                type="datetime-local"
                value={endTs}
                onChange={(e) => setEndTs(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliffTs">Cliff time</Label>
              <Input
                id="cliffTs"
                type="datetime-local"
                value={cliffTs}
                onChange={(e) => setCliffTs(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="signers">Signers (comma-separated G... addresses)</Label>
            <Input
              id="signers"
              placeholder="G..., G..., G..."
              value={signers}
              onChange={(e) => setSigners(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="threshold">Approval threshold</Label>
            <Input
              id="threshold"
              type="number"
              min="1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Releases require this many signer approvals before the beneficiary
              can withdraw.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {successHash && (
            <p className="text-sm text-green-600">
              Schedule created! Transaction: {successHash.slice(0, 12)}…
            </p>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="animate-spin" />}
            {submitting ? 'Creating…' : 'Create schedule'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
