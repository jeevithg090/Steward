import { Download } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { BotActions, BotListingView, useListingPreview } from "@/components/bots/BotListingView.tsx";
import { packSource, sourceLine } from "@/components/bots/bots.ts";
import { LinkButton } from "@/components/ui/Button.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { ErrorNotice, Loading, Notice } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";

/**
 * `/bots/add?pack=<url>`: "Add to Steward" from the web, the phone or the command line lands here.
 * The pack is fetched by the server and shown as a listing, with where it comes from in plain
 * sight; nothing is added until the person says so. Only https addresses and local files are
 * accepted.
 */
export function BotAddPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const address = params.get("pack") ?? "";
  const source = packSource(address);
  const refused = source.kind === "refused";
  const preview = useListingPreview(refused ? undefined : { packUrl: address });
  const pack = preview.data?.pack;
  const title = pack?.name ?? "Add a bot";

  if (refused) {
    return (
      <Page title="Add a bot">
        <Notice tone="problem" role="alert" title="Steward can't add a bot from there">
          {source.reason}
        </Notice>
        <div>
          <LinkButton to="/bots">Browse the directory instead</LinkButton>
        </div>
      </Page>
    );
  }

  if (!pack) {
    return (
      <Page title={title}>
        {preview.isError ? (
          <ErrorNotice
            title="Couldn't fetch this bot"
            error={preview.error}
            onRetry={() => preview.mutate({ packUrl: address })}
          />
        ) : preview.isPending ? (
          <Loading>Fetching the bot…</Loading>
        ) : (
          <EmptyState
            title="Nothing to add"
            action={<LinkButton to="/bots">Browse the directory</LinkButton>}
          />
        )}
      </Page>
    );
  }

  return (
    <Page
      title={pack.name}
      documentTitle={`Add ${pack.name}`}
      description={<p>{pack.pitch}</p>}
      actions={
        <BotActions
          pack={pack}
          source={{ packUrl: address }}
          installed={preview.data?.alreadyInstalled}
          onInstalled={(row) => navigate(`/chat?agent=${encodeURIComponent(row.agentId)}`)}
          onCancel={() => navigate("/bots")}
        />
      }
    >
      <BotListingView
        pack={pack}
        preview={preview.data}
        level={2}
        lead={
          <Notice tone="neutral" role="note" title={sourceLine(source)}>
            <span className="inline-flex items-center gap-1">
              <Download aria-hidden="true" className="size-3.5" />
              Read what it does and what it may do before you add it. Its text is from outside Steward.
            </span>
          </Notice>
        }
      />
    </Page>
  );
}
