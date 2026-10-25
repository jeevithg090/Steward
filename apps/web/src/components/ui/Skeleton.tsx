// Loading placeholders in the theme (plan.md §12.4): light sweeping across where content will be,
// so a page keeps its shape while it loads. Announced once as "Loading" for screen readers.

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block rounded-lg bg-[linear-gradient(90deg,rgb(255_255_255/0.04),rgb(255_255_255/0.1),rgb(255_255_255/0.04))] bg-[length:200%_100%] animate-shimmer motion-reduce:animate-none ${className}`}
    />
  );
}

/** A stack of card-shaped placeholders, e.g. while a list loads. */
export function SkeletonCards({ count = 3, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface rounded-3xl p-5">
          <Skeleton className="mb-3 h-4 w-1/3" />
          <Skeleton className="mb-2 h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
