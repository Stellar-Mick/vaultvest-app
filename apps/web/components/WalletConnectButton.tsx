'use client';

import { Loader2, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useWallet } from '@/components/WalletProvider';
import { shorten } from '@/lib/explorer';

interface WalletConnectButtonProps {
  /** Hide the inline error line (the header shows errors elsewhere). */
  hideError?: boolean;
  /** Size passthrough to the underlying button. */
  size?: 'default' | 'sm';
}

/**
 * Connect/disconnect control for the app-wide wallet session. Session state
 * lives in {@link useWallet}; this component only renders it.
 */
export function WalletConnectButton({
  hideError = false,
  size = 'default',
}: WalletConnectButtonProps) {
  const { wallet, connecting, restoring, error, connect, disconnect } =
    useWallet();

  const busy = connecting || restoring;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={wallet ? disconnect : () => void connect()}
        disabled={busy}
        variant={wallet ? 'outline' : 'default'}
        size={size}
        title={wallet ? `${wallet.address} — click to disconnect` : undefined}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Wallet />}
        {restoring
          ? 'Checking wallet…'
          : connecting
            ? 'Connecting…'
            : wallet
              ? shorten(wallet.address)
              : 'Connect wallet'}
      </Button>
      {!hideError && error && (
        <p className="max-w-[240px] text-right text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
