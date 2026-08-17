'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Loader2, RefreshCw, Search } from 'lucide-react';

import { getApprovalCount, getSchedule, type Schedule } from '@vaultvest/sdk';

import { ApprovalProgress } from '@/components/ApprovalProgress';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  signAndSubmit,
  type ConnectedWallet,
} from '@/lib/freighter';
import {
  contractErrorFromFinalizedTx,
  waitForTransaction,
} from '@/lib/soroban-client';

/** Format a unix-seconds bigint as a locale date string for display. */
function formatTs(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString();
}

function isSigner(schedule: Schedule, address: string): boolean {
  return schedule.signers.includes(address);
}

/**
 * Signer flow: look up a schedule by id, review its release state, and approve
 * the current release. Read-only state (schedule, approval count) comes straight
 * from Soroban RPC; approval is a write call built by /api/tx and signed with
 * Freighter. Whether an address may approve is enforced by the contract
 * (NotAuthorizedSigner) — the "You are a signer" badge is display-only.
 */
export default function ApprovePage() {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [scheduleId, setScheduleId] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [approvals, setApprovals] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setError(null);
    setSuccess(null);
    let parsed: bigint;
    try {
      parsed = BigInt(id.trim());
    } catch {
      setError('Schedule ID must be an integer.');
      return;
    }
    setLoading(true);
    try {
      const [sch, count] = await Promise.all([
        getSchedule(parsed),
        getApprovalCount(parsed),
      ]);
      setSchedule(sch);
      setApprovals(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedule.');
      setSchedule(null);
      setApprovals(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLoad = () => {
    if (scheduleId.trim()) void load(scheduleId);
  };

  const handleApprove = async () => {
    if (!wallet || !schedule) return;
    setError(null);
    setSuccess(null);
    setApproving(true);
    try {
      const response = await fetch('/api/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approve_release',
          scheduleId: scheduleId.trim(),
          signer: wallet.address,
        }),
      });
      const data = (await response.json()) as {
        xdr?: string;
        error?: { code?: number; message?: string };
      };
      if (!response.ok || !data.xdr) {
        throw new Error(data.error?.message ?? 'Failed to build transaction.');
      }
      const { hash } = await signAndSubmit(data.xdr, wallet.networkPassphrase);
      const finalized = await waitForTransaction(hash);
      if (finalized.status !== 'SUCCESS') {
        const mapped = contractErrorFromFinalizedTx(finalized);
        throw mapped ?? new Error('Transaction failed on-chain.');
      }
      setSuccess(`Approval recorded (${hash.slice(0, 12)}…).`);
      await load(scheduleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setApproving(false);
    }
  };

  const canApprove =
    !!wallet && !!schedule && isSigner(schedule, wallet.address);

  return (
    <main className="container flex min-h-screen flex-col py-12">
      <div className="mb-8">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">← Home</Link>
        </Button>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Approve releases</h1>
        <p className="mt-2 text-muted-foreground">
          Review a schedule&apos;s release state and approve it as a signer.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Find a schedule</CardTitle>
            <CardDescription>
              Enter the schedule ID returned when it was created.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="scheduleId">Schedule ID</Label>
                <Input
                  id="scheduleId"
                  inputMode="numeric"
                  placeholder="e.g. 42"
                  value={scheduleId}
                  onChange={(e) => setScheduleId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleLoad();
                  }}
                />
              </div>
              <Button onClick={handleLoad} disabled={loading || !scheduleId.trim()}>
                {loading ? <Loader2 className="animate-spin" /> : <Search />}
                Load
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        {schedule && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Schedule #{scheduleId.trim()}</CardTitle>
                <Badge variant={schedule.revoked ? 'destructive' : 'secondary'}>
                  {schedule.revoked ? 'Revoked' : 'Active'}
                </Badge>
              </div>
              <CardDescription>
                Funded by {schedule.funder.slice(0, 12)}… for{' '}
                {schedule.beneficiary.slice(0, 12)}…
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Total</dt>
                  <dd className="font-medium">{schedule.totalAmount.toString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Withdrawn</dt>
                  <dd className="font-medium">{schedule.withdrawnAmount.toString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Starts</dt>
                  <dd>{formatTs(schedule.startTs)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Ends</dt>
                  <dd>{formatTs(schedule.endTs)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Cliff</dt>
                  <dd>{formatTs(schedule.cliffTs)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Signers</dt>
                  <dd>{schedule.signers.length}</dd>
                </div>
              </dl>

              {approvals !== null && (
                <ApprovalProgress approvals={approvals} threshold={schedule.threshold} />
              )}

              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {!wallet
                    ? 'Connect your wallet to approve.'
                    : canApprove
                      ? `Signed in as ${wallet.address.slice(0, 8)}… — you are a signer.`
                      : `Signed in as ${wallet.address.slice(0, 8)}… — not in this schedule's signer set.`}
                </p>
                <div className="flex items-center gap-2">
                  <WalletConnectButton onConnected={setWallet} />
                  <Button
                    onClick={handleApprove}
                    disabled={approving || !canApprove || schedule.revoked}
                  >
                    {approving ? <Loader2 className="animate-spin" /> : <BadgeCheck />}
                    {approving ? 'Approving…' : 'Approve release'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void load(scheduleId)}
                    disabled={loading}
                    title="Refresh"
                  >
                    <RefreshCw className={loading ? 'animate-spin' : undefined} />
                  </Button>
                </div>
              </div>
              {success && <p className="text-sm text-green-600">{success}</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
