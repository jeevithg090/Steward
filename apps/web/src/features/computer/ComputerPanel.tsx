/**
 * The agent's computer beside the conversation: its live screen with "Take the wheel", what it did
 * (Activity) and what it saved (Files). Inside a chat it shares the chat's connection; anywhere else
 * it opens its own.
 */
import { Activity, FolderOpen, Monitor } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Tabs } from "@/components/ui/Tabs.tsx";
import { DEFAULT_AGENT_ID } from "@/lib/api.ts";
import { cn } from "@/lib/utils.ts";
import { ActivityList } from "./ActivityList.tsx";
import { AddressBar, HelpBanner, ScreenProblems, ScreenStatus, WheelButton } from "./ComputerControls.tsx";
import { ComputerScreen } from "./ComputerScreen.tsx";
import { FilesList } from "./FilesList.tsx";
import { ComputerSession, type ComputerSessionProps, useComputer, useOptionalComputer } from "./session.tsx";

export type ComputerTab = "screen" | "activity" | "files";

export interface ComputerPanelProps {
  agentId?: string;
  /** Controls drawn in the panel's header, such as the chat's "Hide". */
  actions?: ReactNode;
  /** The tab shown first. */
  initialTab?: ComputerTab;
  /** A workspace file to point at in the Files tab. */
  highlightFile?: string;
  /** Heading level of the panel title. */
  headingLevel?: 2 | 3;
  /** False inside a dialog that already names the computer; the heading is then for screen readers only. */
  showTitle?: boolean;
  className?: string;
  /** For tests: how the panel opens its socket when it has no session to share. */
  openSocket?: ComputerSessionProps["openSocket"];
}

export function ComputerPanel({ agentId = DEFAULT_AGENT_ID, openSocket, ...props }: ComputerPanelProps) {
  const shared = useOptionalComputer();
  if (shared && shared.agentId === agentId) return <PanelBody {...props} />;
  return (
    <ComputerSession agentId={agentId} openSocket={openSocket}>
      <PanelBody {...props} />
    </ComputerSession>
  );
}

function PanelBody({
  actions,
  initialTab = "screen",
  highlightFile,
  headingLevel = 2,
  showTitle = true,
  className,
}: Omit<ComputerPanelProps, "agentId" | "openSocket">) {
  const computer = useComputer();
  const [tab, setTab] = useState<ComputerTab>(initialTab);
  const wheelRef = useRef<HTMLButtonElement>(null);
  const Heading = `h${headingLevel}` as const;
  const titleId = useId();
  const helpAsked = Boolean(computer.status?.help);

  // When Steward asks for help, the screen is what the person needs to see.
  useEffect(() => {
    if (helpAsked) setTab("screen");
  }, [helpAsked]);

  return (
    <section aria-labelledby={titleId} className={cn("flex min-h-0 flex-col gap-3", className)}>
      <header className={cn("flex items-center justify-between gap-2", !showTitle && !actions && "sr-only")}>
        <Heading
          id={titleId}
          className={cn("m-0 font-semibold text-ink text-title", !showTitle && "sr-only")}
        >
          Steward's computer
        </Heading>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </header>
      <Tabs
        label="Steward's computer"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "screen", label: "Screen", icon: Monitor },
          { value: "activity", label: "Activity", icon: Activity },
          { value: "files", label: "Files", icon: FolderOpen },
        ]}
      >
        {tab === "screen" ? (
          <div className="flex flex-col gap-3">
            <HelpBanner />
            <ComputerScreen onLeave={() => wheelRef.current?.focus()} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ScreenStatus className="min-w-0 flex-1" />
              <WheelButton buttonRef={wheelRef} />
            </div>
            <AddressBar />
            <ScreenProblems />
          </div>
        ) : tab === "activity" ? (
          <ActivityList items={computer.activity} />
        ) : (
          <FilesList agentId={computer.agentId} highlight={highlightFile} />
        )}
      </Tabs>
    </section>
  );
}
