'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  connectWallet,
  detectWallet,
  getWalletAddress,
  getWalletNetwork,
  type ConnectedWallet,
} from '@/lib/freighter';

interface WalletConnectButtonProps {
  /**
   * Called with the connected wallet whenever the user connects (or reconnects)
   * via this button. Use this to lift the address/passphrase into page state.
   */
  onConnected?: (wallet: ConnectedWallet) => void;
}

/** Truncate a G... address for display, e.g. GBXD…AB12. */
export function shortenAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : address;
}

/**
 * Connect/disconnect button for the Freighter browser extension. Restores the
 * already-authorized account on mount without prompting. Shows a clear error
 * when no wallet extension is detected.
 */
export function WalletConnectButton({ onConnected }: WalletConnectButtonProps) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect wallet availability and restore existing authorization on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pre-flight: is a wallet extension even installed?
      const availability = detectWallet();
      if (!availability.available) {
        if (!cancelled) setError(availability.reason ?? null);
        return;
      }

      // Wallet is installed — try to restore a prior authorization (no prompt).
      try {
        const address = await getWalletAddress();
        if (!address || cancelled) return;
        const network = await getWalletNetwork();
        const restored = { address, ...network };
        setWallet(restored);
        setError(null);
        onConnected?.(restored);
      } catch {
        // Ignore network-read failures on restore; user can reconnect explicitly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onConnected]);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      if (wallet) {
        // Toggle off: clear the local session only (Freighter retains permission).
        setWallet(null);
        return;
      }
      const connected = await connectWallet();
      setWallet(connected);
      setError(null);
      onConnected?.(connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={busy} variant={wallet ? 'outline' : 'default'}>
        {busy
          ? 'Connecting…'
          : wallet
            ? `${shortenAddress(wallet.address)} — disconnect`
            : 'Connect wallet'}
      </Button>
      {error && (
        <p className="max-w-[220px] text-right text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
