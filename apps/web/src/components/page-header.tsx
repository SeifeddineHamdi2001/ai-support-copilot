/** Top bar of an app page: title, optional count, actions on the right. */
export function PageHeader({
  title,
  count,
  children,
}: {
  title: React.ReactNode;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <header className="border-border flex h-12 shrink-0 items-center gap-2 border-b px-5">
      <h1 className="truncate text-[15px] font-semibold">{title}</h1>
      {count !== undefined && (
        <span className="text-muted-foreground tabular font-mono text-xs">{count}</span>
      )}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}
