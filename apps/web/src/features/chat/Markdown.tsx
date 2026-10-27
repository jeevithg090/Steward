/**
 * Steward's replies as markdown, safely. Raw HTML in a reply is dropped, never rendered: the
 * `raw` plugin is left out and `skipHtml` is on, and what remains is sanitised and hardened. Links
 * open only after a confirmation (Streamdown's link safety), since a reply can quote a page that
 * was written to mislead.
 */
import { memo } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { cn } from "@/lib/utils.ts";

/** Sanitise and harden, in Streamdown's order, without the plugin that would pass raw HTML through. */
const REHYPE = Object.entries(defaultRehypePlugins)
  .filter(([name]) => name !== "raw")
  .map(([, plugin]) => plugin);

export const Markdown = memo(function Markdown({
  children,
  streaming = false,
  className,
}: {
  children: string;
  /** True while the text is still arriving, so half-written markdown is completed for display. */
  streaming?: boolean;
  className?: string;
}) {
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      parseIncompleteMarkdown={streaming}
      skipHtml
      rehypePlugins={REHYPE}
      controls={{ code: true, table: true, mermaid: false }}
      className={cn(
        "min-w-0 break-words text-body text-ink",
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2",
        "[&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5",
        "[&_code]:rounded [&_code]:bg-tile [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em]",
        "[&_h1]:text-title [&_h2]:text-title [&_h3]:text-body [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
        className,
      )}
    >
      {children}
    </Streamdown>
  );
});
