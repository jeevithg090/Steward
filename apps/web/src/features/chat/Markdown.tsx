/**
 * Steward's replies as markdown, safely. Raw HTML in a reply is dropped, never rendered: the
 * `raw` plugin is left out and `skipHtml` is on, and what remains is sanitised and hardened. Links
 * open only after a confirmation (Streamdown's link safety), since a reply can quote a page that
 * was written to mislead.
 *
 * Images are never loaded. Fetching one would send its address, and whatever a prompt injection
 * packed into it, to any host with no tool call, no decision and no record. Each image shows as
 * "[Image not loaded: …]" with its address as a link, behind the same confirmation.
 */
import { memo } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { cn } from "@/lib/utils.ts";

type Pluggable = (typeof defaultRehypePlugins)[string];

/** A hast node, as far as this file looks into it. */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

const text = (value: string): HastNode => ({ type: "text", value });

function blockedImage(image: HastNode, insideLink: boolean): HastNode {
  const alt = typeof image.properties?.alt === "string" ? image.properties.alt.trim() : "";
  const src = typeof image.properties?.src === "string" ? image.properties.src : "";
  const children = [text(alt ? `[Image not loaded: ${alt}]` : "[Image not loaded]")];
  // A link inside a link would nest; the outer one already leads somewhere.
  if (/^https?:\/\//i.test(src) && !insideLink) {
    children.push(text(" "), {
      type: "element",
      tagName: "a",
      properties: { href: src },
      children: [text(src)],
    });
  }
  return {
    type: "element",
    tagName: "span",
    properties: { className: ["text-ink-2", "break-all"] },
    children,
  };
}

function replaceImages(node: HastNode, insideLink: boolean): void {
  if (!node.children) return;
  const linked = insideLink || node.tagName === "a";
  node.children = node.children.map((child) => {
    if (child.type === "element" && child.tagName === "img") return blockedImage(child, linked);
    replaceImages(child, linked);
    return child;
  });
}

/** Turns every image into text and a link. Runs before hardening, so that link is hardened too. */
function imagesAsLinks() {
  return (tree: HastNode) => replaceImages(tree, false);
}

/** Hardening that lets no image through, not even a `data:` one, should anything still carry one. */
function withoutImages(harden: Pluggable): Pluggable {
  if (!Array.isArray(harden)) return harden;
  const [plugin, options] = harden;
  return [plugin, { ...(options as object), allowedImagePrefixes: [], allowDataImages: false }];
}

/** Sanitise and harden, in Streamdown's order, without the plugin that would pass raw HTML through. */
const REHYPE: Pluggable[] = Object.entries(defaultRehypePlugins)
  .filter(([name]) => name !== "raw")
  .flatMap(([name, plugin]) => (name === "harden" ? [imagesAsLinks, withoutImages(plugin)] : [plugin]));

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
