'use client';

import { useEffect, useState } from 'react';
import {
  formatTokenAmount,
  getTokenMetadata,
  type TokenMetadata,
} from '@vaultvest/sdk';

import { getSdkClient } from '@/lib/soroban-client';

/**
 * Metadata is immutable for a given token contract, so one read per token per
 * session is plenty. Shared across components so the dashboard, approve page,
 * and cards never race each other for the same three simulations.
 */
const cache = new Map<string, Promise<TokenMetadata>>();

function loadTokenMetadata(contractId: string): Promise<TokenMetadata> {
  let pending = cache.get(contractId);
  if (!pending) {
    pending = getTokenMetadata(contractId, getSdkClient()).catch((err) => {
      // Do not cache failures — a transient RPC error should not pin the UI
      // to raw units for the rest of the session.
      cache.delete(contractId);
      throw err;
    });
    cache.set(contractId, pending);
  }
  return pending;
}

export interface TokenDisplay {
  /** Resolved metadata, or `null` while loading or if the read failed. */
  metadata: TokenMetadata | null;
  /**
   * Format a raw amount for display. Falls back to the raw integer with a
   * "raw units" suffix until metadata is available, so the UI never shows a
   * misleadingly scaled number.
   */
  format: (raw: bigint) => string;
}

/**
 * Resolve a token's `decimals` / `symbol` and get a formatter for its amounts.
 *
 * @param contractId - C... token address, or `null` to skip
 */
export function useToken(contractId: string | null): TokenDisplay {
  const [metadata, setMetadata] = useState<TokenMetadata | null>(null);

  useEffect(() => {
    setMetadata(null);
    if (!contractId) return;
    let cancelled = false;
    loadTokenMetadata(contractId)
      .then((m) => {
        if (!cancelled) setMetadata(m);
      })
      .catch(() => {
        // Leave metadata null; the fallback formatter handles it.
      });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  const format = (raw: bigint): string =>
    metadata
      ? `${formatTokenAmount(raw, metadata.decimals)} ${metadata.symbol}`
      : `${raw.toString()} raw units`;

  return { metadata, format };
}
