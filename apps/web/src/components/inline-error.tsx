import { describeError } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Problem Details shown in place: title + detail, with an optional action (Retry, Reload). */
export function InlineError({
  error,
  message,
  action,
  className,
}: {
  error?: unknown;
  /** Use instead of `error` for a notice that did not come from a failed request. */
  message?: { title: string; detail?: string };
  action?: React.ReactNode;
  className?: string;
}) {
  const { title, detail } = message ?? describeError(error);
  return (
    <div
      role="alert"
      className={cn(
        'border-danger/25 bg-danger-wash flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-danger font-medium">{title}</p>
        {detail && <p className="text-foreground/80 mt-0.5 text-xs">{detail}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
