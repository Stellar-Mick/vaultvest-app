'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';

import { cn } from '@/lib/utils';
import { explorerAddressUrl, explorerTxUrl, shorten } from '@/lib/explorer';

interface IdentifierProps {
  /** The full value: a G.../C... address or a transaction hash. */
  value: string;
  /** Which explorer page the value links to. */
  kind: 'address' | 'tx';
  /** Show the full value instead of a shortened form. */
  full?: boolean;
  /** Characters kept at each end when shortened. */
  head?: number;
  tail?: number;
  className?: string;
}

/**
 * A copyable, explorer-linked address or transaction hash.
 *
 * Every hash and address in the app used to render as `slice(0, 12)…` plain
 * text — no way to copy the full value, no way to verify it on-chain. This
 * puts both a click away, with the full value in a tooltip and in the
 * clipboard.
 */
export function Identifier({
  value,
  kind,
  full = false,
  head = 6,
  tail = 6,
  className,
}: IdentifierProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const href = kind === 'tx' ? explorerTxUrl(value) : explorerAddressUrl(value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (insecure context, permissions); the
      // value is still selectable as text.
    }
  };

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 font-mono text-xs',
        className
      )}
    >
      <span className={full ? 'break-all' : 'truncate'} title={value}>
        {full ? value : shorten(value, head, tail)}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        title={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : `Copy ${kind}`}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          title="View on stellar.expert"
          aria-label={`View ${kind} on stellar.expert`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </span>
  );
}
