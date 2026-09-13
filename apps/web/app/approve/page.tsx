'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BadgeCheck, Ban, Loader2, RefreshCw, Search } from 'lucide-react';

import {
  getApprovalCount,
  getApprovers,
  getRevokeApprovalCount,
  getSchedule,
  type ApprovalKind,
  type Schedule,
} from '@vaultvest/sdk';

import { ApprovalProgress } from '@/components/ApprovalProgress';
import { Identifier } from '@/components/Identifier';
import { MySchedules } from '@/components/MySchedules';
import { RecentSchedules } from '@/components/RecentSchedules';
import { useWallet } from '@/components/WalletProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/errors';
import { rememberSchedule, rolesFor } from '@/lib/recents';
import { getSdkClient } from '@/lib/soroban-client';
import { useToken } from '@/lib/use-token';
import { submitWrite } from '@/lib/write-flow';

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
 * from Soroban RPC; approval is a write call built by /api/tx, verified in the
 * browser, and signed with Freighter. Whether an address may approve is
 * enforced by the contract (NotAuthorizedSigner) — the "you are a signer" line
 * is display-only.
 *
 * Accepts `?id=42` for deep links.
 */
export default function ApprovePage() {
  return (
    <Suspense fallback={null}>
      <ApproveInner />
    </Suspense>
  );
}

function ApproveInner() {
  const { wallet } = useWallet();
  const searchParams = useSearchParams();

  const [scheduleId, setScheduleId] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [approvals, setApprovals] = useState<number | null>(null);
  /** Revoke approvals; null when unknown or when the contract predates them. */
  const [revokeApprovals, setRevokeApprovals] = useState<number | null>(null);
  const [approvers, setApprovers] = useState<{ release: string[]; revoke: string[] } | null>(null);
  const [mode, setMode] = useState<ApprovalKind>('Release');
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { format } = useToken(schedule?.token ?? null);

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
      const client = getSdkClient();
      const [sch, count] = await Promise.all([
        getSchedule(parsed, client),
        getApprovalCount(parsed, client),
      ]);
      setSchedule(sch);
      setApprovals(count);
      // Revoke-side reads exist only on the hardened contract. Tolerate their
      // absence so the page keeps working against an older deployment.
      const [revokeCount, rel, rev] = await Promise.all([
        getRevokeApprovalCount(parsed, client).catch(() => null),
        getApprovers(parsed, 'Release', client).catch(() => null),
        getApprovers(parsed, 'Revoke', client).catch(() => null),
      ]);
      setRevokeApprovals(revokeCount);
      setApprovers(rel && rev ? { release: rel, revoke: rev } : null);
    } catch (err) {
      setError(getErrorMessage(err));
      setSchedule(null);
      setApprovals(null);
      setRevokeApprovals(null);
      setApprovers(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (schedule && scheduleId.trim()) {
      rememberSchedule(scheduleId.trim(), rolesFor(schedule, wallet?.address));
    }
  }, [schedule, scheduleId, wallet?.address]);

  useEffect(() => {
    const id = searchParams.get('id');
    if (id && /^\d+$/.test(id)) {
      setScheduleId(id);
      void load(id);
    }
  }, [searchParams, load]);

  const handleLoad = () => {
    if (scheduleId.trim()) void load(scheduleId);
  };

  const handleApprove = async () => {
    if (!wallet || !schedule) return;
    const fn = mode === 'Release' ? ('approve_release' as const) : ('approve_revoke' as const);
    setError(null);
    setSuccess(null);
    setApproving(true);
    try {
      const { hash } = await submitWrite(
        { type: fn, scheduleId: scheduleId.trim(), signer: wallet.address },
        wallet,
        { functionName: fn }
      );
      setSuccess(hash);
      await load(scheduleId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setApproving(false);
    }
  };

  const canApprove = !!wallet && !!schedule && isSigner(schedule, wallet.address);
  const currentCount = mode === 'Release' ? approvals : revokeApprovals;
  const alreadyMet =
    currentCount !== null && schedule !== null && currentCount >= schedule.threshold;
  const alreadyApprovedByMe =
    !!wallet &&
    !!approvers &&
    (mode === 'Release' ? approvers.release : approvers.revoke).includes(wallet.address);

  return (
    <main className="container flex min-h-screen flex-col py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Approve releases</h1>
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
              <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Funded by</span>
                <Identifier value={schedule.funder} kind="address" />
                <span>for</span>
                <Identifier value={schedule.beneficiary} kind="address" />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Total</dt>
                  <dd className="font-medium">{format(schedule.totalAmount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Withdrawn</dt>
                  <dd className="font-medium">{format(schedule.withdrawnAmount)}</dd>
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

              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs font-medium">Release</p>
                  {approvals !== null && (
                    <ApprovalProgress approvals={approvals} threshold={schedule.threshold} />
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">Revoke</p>
                  {revokeApprovals !== null ? (
                    <ApprovalProgress approvals={revokeApprovals} threshold={schedule.threshold} />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Not available on this contract deployment.
                    </p>
                  )}
                </div>
              </div>

              <div className="text-sm">
                <p className="mb-1 text-muted-foreground">Signer set</p>
                <ul className="space-y-1">
                  {schedule.signers.map((s) => (
                    <li key={s} className="flex flex-wrap items-center gap-2">
                      <Identifier value={s} kind="address" />
                      {wallet?.address === s && (
                        <Badge variant="outline" className="text-[10px]">you</Badge>
                      )}
                      {approvers?.release.includes(s) && (
                        <Badge variant="secondary" className="text-[10px]">approved release</Badge>
                      )}
                      {approvers?.revoke.includes(s) && (
                        <Badge variant="destructive" className="text-[10px]">approved revoke</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {!wallet
                    ? 'Connect your wallet to approve.'
                    : canApprove
                      ? 'You are a signer on this schedule.'
                      : 'Connected wallet is not in this schedule’s signer set.'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-md border p-0.5 text-xs" role="tablist" aria-label="Approval kind">
                    {(['Release', 'Revoke'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        onClick={() => setMode(m)}
                        className={
                          'rounded px-2 py-1 transition-colors ' +
                          (mode === m ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')
                        }
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <Button
                    onClick={() => void handleApprove()}
                    disabled={approving || !canApprove || schedule.revoked || alreadyApprovedByMe}
                    variant={mode === 'Revoke' ? 'destructive' : 'default'}
                    title={
                      alreadyApprovedByMe
                        ? 'You have already approved this'
                        : alreadyMet
                          ? 'Threshold already met — further approvals are optional'
                          : undefined
                    }
                  >
                    {approving ? <Loader2 className="animate-spin" /> : mode === 'Revoke' ? <Ban /> : <BadgeCheck />}
                    {approving ? 'Approving…' : mode === 'Revoke' ? 'Approve revoke' : 'Approve release'}
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
              {success && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-green-600">
                  Approval recorded. <Identifier value={success} kind="tx" />
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <MySchedules basePath="/approve" roleFilter={['signer']} />
        <RecentSchedules basePath="/approve" />
      </div>
    </main>
  );
}
