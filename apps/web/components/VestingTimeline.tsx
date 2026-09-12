'use client';

import { useEffect, useState } from 'react';

import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

interface VestingTimelineProps {
  /** Unix seconds. */
  startTs: bigint;
  cliffTs: bigint;
  endTs: bigint;
  revoked?: boolean;
}

/**
 * Where the schedule stands in time, and what happens next.
 *
 * This is presentation of the schedule's *timestamps* only. The vested
 * amount still comes from the contract's `vested_amount` — this component
 * never derives a token figure from elapsed time, because the contract's
 * curve is the source of truth and may not be linear.
 */
export function VestingTimeline({ startTs, cliffTs, endTs, revoked }: VestingTimelineProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const start = Number(startTs);
  const cliff = Number(cliffTs);
  const end = Number(endTs);
  const span = Math.max(1, end - start);

  const pct = (ts: number) => Math.min(100, Math.max(0, ((ts - start) / span) * 100));
  const nowPct = pct(now);
  const cliffPct = pct(cliff);

  const phase = (() => {
    if (revoked) return { label: 'Revoked', detail: 'No further vesting.', tone: 'destructive' as const };
    if (now < start)
      return { label: 'Not started', detail: `Starts in ${formatDuration(start - now)}`, tone: 'muted' as const };
    if (now < cliff)
      return { label: 'Before cliff', detail: `Cliff in ${formatDuration(cliff - now)}`, tone: 'muted' as const };
    if (now < end)
      return { label: 'Vesting', detail: `Fully vested in ${formatDuration(end - now)}`, tone: 'active' as const };
    return { label: 'Fully vested', detail: 'The whole amount is unlockable.', tone: 'done' as const };
  })();

  const toneClass = {
    destructive: 'text-destructive',
    muted: 'text-muted-foreground',
    active: 'text-foreground',
    done: 'text-green-600',
  }[phase.tone];

  const fmt = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className={cn('font-medium', toneClass)}>{phase.label}</span>
        <span className="text-muted-foreground">{phase.detail}</span>
      </div>

      <div className="relative h-2 rounded-full bg-secondary">
        {/* Elapsed time */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            revoked ? 'bg-destructive/40' : 'bg-primary/70'
          )}
          style={{ width: `${nowPct}%` }}
        />
        {/* Cliff marker */}
        {cliff > start && cliff < end && (
          <div
            className="absolute -top-1 h-4 w-0.5 bg-foreground/60"
            style={{ left: `${cliffPct}%` }}
            title={`Cliff — ${fmt(cliff)}`}
          />
        )}
        {/* Now marker */}
        {now > start && now < end && !revoked && (
          <div
            className="absolute -top-1.5 h-5 w-0.5 bg-foreground"
            style={{ left: `${nowPct}%` }}
            title="Now"
          />
        )}
      </div>

      <div className="relative h-4 text-[10px] text-muted-foreground">
        <span className="absolute left-0">Start · {fmt(start)}</span>
        {cliff > start && cliff < end && (
          <span
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${cliffPct}%` }}
          >
            Cliff · {fmt(cliff)}
          </span>
        )}
        <span className="absolute right-0">End · {fmt(end)}</span>
      </div>
    </div>
  );
}
