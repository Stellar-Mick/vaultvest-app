'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { getSchedule, getVestedAmount, type Schedule } from '@vaultvest/sdk';

import { Identifier } from '@/components/Identifier';
import { RecentSchedules } from '@/components/RecentSchedules';
import { ScheduleCard } from '@/components/ScheduleCard';
import { useWallet } from '@/components/WalletProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/errors';
import { rememberSchedule, rolesFor } from '@/lib/recents';
import { getSdkClient } from '@/lib/soroban-client';
import { submitWrite } from '@/lib/write-flow';

/**
 * Schedule view for funders and beneficiaries: look up a schedule by id, see
 * vested progress, withdraw (beneficiary) or revoke (funder). Vested amounts
 * always come from the contract's vested_amount — never computed client-side.
 *
 * Accepts `?id=42` so the create flow can link straight here.
 */
export default function DashboardPage() {
  // useSearchParams opts its subtree into client rendering; the Suspense
  // boundary lets the shell still prerender statically.
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const { wallet } = useWallet();
  const searchParams = useSearchParams();

  const [scheduleId, setScheduleId] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [vestedAmount, setVestedAmount] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ text: string; hash: string } | null>(null);

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
      const [sch, vested] = await Promise.all([
        getSchedule(parsed, getSdkClient()),
        getVestedAmount(parsed, getSdkClient()),
      ]);
      setSchedule(sch);
      setVestedAmount(vested);
    } catch (err) {
      setError(getErrorMessage(err));
      setSchedule(null);
      setVestedAmount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Remember every schedule successfully loaded, with the wallet's role on it.
  useEffect(() => {
    if (schedule && scheduleId.trim()) {
      rememberSchedule(scheduleId.trim(), rolesFor(schedule, wallet?.address));
    }
  }, [schedule, scheduleId, wallet?.address]);

  // Deep link: /dashboard?id=42 loads immediately.
  useEffect(() => {
    const id = searchParams.get('id');
    if (id && /^\d+$/.test(id)) {
      setScheduleId(id);
      void load(id);
    }
  }, [searchParams, load]);

  const runWrite = async (
    kind: 'withdraw' | 'revoke',
    setBusy: (b: boolean) => void,
    successText: string
  ) => {
    if (!wallet || !schedule) return;
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const { hash } = await submitWrite(
        { type: kind, scheduleId: scheduleId.trim(), caller: wallet.address },
        wallet,
        {
          functionName: kind,
          // Withdraw moves tokens; the schedule's own token is the one other
          // contract its authorization tree may touch. Revoke touches none.
          extraAuthorizedContracts: kind === 'withdraw' ? [schedule.token] : [],
        }
      );
      setSuccess({ text: successText, hash });
      await load(scheduleId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container flex min-h-screen flex-col py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">
          Track vested amounts, withdraw as the beneficiary, or revoke as the funder.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Find a schedule</CardTitle>
            <CardDescription>
              Enter the schedule ID you received when it was created.
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
                    if (e.key === 'Enter') void load(scheduleId);
                  }}
                />
              </div>
              <Button onClick={() => void load(scheduleId)} disabled={loading || !scheduleId.trim()}>
                {loading ? <Loader2 className="animate-spin" /> : <Search />}
                Load
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        {schedule && (
          <div className="space-y-3">
            <ScheduleCard
              scheduleId={BigInt(scheduleId.trim())}
              schedule={schedule}
              vestedAmount={vestedAmount}
              walletAddress={wallet?.address ?? null}
              withdrawing={withdrawing}
              revoking={revoking}
              onWithdraw={() => void runWrite('withdraw', setWithdrawing, 'Withdrawal completed')}
              onRevoke={() => void runWrite('revoke', setRevoking, 'Schedule revoked')}
            />
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {wallet ? 'Actions above reflect your role on this schedule.' : 'Connect your wallet to act on this schedule.'}
              </p>
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
            {success && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-green-600">
                {success.text}. <Identifier value={success.hash} kind="tx" />
              </p>
            )}
          </div>
        )}

        <RecentSchedules basePath="/dashboard" />
      </div>
    </main>
  );
}
