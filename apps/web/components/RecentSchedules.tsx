'use client';

import Link from 'next/link';
import { Clock, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRecentSchedules } from '@/lib/recents';

interface RecentSchedulesProps {
  /** Page to deep-link into, e.g. `/dashboard`. */
  basePath: string;
}

/**
 * Schedules this browser has seen, most recent first, with the roles the
 * wallet held on each. Hidden when there is nothing to show.
 */
export function RecentSchedules({ basePath }: RecentSchedulesProps) {
  const { recents, forget } = useRecentSchedules();
  if (recents.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Recent schedules
        </CardTitle>
        <CardDescription>Remembered on this device. Not a source of truth.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {recents.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
              <Link
                href={`${basePath}?id=${r.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                Schedule #{r.id}
              </Link>
              <span className="flex flex-wrap gap-1">
                {r.roles.map((role) => (
                  <Badge key={role} variant="outline" className="text-[10px] capitalize">
                    {role}
                  </Badge>
                ))}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(r.seenAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                onClick={() => forget(r.id)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                title="Forget"
                aria-label={`Forget schedule ${r.id}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
