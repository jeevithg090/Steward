// What every page receives (plan.md §4.6). Pages never read env or localStorage themselves.
import type { Gateway, Health } from "@/lib/api";
import type { LiveEvent } from "@/lib/live";
import type { Language } from "@/lib/shield";

export interface PageUser {
  id: string;
  name: string;
  profileId: string | null;
}

export interface PageProps {
  gateway: Gateway;
  user: PageUser;
  /** No Gateway: the `gateway` answers from recordings. */
  showcase: boolean;
  /** The Gateway's /health, when reachable. */
  health: Health | null;
  /** The live event stream is open (always false in showcase, where there is none). */
  connected?: boolean;
  /** Live Gateway events, newest first (empty in showcase). */
  events: LiveEvent[];
  /** The language Tempo speaks to this person (Settings): en, hi, pa, pl, ur, cy. */
  language: Language;
  /** Route params, e.g. `{id}` on `/missions/:id`. */
  params: Record<string, string>;
  /** Have the avatar read a sentence aloud (no-op when voice is off). */
  speak: (text: string) => void;
  /** Change who Tempo is working for (the profile picker on /profiles). */
  setProfile: (profileId: string | null) => void;
}
