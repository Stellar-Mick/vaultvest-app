'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { useWallet } from '@/components/WalletProvider';
import { IS_MAINNET, NETWORK_LABEL } from '@/lib/explorer';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/create', label: 'Create' },
  { href: '/approve', label: 'Approve' },
  { href: '/dashboard', label: 'Dashboard' },
] as const;

/**
 * Persistent header: brand, role navigation, network badge, and the wallet
 * control. Mounted once in the root layout so the wallet session is visible
 * and reachable from every page.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const { wallet, wrongNetwork } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center gap-4">
        <Link href="/" className="font-semibold tracking-tight">
          VaultVest
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {wrongNetwork && wallet ? (
            <Badge variant="destructive" className="gap-1">
              <ShieldAlert className="h-3 w-3" />
              Wallet on {wallet.network} — switch to {NETWORK_LABEL}
            </Badge>
          ) : (
            <Badge variant={IS_MAINNET ? 'default' : 'secondary'}>
              {NETWORK_LABEL}
            </Badge>
          )}
          <ThemeToggle />
          <WalletConnectButton hideError size="sm" />
        </div>
      </div>

      {/* Mobile nav sits below the bar so the wallet control stays reachable. */}
      <nav className="container flex gap-1 pb-2 sm:hidden">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-center text-sm transition-colors',
              pathname === href
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
