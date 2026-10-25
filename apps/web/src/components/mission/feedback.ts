// One way to tell the person something went wrong (plan.md §12.2): plain words in a toast, and when
// the Gateway did not answer at all, a button to Settings where they can fix the address or switch
// to the showcase.
import { toast } from "@/components/ui";
import { navigate } from "@/router";
import { isUnreachable, plainError } from "./words";

/** Show `err` as an error toast and return the words used (for an inline line too). */
export function toastError(err: unknown): string {
  const words = plainError(err);
  toast.error(words, isUnreachable(err) ? { label: "Settings", onClick: () => navigate("/settings") } : undefined);
  return words;
}
