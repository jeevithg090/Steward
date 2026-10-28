import { ArrowLeft, Bot } from "lucide-react";
import { Link, useParams } from "react-router";
import { BotActions, BotListingView, useListingPreview } from "@/components/bots/BotListingView.tsx";
import { LinkButton } from "@/components/ui/Button.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { useBots, useInstalledBots } from "@/lib/api.ts";

/**
 * `/bots/:id`: one bot's listing. The directory row is looked up by id; the pack and what it means
 * here come from a preview. A bot the directory does not list (one made here) is shown from its
 * installed row, since there is no pack to preview.
 */

const BACK = (
  <Link
    to="/bots"
    className="inline-flex min-h-target items-center gap-1 text-accent text-sub no-underline hover:underline"
  >
    <ArrowLeft aria-hidden="true" className="size-4" />
    All bots
  </Link>
);

export function BotListingPage() {
  const { id = "" } = useParams();
  const list = useBots({ q: id, limit: 100 });
  const installed = useInstalledBots();
  const listing = list.data?.bots.find((bot) => bot.id === id);
  const mine = installed.data?.find((bot) => bot.id === id);
  // Not in the first page of the directory: the index's own layout puts packs at packs/<id>.json.
  const packUrl = listing?.packUrl ?? (list.isSuccess ? `packs/${id}.json` : undefined);
  const preview = useListingPreview(packUrl ? { packUrl } : undefined);
  const pack = preview.data?.pack;
  const name = pack?.name ?? listing?.name ?? mine?.name ?? "Bot";

  if (list.isPending || (preview.isPending && !pack)) {
    return (
      <Page title={name} documentTitle={name} description={BACK}>
        <Loading>Loading {name === "Bot" ? "the bot" : name}…</Loading>
      </Page>
    );
  }

  if (!pack) {
    const problem = list.error ?? preview.error;
    return (
      <Page title={name} documentTitle={name} description={BACK}>
        {mine ? (
          <EmptyState
            icon={Bot}
            title={`${mine.name} is not in the directory`}
            action={
              <LinkButton to={`/chat?agent=${encodeURIComponent(mine.agentId)}`} variant="primary">
                Talk to it
              </LinkButton>
            }
          >
            It was {mine.source === "local" ? "made here" : `added from ${mine.source}`} (version{" "}
            {mine.version}). Remove it from the Bots page if you no longer want it.
          </EmptyState>
        ) : problem ? (
          <ErrorNotice
            title="Couldn't load this bot"
            error={problem}
            onRetry={() => (packUrl ? preview.mutate({ packUrl }) : void list.refetch())}
          />
        ) : (
          <EmptyState
            icon={Bot}
            title="No bot by that name"
            action={<LinkButton to="/bots">Browse the directory</LinkButton>}
          >
            It may have been removed from the directory, or the link is wrong.
          </EmptyState>
        )}
      </Page>
    );
  }

  return (
    <Page
      title={pack.name}
      documentTitle={pack.name}
      description={BACK}
      actions={
        packUrl ? (
          <BotActions pack={pack} source={{ packUrl }} installed={preview.data?.alreadyInstalled ?? mine} />
        ) : undefined
      }
    >
      <BotListingView
        pack={pack}
        listing={listing}
        preview={preview.data}
        previewPending={preview.isPending}
        previewError={preview.error?.message}
        onRetryPreview={() => (packUrl ? preview.mutate({ packUrl }) : undefined)}
        level={2}
      />
    </Page>
  );
}
