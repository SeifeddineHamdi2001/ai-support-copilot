import { cn } from '@/lib/utils';

/** Side-rail section: flat bordered surface, small title row, optional action on the right. */
export function Panel({
  title,
  caption,
  action,
  children,
  className,
  ...rest
}: {
  title: string;
  caption?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ComponentProps<'section'>, 'title'>) {
  return (
    <section
      aria-label={title}
      className={cn('border-border bg-surface rounded-xl border', className)}
      {...rest}
    >
      <header className="flex h-10 items-center gap-2 px-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {caption && <span className="text-muted-foreground text-xs">{caption}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="px-3 pb-3">{children}</div>
    </section>
  );
}
