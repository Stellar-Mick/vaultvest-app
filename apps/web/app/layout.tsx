import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

import { SiteHeader } from '@/components/SiteHeader';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import { WalletProvider } from '@/components/WalletProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'VaultVest',
  description:
    'Governance-gated token vesting on Stellar — funders create vesting schedules, signers approve releases, beneficiaries withdraw.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint. The string is a build-time
            constant from ThemeToggle, not user input. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${inter.className} min-h-screen antialiased`}>
        <WalletProvider>
          <SiteHeader />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
