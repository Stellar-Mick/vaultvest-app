'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * recents.ts — remember the schedules a user has interacted with.
 *
 * The contract has no "list schedules for address" call, and the RPC's event
 * window is short, so the app cannot enumerate a wallet's schedules on-chain.
 * What it can do is remember what it has already seen. Stored per browser in
 * localStorage; purely a convenience, never a source of truth.
 */

export type ScheduleRole = 'funder' | 'beneficiary' | 'signer';

export interface RecentSchedule {
  id: string;
  /** Roles the connected wallet held on this schedule when last seen. */
  roles: ScheduleRole[];
  /** Epoch ms of the last interaction. */
  seenAt: number;
}

const KEY = 'vaultvest:recent-schedules';
const MAX = 12;
const EVENT = 'vaultvest:recents-changed';

function read(): RecentSchedule[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentSchedule =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as RecentSchedule).id === 'string' &&
        /^\d+$/.test((r as RecentSchedule).id) &&
        Array.isArray((r as RecentSchedule).roles) &&
        typeof (r as RecentSchedule).seenAt === 'number'
    );
  } catch {
    return [];
  }
}

function write(list: RecentSchedule[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Storage unavailable (private mode, quota) — recents are best-effort.
  }
}

/**
 * Record an interaction with a schedule. Roles accumulate across visits so a
 * wallet that is both funder and signer is shown as both.
 */
export function rememberSchedule(id: string, roles: ScheduleRole[] = []): void {
  if (typeof window === 'undefined' || !/^\d+$/.test(id)) return;
  const list = read();
  const existing = list.find((r) => r.id === id);
  const merged = Array.from(new Set([...(existing?.roles ?? []), ...roles]));
  const next: RecentSchedule = { id, roles: merged, seenAt: Date.now() };
  write([next, ...list.filter((r) => r.id !== id)]);
}

export function forgetSchedule(id: string): void {
  if (typeof window === 'undefined') return;
  write(read().filter((r) => r.id !== id));
}

/** Live view of recent schedules; updates when any tab records one. */
export function useRecentSchedules(): {
  recents: RecentSchedule[];
  forget: (id: string) => void;
} {
  const [recents, setRecents] = useState<RecentSchedule[]>([]);

  useEffect(() => {
    const refresh = () => setRecents(read());
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const forget = useCallback((id: string) => forgetSchedule(id), []);
  return { recents, forget };
}

/** Which roles `address` holds on `schedule` — empty when not connected. */
export function rolesFor(
  schedule: { funder: string; beneficiary: string; signers: string[] },
  address: string | null | undefined
): ScheduleRole[] {
  if (!address) return [];
  const roles: ScheduleRole[] = [];
  if (schedule.funder === address) roles.push('funder');
  if (schedule.beneficiary === address) roles.push('beneficiary');
  if (schedule.signers.includes(address)) roles.push('signer');
  return roles;
}
