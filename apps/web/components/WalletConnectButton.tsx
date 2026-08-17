'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  connectWallet,
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
 * already-authorized account on mount without prompting.
 */
export function WalletConnectButton({ onConnected }: WalletConnectButtonProps) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore an existing authorization on mount (no prompt).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const address = await getWalletAddress();
      if (!address || cancelled) return;
      try {
        const network = await getWalletNetwork();
        const restored = { address, ...network };
        setWallet(restored);
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
