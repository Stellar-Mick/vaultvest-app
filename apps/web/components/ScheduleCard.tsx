'use client';

import { Loader2, Lock, Unlock } from 'lucide-react';
import type { Schedule } from '@vaultvest/sdk';

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
  /** Connected wallet address, to determine withdraw eligibility (display only). */
  walletAddress: string | null;
  /** True while a withdraw transaction is being signed/submitted. */
  withdrawing: boolean;
  /** Invoked when the beneficiary clicks Withdraw. */
  onWithdraw: () => void;
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
 * Beneficiary-facing view of a vesting schedule. All numbers come from the
 * contract (get_schedule / vested_amount); the progress percentage is
 * presentation only — the app never recomputes vesting math.
 */
export function ScheduleCard({
  scheduleId,
  schedule,
  vestedAmount,
  walletAddress,
  withdrawing,
  onWithdraw,
}: ScheduleCardProps) {
  const isBeneficiary = walletAddress === schedule.beneficiary;
  const canWithdraw = isBeneficiary && !!vestedAmount && vestedAmount > 0n && !schedule.revoked;

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
          {schedule.totalAmount.toString()} tokens from{' '}
          {schedule.funder.slice(0, 8)}… — {schedule.signers.length} signer
          (s), threshold {schedule.threshold}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Vested {vestedAmount?.toString() ?? '…'} of {schedule.totalAmount.toString()}
            </span>
            <span>
              Withdrawn {schedule.withdrawnAmount.toString()}
            </span>
          </div>
          <Progress value={percent(vestedAmount, schedule.totalAmount)} />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Funder</dt>
            <dd className="break-all text-xs">{schedule.funder}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Beneficiary</dt>
            <dd className="break-all text-xs">{schedule.beneficiary}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Token</dt>
            <dd className="break-all text-xs">{schedule.token}</dd>
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
        </dl>

        <div className="flex items-center justify-between border-t pt-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {isBeneficiary ? (
              <>
                <Unlock className="h-4 w-4" />
                You are the beneficiary.
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" />
                {walletAddress
                  ? 'Connect the beneficiary wallet to withdraw.'
                  : 'Connect your wallet to check eligibility.'}
              </>
            )}
          </p>
          <Button
            onClick={onWithdraw}
            disabled={!canWithdraw || withdrawing}
          >
            {withdrawing && <Loader2 className="animate-spin" />}
            {withdrawing ? 'Withdrawing…' : 'Withdraw vested'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
