import { Progress } from '@/components/ui/progress';

interface ApprovalProgressProps {
  /** Current approval count, as reported by the contract's get_approval_count. */
  approvals: number;
  /** Approval threshold required to withdraw, from the schedule. */
  threshold: number;
}

/**
 * Display-only progress toward a schedule's approval threshold. Both numbers come
 * straight from the contract — this component only renders them; it never
 * recomputes vesting or threshold logic.
 */
export function ApprovalProgress({ approvals, threshold }: ApprovalProgressProps) {
  const percent = threshold > 0 ? Math.min(100, Math.round((approvals / threshold) * 100)) : 0;
  const met = approvals >= threshold;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {approvals} of {threshold} approvals
        </span>
        <span className={met ? 'font-medium text-green-600' : undefined}>
          {met ? 'Threshold met — withdrawable' : 'Awaiting approvals'}
        </span>
      </div>
      <Progress value={percent} />
    </div>
  );
}
