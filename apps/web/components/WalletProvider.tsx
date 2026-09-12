'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  connectWallet,
  detectWallet,
  getWalletAddress,
  getWalletNetwork,
  type ConnectedWallet,
} from '@/lib/freighter';
import { APP_NETWORK_PASSPHRASE } from '@/lib/tx-guard';

interface WalletContextValue {
  /** The connected wallet, or `null` when not connected. */
  wallet: ConnectedWallet | null;
  /** True while a connect request is in flight. */
  connecting: boolean;
  /** True until the on-mount restore attempt has settled. */
  restoring: boolean;
  /** Most recent connect/detect error, if any. */
  error: string | null;
  /**
   * True when a wallet is connected but on a different network than this
   * deployment is configured for. Write flows will refuse to sign in this
   * state; surfacing it here lets the UI say so before the user gets that far.
   */
  wrongNetwork: boolean;
  /** Prompt Freighter for access. */
  connect: () => Promise<void>;
  /** Forget the local session (Freighter itself retains the permission). */
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * App-wide wallet session.
 *
 * Wallet state used to live inside each page, so navigating between Create,
 * Approve, and Dashboard dropped the connection and forced a reconnect on
 * every screen. Lifting it into a provider mounted in the root layout keeps
 * one session for the whole app and lets the header show connection status
 * everywhere. The restore-on-mount logic that each button used to run
 * independently now runs exactly once.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restore a prior authorization without prompting.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const availability = detectWallet();
        if (!availability.available) {
          if (!cancelled) setError(availability.reason ?? null);
          return;
        }
        const address = await getWalletAddress();
        if (!address || cancelled) return;
        const network = await getWalletNetwork();
        if (!cancelled) setWallet({ address, ...network });
      } catch {
        // Restore is best-effort; the user can connect explicitly.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      setWallet(await connectWallet());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet.');
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setError(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      connecting,
      restoring,
      error,
      wrongNetwork:
        wallet !== null &&
        APP_NETWORK_PASSPHRASE !== '' &&
        wallet.networkPassphrase !== APP_NETWORK_PASSPHRASE,
      connect,
      disconnect,
    }),
    [wallet, connecting, restoring, error, connect, disconnect]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

/**
 * Access the app-wide wallet session.
 *
 * @throws {Error} when used outside {@link WalletProvider}
 */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within <WalletProvider>.');
  }
  return ctx;
}
