import type { BotPack } from "@steward/shared";
import { Download, ExternalLink } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Field, Input } from "@/components/ui/Field.tsx";
import { Notice } from "@/components/ui/Notice.tsx";
import { useBots, useExportBot } from "@/lib/api.ts";

/** A GitHub handle: letters, digits and single hyphens, at most 39 characters. */
const HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** Only a web address is linked: the directory's site comes from its index, which is third-party. */
function submitUrl(site: string | undefined): string | undefined {
  if (!site) return undefined;
  try {
    const url = new URL(site);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.href.replace(/\/+$/, "")}/submit`;
  } catch {
    return undefined;
  }
}

/**
 * Submit to the directory (plan §3.3): the made bot's folder as a zip, ready for a public GitHub
 * repository or gist, and the hosted directory's submit page, where a reviewer reads it before it
 * is listed. Steward never uploads anything itself.
 */
export function SubmitToDirectory({ pack, level = 3 }: { pack: BotPack; level?: 2 | 3 | 4 }) {
  const headingId = useId();
  const [handle, setHandle] = useState("");
  const bots = useBots({ limit: 1 });
  const exporter = useExportBot();
  const site = bots.data?.directory?.site;
  const submit = submitUrl(site);
  const clean = handle.trim().replace(/^@/, "");
  const handleError =
    clean && !HANDLE.test(clean) ? "A GitHub handle is letters, digits and single hyphens." : undefined;
  const Tag = `h${level}` as const;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 border-hair border-t pt-4">
      <Tag id={headingId} className="m-0 font-semibold text-body text-ink">
        Submit to the directory
      </Tag>
      <p className="m-0 text-sub text-ink-2">
        Share this bot with other people. Download its folder, put it in a public GitHub repository or gist,
        then paste that address on the directory's submit page. A person reads every bot before it is listed.
      </p>
      <Field
        label="Your GitHub handle"
        description="Optional. The bot is credited to you, and keeps a note that it began as an AI-made draft."
        error={handleError}
      >
        <Input
          value={handle}
          maxLength={40}
          autoComplete="username"
          onChange={(e) => setHandle(e.target.value)}
          placeholder="your-handle"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          icon={<Download />}
          loading={exporter.isPending}
          disabled={Boolean(handleError)}
          onClick={() => exporter.mutate({ pack, ...(clean ? { handle: clean } : {}) })}
        >
          Download the pack folder
        </Button>
        {submit ? (
          <a
            href={submit}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-accent text-sub underline-offset-2 hover:underline"
          >
            Open the submit page
            <ExternalLink aria-hidden className="size-3.5 shrink-0" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
      {exporter.isSuccess ? (
        <p role="status" className="m-0 text-sub text-ink-2">
          Saved {pack.id}.zip. Unzip it into a repository; for a gist, upload each skill as{" "}
          <code>&lt;skill name&gt;.SKILL.md</code>.
        </p>
      ) : null}
      {exporter.error ? (
        <p role="alert" className="m-0 font-medium text-problem text-sub">
          {exporter.error.message}
        </p>
      ) : null}
      {!submit && bots.isSuccess ? (
        <Notice tone="neutral" role="note">
          This Steward reads its bots from a folder on this machine, which takes no submissions. A hosted
          directory's submit page is its address followed by /submit.
        </Notice>
      ) : null}
    </section>
  );
}
