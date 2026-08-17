import Link from 'next/link';
import { BadgeCheck, Landmark, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Landing page — a static server component describing the product and linking to
 * the three role flows. No wallet or RPC access here.
 */
export default function LandingPage() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center py-16">
      <div className="flex max-w-2xl flex-col items-center text-center">
        <Badge className="mb-4" variant="secondary">
          Stellar Testnet
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          VaultVest
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Governance-gated token vesting on Stellar. Funders lock tokens into
          vesting schedules; a signer set approves releases; beneficiaries
          withdraw once approvals clear the threshold.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/create">Create a schedule</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/dashboard">View dashboard</Link>
          </Button>
        </div>
      </div>

      <div className="mt-16 grid w-full max-w-4xl gap-6 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <Landmark className="mb-2 h-6 w-6 text-muted-foreground" />
            <CardTitle>Funder</CardTitle>
            <CardDescription>
              Escrow tokens into a vesting schedule and define its signer set and
              approval threshold.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="link" className="px-0">
              <Link href="/create">Create a schedule →</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <BadgeCheck className="mb-2 h-6 w-6 text-muted-foreground" />
            <CardTitle>Signer</CardTitle>
            <CardDescription>
              Review pending releases and approve them. Withdrawals unlock once
              approvals meet the threshold.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="link" className="px-0">
              <Link href="/approve">Approve releases →</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Lock className="mb-2 h-6 w-6 text-muted-foreground" />
            <CardTitle>Beneficiary</CardTitle>
            <CardDescription>
              Track vested amounts and withdraw tokens to your wallet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="link" className="px-0">
              <Link href="/dashboard">Open dashboard →</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
