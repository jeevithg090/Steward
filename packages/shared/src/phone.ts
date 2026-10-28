/**
 * The phone catalogue (docs/plans/phone-and-shortcuts.md §4.3): what a person's Steward offers to
 * a shortcut or the phone app, built from their profile, and the server-driven UI those thin
 * clients interpret. Bots contribute launchers to it.
 */

export type DeviceScope =
  | "brief:read"
  | "approvals:read"
  | "approvals:decide"
  | "chat"
  | "tasks"
  | "routines:run";

/** A fixed vocabulary a shortcut can act on, so new features ship as server responses. */
export type DeviceUi =
  | { say: string }
  | { show: { title: string; body: string } }
  | { choose: { title: string; options: { label: string; post: string; body?: unknown }[] } }
  | { ask: { prompt: string; post: string; field: string } }
  | { open: string };

export interface CatalogueEntry {
  id: string;
  title: string;
  description: string;
  /** "Steward: What needs me?" */
  siriPhrase?: string;
  action: {
    kind: "say" | "brief" | "approvals" | "check" | "skill" | "routine" | "bot" | "tenant";
    /** The skill name, routine id, bot id or tenant shortcut id the action refers to. */
    ref?: string;
  };
  scopes: DeviceScope[];
  source: "core" | "skill" | "routine" | "bot" | "tenant";
  /**
   * For bot and tenant entries: what Steward is asked, with `{input}` where the person's words go
   * (dictated, typed or shared). Runs as a normal turn through the gateway.
   */
  prompt?: string;
}
