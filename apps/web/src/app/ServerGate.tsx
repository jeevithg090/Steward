import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Loading, Notice } from "@/components/ui/Notice.tsx";
import { type ApiError, isUnreachable, useInfo } from "@/lib/api.ts";

/** How often to look again while the server has never answered. */
export const SERVER_RETRY_MS = 5_000;

/**
 * Holds the app back until Steward's server has answered once, and says what is happening in the
 * meantime: connecting, or that the server isn't answering and how to start it. Without this the
 * app drew nothing while it waited, and when the server was down it mounted and unmounted every
 * page in a loop, each time asking the server for everything again.
 *
 * Once the server has answered, the app stays drawn whatever happens next: if the server goes away
 * later, each page says what it couldn't load.
 */
export function ServerGate({ children }: { children: ReactNode }) {
  const [answered, setAnswered] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const info = useInfo({
    // Only while nothing has loaded: after that, the pages' own queries notice a server that left.
    refetchInterval: (query) => (query.state.data === undefined && failure ? SERVER_RETRY_MS : false),
  });

  // Kept in state because a query with no data goes back to pending on every new try, so its error
  // would flash on and off; and once the app is drawn it must never be taken down again.
  if (info.data && !answered) setAnswered(true);
  if (info.error && info.error !== failure) setFailure(info.error);

  if (answered || info.data) return children;

  return (
    <div className="min-h-dvh bg-surface text-ink">
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-semibold text-display text-ink">Steward</h1>
        {failure ? (
          <Notice
            tone="problem"
            role="alert"
            // When the server did answer, with its own sentence, it isn't "not answering".
            title={isUnreachable(failure) ? "Steward isn't answering" : "Couldn't open Steward"}
            action={
              <Button size="sm" onClick={() => void info.refetch()}>
                Try again
              </Button>
            }
          >
            {!isUnreachable(failure) ? (
              <p>{failure.message}</p>
            ) : (
              <p>
                Its server may still be starting, or it isn't running. To start it, run{" "}
                <code className="font-mono">pnpm dev</code> in the Steward folder.
              </p>
            )}
            <p className="mt-1">This page tries again on its own every few seconds.</p>
          </Notice>
        ) : (
          <Loading>Connecting to Steward…</Loading>
        )}
      </main>
    </div>
  );
}
