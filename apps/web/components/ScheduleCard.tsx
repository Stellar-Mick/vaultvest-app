'use client';

import { useState } from 'react';
import { Ban, Loader2, Lock, Unlock } from 'lucide-react';
import type { Schedule } from '@vaultvest/sdk';

import { Identifier } from '@/components/Identifier';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface ScheduleCardProps {
  /** Numeric schedule id (displayed in the card header). */
  scheduleId: bigint;
  /** Schedule as read from the contract's get_schedule. */
  schedule: Schedule;
  /** Vested amount as read from the contract's vested_amount (null while loading). */
  vestedAmount: bigint | null;
  /** Connected wallet address, to determine which actions to offer (display only). */
  walletAddress: string | null;
  /** True while a withdraw transaction is being signed/submitted. */
  withdrawing: boolean;
  /** True while a revoke transaction is being signed/submitted. */
  revoking: boolean;
  /** Invoked when the beneficiary clicks Withdraw. */
  onWithdraw: () => void;
  /** Invoked when the funder confirms Revoke. */
  onRevoke: () => void;
}

function formatTs(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString();
}

function percent(vested: bigint | null, total: bigint): number {
  if (!vested || total <= 0n) return 0;
  const pct = (Number(vested) / Number(total)) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/**
 * Role-aware view of a vesting schedule. All numbers come from the contract
 * (get_schedule / vested_amount); the progress percentage is presentation only
 * — the app never recomputes vesting math.
 *
 * Actions are offered by role: the beneficiary sees Withdraw, the funder sees
 * Revoke. Both are display-level gates; the contract enforces the real rules
 * (NotBeneficiary / NotFunder).
 */
export function ScheduleCard({
  scheduleId,
  schedule,
  vestedAmount,
  walletAddress,
  withdrawing,
  revoking,
  onWithdraw,
  onRevoke,
}: ScheduleCardProps) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const isBeneficiary = walletAddress === schedule.beneficiary;
  const isFunder = walletAddress === schedule.funder;
  const canWithdraw =
    isBeneficiary && !!vestedAmount && vestedAmount > 0n && !schedule.revoked;
  const canRevoke = isFunder && !schedule.revoked;
  const busy = withdrawing || revoking;

  const roleLine = (() => {
    if (!walletAddress) return 'Connect your wallet to check eligibility.';
    if (isBeneficiary && isFunder) return 'You are both the funder and the beneficiary.';
    if (isBeneficiary) return 'You are the beneficiary.';
    if (isFunder) return 'You are the funder.';
    return 'Connected wallet is neither the funder nor the beneficiary.';
  })();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Schedule #{scheduleId.toString()}</CardTitle>
          <Badge variant={schedule.revoked ? 'destructive' : 'secondary'}>
            {schedule.revoked ? 'Revoked' : 'Active'}
          </Badge>
        </div>
        <CardDescription>
          {schedule.totalAmount.toString()} raw units — {schedule.signers.length}{' '}
          signer{schedule.signers.length === 1 ? '' : 's'}, threshold{' '}
          {schedule.threshold}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Vested {vestedAmount?.toString() ?? '…'} of {schedule.totalAmount.toString()}
            </span>
            <span>Withdrawn {schedule.withdrawnAmount.toString()}</span>
          </div>
          <Progress value={percent(vestedAmount, schedule.totalAmount)} />
        </div>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Funder</dt>
            <dd><Identifier value={schedule.funder} kind="address" /></dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Beneficiary</dt>
            <dd><Identifier value={schedule.beneficiary} kind="address" /></dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Token</dt>
            <dd><Identifier value={schedule.token} kind="address" /></dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Starts</dt>
            <dd>{formatTs(schedule.startTs)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cliff</dt>
            <dd>{formatTs(schedule.cliffTs)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ends</dt>
            <dd>{formatTs(schedule.endTs)}</dd>
          </div>
        </dl>

        {schedule.signers.length > 0 && (
          <div className="text-sm">
            <p className="mb-1 text-muted-foreground">Signers</p>
            <ul className="space-y-1">
              {schedule.signers.map((s) => (
                <li key={s}>
                  <Identifier value={s} kind="address" />
                  {s === walletAddress && (
                    <Badge variant="outline" className="ml-2 text-[10px]">you</Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {isBeneficiary || isFunder ? (
              <Unlock className="h-4 w-4 shrink-0" />
            ) : (
              <Lock className="h-4 w-4 shrink-0" />
            )}
            {roleLine}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {isBeneficiary && (
              <Button onClick={onWithdraw} disabled={!canWithdraw || busy}>
                {withdrawing && <Loader2 className="animate-spin" />}
                {withdrawing ? 'Withdrawing…' : 'Withdraw vested'}
              </Button>
            )}

            {isFunder && !confirmRevoke && (
              <Button
                variant="outline"
                onClick={() => setConfirmRevoke(true)}
                disabled={!canRevoke || busy}
              >
                <Ban />
                Revoke
              </Button>
            )}
          </div>
        </div>

        {confirmRevoke && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">Revoke this schedule?</p>
            <p className="mt-1 text-muted-foreground">
              This is permanent and enforced on-chain. Once revoked, no further
              approvals or withdrawals are possible for schedule #
              {scheduleId.toString()}.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirmRevoke(false);
                  onRevoke();
                }}
                disabled={busy}
              >
                {revoking ? <Loader2 className="animate-spin" /> : <Ban />}
                {revoking ? 'Revoking…' : 'Yes, revoke'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmRevoke(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
