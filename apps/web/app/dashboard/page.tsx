'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { getSchedule, getVestedAmount, type Schedule } from '@vaultvest/sdk';

import { ScheduleCard } from '@/components/ScheduleCard';
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

/**
 * Beneficiary flow: look up a schedule by id, view vested progress, and withdraw.
 * Vested amounts always come from the contract's vested_amount — never computed
 * client-side. Withdraw is built by /api/tx and signed with Freighter.
 */
export default function DashboardPage() {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [scheduleId, setScheduleId] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [vestedAmount, setVestedAmount] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async (id: string) => {
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
        getSchedule(parsed),
        getVestedAmount(parsed),
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
  };

  const handleWithdraw = async () => {
    if (!wallet || !schedule) return;
    setError(null);
    setSuccess(null);
    setWithdrawing(true);
    try {
      const response = await fetch('/api/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'withdraw',
          scheduleId: scheduleId.trim(),
          caller: wallet.address,
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
      setSuccess(`Withdrawal completed (${hash.slice(0, 12)}…).`);
      await load(scheduleId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <main className="container flex min-h-screen flex-col py-12">
      <div className="mb-8">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">← Home</Link>
        </Button>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">
          Track vested amounts and withdraw tokens as the beneficiary.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Find your schedule</CardTitle>
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
              onWithdraw={() => void handleWithdraw()}
            />
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {wallet
                  ? wallet.address === schedule.beneficiary
                    ? 'Connected as the beneficiary.'
                    : 'Connected wallet is not this schedule\'s beneficiary.'
                  : 'Connect your wallet to withdraw.'}
              </p>
              <div className="flex items-center gap-2">
                <WalletConnectButton onConnected={setWallet} />
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
          </div>
        )}
      </div>
    </main>
  );
}
