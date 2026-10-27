/**
 * What a card drawn inside a conversation can do: send words as the person's next message, tell
 * whether its call belongs to the latest turn, tell whether its call is waiting on an approval, and
 * bring the computer into view.
 *
 * Tool renderers are registered once for the whole app, but each card is drawn inside the
 * conversation it belongs to, so it reads these from context rather than from its registration.
 * Outside a conversation (a preview gallery) there is no context, and cards render without actions.
 */
import { createContext, useContext } from "react";

export interface ChatActions {
  threadId: string;
  /** The runtime agent this conversation talks to, e.g. `steward`. */
  agentId: string;
  /** Sends words as the person's next message. Ignored while a reply is running or an answer is owed. */
  send: (text: string) => void;
  /** True while a reply is running or an approval is waiting. */
  busy: boolean;
  /** Whether a tool call belongs to the newest turn, so its quick replies still make sense. */
  isLatestTurn: (toolCallId: string) => boolean;
  /** Whether a tool call is parked until the person answers its approval. */
  isAwaitingApproval: (toolCallId: string) => boolean;
  /** Brings Steward's computer into view: the side panel on wide screens, a sheet on small ones. */
  showComputer: () => void;
}

export const ChatActionsContext = createContext<ChatActions | null>(null);

export function useChatActions(): ChatActions | null {
  return useContext(ChatActionsContext);
}
