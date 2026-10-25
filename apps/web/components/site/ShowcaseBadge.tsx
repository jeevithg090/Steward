import { SHOWCASE_LABEL } from "@/lib/showcase";

/** Says out loud that this is a recording with no Gateway behind it (the honesty rule, §21). */
export function ShowcaseBadge() {
  return (
    <p
      role="status"
      className="rounded-full border-2 border-amber-700 bg-amber-50 px-4 py-1 text-sm font-semibold tracking-wide text-amber-900"
    >
      {SHOWCASE_LABEL}
    </p>
  );
}
