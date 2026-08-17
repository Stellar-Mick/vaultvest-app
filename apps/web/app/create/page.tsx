import Link from 'next/link';

import { CreateScheduleForm } from '@/components/CreateScheduleForm';
import { Button } from '@/components/ui/button';

/**
 * Funder flow: create a vesting schedule. Server component shell around the
 * client-side {@link CreateScheduleForm}.
 */
export default function CreatePage() {
  return (
    <main className="container flex min-h-screen flex-col py-12">
      <div className="mb-8">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">← Home</Link>
        </Button>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Create a schedule</h1>
        <p className="mt-2 text-muted-foreground">
          Escrow tokens into a vesting schedule and define its signer set and
          approval threshold.
        </p>
      </div>
      <div className="max-w-2xl">
        <CreateScheduleForm />
      </div>
    </main>
  );
}
