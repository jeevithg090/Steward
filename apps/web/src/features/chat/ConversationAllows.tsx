/**
 * Above the message box: what the person allowed for this conversation only, each with Turn off.
 * Nothing shows when there is none. Turning one off is recorded, and Steward asks again next time.
 */
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button.tsx";
import { useConversationAllows, useTurnOffAllow } from "@/lib/api.ts";
import { cn } from "@/lib/utils.ts";

export function ConversationAllows({ threadId, className }: { threadId: string; className?: string }) {
  const allows = useConversationAllows(threadId);
  const turnOff = useTurnOffAllow();
  const list = allows.data ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-label="Allowed in this conversation" className={cn("mb-2", className)}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {list.map((allow) => (
          <li
            key={allow.id}
            className="flex flex-wrap items-center gap-x-2 rounded-field bg-done-soft px-3 py-1 text-caption text-ink"
          >
            <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-done" />
            <span className="min-w-0 flex-1" title={allow.name}>
              <span className="font-medium">Allowed in this conversation:</span> {allow.summary}, and the same
              again
            </span>
            <Button
              variant="link"
              size="sm"
              className="text-caption"
              aria-label={`Turn off: ${allow.summary}`}
              loading={turnOff.isPending && turnOff.variables?.allowId === allow.id}
              onClick={() =>
                turnOff.mutate(
                  { threadId, allowId: allow.id },
                  {
                    onSuccess: () =>
                      toast.success("Turned off", { description: "Steward will ask again next time." }),
                    onError: (error) => toast.error("Couldn't turn it off", { description: error.message }),
                  },
                )
              }
            >
              Turn off
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
