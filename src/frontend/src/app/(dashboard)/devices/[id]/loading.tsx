/**
 * The device page while its settings are read from the device (up to a
 * couple of seconds over Bluetooth). Mirrors the page's layout -- the header
 * grid of name, battery and visual, the battery history, then the settings
 * sections -- so nothing
 * moves when the real content replaces it.
 */

import type { ReactNode } from "react";

function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-border ${className}`} />;
}

function Card({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-surface ${className}`}>{children}</div>;
}

/** A settings section: a title, then a few label + control rows. */
function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="p-5">
      <Bar className="h-4 w-28" />
      <div className="mt-5 space-y-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <Bar className="h-3 w-20" />
              <Bar className="h-3 w-10" />
            </div>
            <Bar className="h-2 w-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Loading() {
  return (
    <main className="animate-pulse" aria-busy="true" aria-label="Reading the device">
      <Bar className="mb-4 h-4 w-20" />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Bar className="size-5" />
              <Bar className="h-6 w-48" />
            </div>
            <Bar className="mt-2 h-3.5 w-36" />
            <Bar className="mt-4 h-3.5 w-24" />
          </Card>
          <Card className="p-4">
            <div className="flex items-baseline justify-between">
              <Bar className="h-8 w-20" />
              <Bar className="h-3 w-16" />
            </div>
            <Bar className="mt-3 h-2 w-full" />
            <Bar className="mt-3 h-3 w-24" />
          </Card>
        </div>
        <Card className="min-h-56" />
      </div>

      <Card className="mb-6 p-5">
        <div className="flex items-center justify-between">
          <Bar className="h-4 w-28" />
          <Bar className="h-6 w-32" />
        </div>
        <Bar className="mt-4 h-[200px] w-full" />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <SectionSkeleton rows={4} />
        <SectionSkeleton rows={3} />
        <SectionSkeleton rows={3} />
        <SectionSkeleton rows={2} />
      </div>
    </main>
  );
}
