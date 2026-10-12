import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Initials disc for agents. Neutral on purpose: color is reserved for status and priority. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      title={name}
      className={cn(
        'bg-border text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-medium',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
