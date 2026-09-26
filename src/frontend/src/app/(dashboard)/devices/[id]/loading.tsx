export default function Loading() {
  return (
    <main className="animate-pulse">
      <div className="mb-4 h-4 w-20 rounded bg-border" />
      <div className="mb-6 h-16 rounded-2xl bg-surface" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-48 rounded-2xl border border-border bg-surface" />
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">Reading the device…</p>
    </main>
  );
}
