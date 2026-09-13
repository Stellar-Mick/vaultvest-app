'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Radar } from 'lucide-react';
import type { Schedule } from '@vaultvest/sdk';

import { useWallet } from '@/components/WalletProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { discoverSchedules, DiscoveryUnsupportedError, type DiscoveryResult } from '@/lib/discover';
import { getErrorMessage } from '@/lib/errors';
import type { ScheduleRole } from '@/lib/recents';
import { useToken } from '@/lib/use-token';

interface MySchedulesProps {
  /** Only show schedules where the wallet holds one of these roles. */
  roleFilter?: ScheduleRole[];
  /** Page to deep-link into for each result. */
  basePath: string;
}

function ScheduleRow({
  id,
  schedule,
  roles,
  basePath,
}: {
  id: bigint;
  schedule: Schedule;
  roles: ScheduleRole[];
  basePath: string;
}) {
  const { format } = useToken(schedule.token);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <Link
        href={`${basePath}?id=${id.toString()}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        Schedule #{id.toString()}
      </Link>
      <span className="text-muted-foreground">{format(schedule.totalAmount)}</span>
      <span className="flex gap-1">
        {roles.map((r) => (
          <Badge key={r} variant="outline" className="text-[10px] capitalize">
            {r}
          </Badge>
        ))}
      </span>
      <Badge
        variant={schedule.revoked ? 'destructive' : 'secondary'}
        className="ml-auto text-[10px]"
      >
        {schedule.revoked ? 'Revoked' : 'Active'}
      </Badge>
    </li>
  );
}

/**
 * On-chain discovery: enumerate the contract's schedules and list the ones the
 * connected wallet has a role on. Explicit button rather than automatic — it
 * is one RPC read per schedule, capped, and the user should know they are
 * triggering it.
 */
export function MySchedules({ roleFilter, basePath }: MySchedulesProps) {
  const { wallet } = useWallet();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const res = await discoverSchedules(wallet.address, {
        onProgress: (scanned, total) => setProgress([scanned, total]),
      });
      setResult(res);
    } catch (err) {
      setError(
        err instanceof DiscoveryUnsupportedError ? err.message : getErrorMessage(err)
      );
    } finally {
      setBusy(false);
    }
  };

  const shown =
    result?.matches.filter(
      (m) => !roleFilter || m.roles.some((r) => roleFilter.includes(r))
    ) ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radar className="h-4 w-4 text-muted-foreground" />
              My schedules
            </CardTitle>
            <CardDescription>
              {wallet
                ? 'Scan the contract for schedules where your wallet is involved.'
                : 'Connect your wallet to scan for your schedules.'}
            </CardDescription>
          </div>
          <Button onClick={() => void run()} disabled={!wallet || busy} size="sm" variant="outline">
            {busy ? <Loader2 className="animate-spin" /> : <Radar />}
            {busy && progress ? `${progress[0]}/${progress[1]}` : busy ? 'Scanning…' : 'Scan'}
          </Button>
        </div>
      </CardHeader>
      {(error || result) && (
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && shown.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              No schedules found for this wallet
              {roleFilter ? ` as ${roleFilter.join(' or ')}` : ''} among the{' '}
              {result.scanned} scanned.
            </p>
          )}
          {shown.length > 0 && (
            <ul className="divide-y">
              {shown.map((m) => (
                <ScheduleRow
                  key={m.id.toString()}
                  id={m.id}
                  schedule={m.schedule}
                  roles={m.roles}
                  basePath={basePath}
                />
              ))}
            </ul>
          )}
          {result?.truncated && (
            <p className="mt-2 text-xs text-muted-foreground">
              Scanned the newest {result.scanned} of {result.total.toString()} schedules.
              Older ones can still be opened by ID.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
