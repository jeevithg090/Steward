/**
 * Registers how every tool call is drawn: a `useRenderTool` for each of Steward's built-in tools,
 * and a wildcard for everything else (MCP tools, tools added later) as a humanised line.
 *
 * Renderers are registered once, under the provider, for every agent and thread. Each card is
 * still drawn inside its own conversation, so it reads that conversation's actions from context.
 */
import { useRenderTool } from "@copilotkit/react-core/v2";
import type { ComponentType } from "react";
import { z } from "zod";
import type { ToolProps } from "./tool-cards.tsx";
import { GenericToolLine } from "./tool-cards.tsx";
import { type RawRenderProps, RENDERERS, renderWith } from "./tool-registry.tsx";

/**
 * The renderers draw from whatever arguments arrive, so the schema accepts any object. The agent
 * package owns the real parameter schemas; the cards read them defensively.
 */
const ANY_ARGS = z.object({}).passthrough();

function Registration({ name, Renderer }: { name: string; Renderer: ComponentType<ToolProps> }) {
  useRenderTool({ name, parameters: ANY_ARGS, render: (raw) => renderWith(Renderer, raw) }, [name]);
  return null;
}

function WildcardRegistration() {
  useRenderTool({ name: "*", render: (raw: RawRenderProps) => renderWith(GenericToolLine, raw) }, []);
  return null;
}

/** Mount once under the CopilotKit provider. */
export function StewardToolRenderers() {
  return (
    <>
      {(Object.entries(RENDERERS) as [string, ComponentType<ToolProps>][]).map(([name, Renderer]) => (
        <Registration key={name} name={name} Renderer={Renderer} />
      ))}
      <WildcardRegistration />
    </>
  );
}
