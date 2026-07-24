export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Coming soon</p>
    </div>
  );
}
