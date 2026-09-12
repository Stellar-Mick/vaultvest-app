'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Wallet } from 'lucide-react';
import { StrKey } from '@stellar/stellar-sdk';
import { decodeU64 } from '@vaultvest/sdk';

import { Identifier } from '@/components/Identifier';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { useWallet } from '@/components/WalletProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/errors';
import { rememberSchedule } from '@/lib/recents';
import { useToken } from '@/lib/use-token';
import { submitWrite } from '@/lib/write-flow';

/** Default SEP-41 token for demo schedules (from env, inlined at build time). */
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? '';

function isValidAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address.trim());
}

/**
 * Full strkey check for the token contract. A `startsWith('C')` test accepted
 * any string beginning with C, which then travelled all the way to ScVal
 * encoding before failing.
 */
function isValidContractAddress(address: string): boolean {
  return StrKey.isValidContract(address.trim());
}

/**
 * Whether a string is a positive decimal integer.
 *
 * Amounts are i128 raw token units and are sent to the server as strings
 * precisely because they can exceed `Number.MAX_SAFE_INTEGER`. Validating them
 * with `Number()` silently accepted values that lose precision (and forms like
 * `1e30` and `1.5`, which the contract cannot take), so the digits are checked
 * directly instead.
 */
function isPositiveIntegerString(value: string): boolean {
  return /^(0|[1-9][0-9]{0,39})$/.test(value) && BigInt(value) > 0n;
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
  const { wallet } = useWallet();
  const [beneficiary, setBeneficiary] = useState('');
  const [token, setToken] = useState(DEFAULT_TOKEN);
  // Resolve decimals/symbol for whatever token is typed, once it is a valid
  // address, so the amount field can show what the raw units actually mean.
  const tokenDisplay = useToken(
    StrKey.isValidContract(token.trim()) ? token.trim() : null
  );
  const [totalAmount, setTotalAmount] = useState('');
  const [startTs, setStartTs] = useState('');
  const [endTs, setEndTs] = useState('');
  const [cliffTs, setCliffTs] = useState('');
  const [signers, setSigners] = useState('');
  const [threshold, setThreshold] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    hash: string;
    /** Schedule id decoded from the contract's return value, if decodable. */
    scheduleId: bigint | null;
  } | null>(null);

  const validate = (): string | null => {
    if (!wallet) return 'Connect your wallet first.';
    if (!isValidAddress(beneficiary)) return 'Beneficiary must be a valid G... address.';
    if (!isValidContractAddress(token))
      return 'Token must be a valid C... contract address.';
    if (!isPositiveIntegerString(totalAmount.trim()))
      return 'Total amount must be a positive whole number of raw token units.';
    const start = toUnixSeconds(startTs);
    const end = toUnixSeconds(endTs);
    const cliff = toUnixSeconds(cliffTs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(cliff)) {
      return 'Start, end, and cliff times must be valid dates.';
    }
    // The contract's timestamps are u64 unix seconds; pre-1970 dates cannot be
    // represented and would be rejected at the API boundary.
    if (start < 0 || end < 0 || cliff < 0) {
      return 'Start, end, and cliff times must be on or after 1 January 1970.';
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
    setCreated(null);

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (!wallet) return;

    setSubmitting(true);
    try {
      const { hash, finalized } = await submitWrite(
        {
          type: 'create_schedule',
          params: {
            funder: wallet.address,
            beneficiary: beneficiary.trim(),
            token: token.trim(),
            totalAmount: totalAmount.trim(),
            startTs: String(toUnixSeconds(startTs)),
            endTs: String(toUnixSeconds(endTs)),
            cliffTs: String(toUnixSeconds(cliffTs)),
            signers: parseSigners(signers),
            threshold: Number(threshold),
          },
        },
        wallet,
        {
          functionName: 'create_schedule',
          // Escrowing pulls tokens from the funder, so the token contract is the
          // one additional contract the authorization tree may touch.
          extraAuthorizedContracts: [token.trim()],
        }
      );

      // `create_schedule` returns the new u64 id. Until now the funder had no
      // way to learn it from the app — it had to be dug out of an explorer.
      let scheduleId: bigint | null = null;
      try {
        if (finalized.returnValue) scheduleId = decodeU64(finalized.returnValue);
      } catch {
        // Unexpected return shape; fall back to showing only the tx hash.
      }
      setCreated({ hash, scheduleId });
      if (scheduleId !== null) rememberSchedule(scheduleId.toString(), ['funder']);
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
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-4 w-4 shrink-0" />
            {wallet ? (
              <span className="flex min-w-0 items-center gap-2">
                Funder: <Identifier value={wallet.address} kind="address" />
              </span>
            ) : (
              'Connect your wallet to fund this schedule'
            )}
          </div>
          <WalletConnectButton hideError size="sm" />
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
            <p className="text-xs text-muted-foreground">
              The funder account must already hold a trustline for this token.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="totalAmount">Total amount (raw token units)</Label>
            <Input
              id="totalAmount"
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 1000000000"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {tokenDisplay.metadata && isPositiveIntegerString(totalAmount.trim()) ? (
                <>
                  = <span className="font-medium text-foreground">{tokenDisplay.format(BigInt(totalAmount.trim()))}</span>
                  {' '}({tokenDisplay.metadata.decimals} decimals)
                </>
              ) : tokenDisplay.metadata ? (
                <>
                  {tokenDisplay.metadata.symbol} has {tokenDisplay.metadata.decimals} decimals — enter the amount in raw units.
                </>
              ) : (
                <>Amounts are escrowed in raw units (no decimal adjustment is applied client-side).</>
              )}
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
          {created && (
            <div className="space-y-3 rounded-md border border-green-600/30 bg-green-600/5 p-4 text-sm">
              <p className="font-medium text-green-700">
                {created.scheduleId !== null
                  ? `Schedule #${created.scheduleId.toString()} created.`
                  : 'Schedule created.'}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                Transaction <Identifier value={created.hash} kind="tx" />
              </p>
              {created.scheduleId !== null ? (
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href={`/dashboard?id=${created.scheduleId.toString()}`}>
                      Open schedule
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/approve?id=${created.scheduleId.toString()}`}>
                      Share with signers
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  The schedule ID could not be read from the transaction result;
                  look it up on the explorer link above.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Save the schedule ID — signers and the beneficiary will need it.
              </p>
            </div>
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
