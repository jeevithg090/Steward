/**
 * `/computer`: the agent's screen at full size, with its activity and files beside it.
 * `?agent=` picks the agent (default `steward`); `?file=` points at a workspace file.
 */
import { Activity, FolderOpen } from "lucide-react";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Card } from "@/components/ui/Card.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Tabs } from "@/components/ui/Tabs.tsx";
import { DEFAULT_AGENT_ID } from "@/lib/api.ts";
import { ActivityList } from "./ActivityList.tsx";
import { AddressBar, HelpBanner, ScreenProblems, ScreenStatus, WheelButton } from "./ComputerControls.tsx";
import { ComputerScreen } from "./ComputerScreen.tsx";
import { FilesList } from "./FilesList.tsx";
import { ComputerSession, useComputer } from "./session.tsx";

export function ComputerPage() {
  const [params] = useSearchParams();
  const agentId = params.get("agent") || DEFAULT_AGENT_ID;
  const file = params.get("file") ?? undefined;
  return (
    <ComputerSession agentId={agentId}>
      <Page
        width="wide"
        title="Steward's computer"
        documentTitle="Computer"
        description="What Steward sees and does on its own computer. Take the wheel to use it yourself; hand it back when you're done."
      >
        <ComputerWorkspace highlightFile={file} />
      </Page>
    </ComputerSession>
  );
}

function ComputerWorkspace({ highlightFile }: { highlightFile?: string }) {
  const computer = useComputer();
  const [tab, setTab] = useState<"activity" | "files">(highlightFile ? "files" : "activity");
  const wheelRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <section aria-label="Screen" className="flex min-w-0 flex-col gap-3">
        <HelpBanner />
        <Card flush className="p-2">
          <ComputerScreen className="max-h-[75dvh]" onLeave={() => wheelRef.current?.focus()} />
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ScreenStatus className="min-w-0 flex-1" />
          <WheelButton buttonRef={wheelRef} size="md" />
        </div>
        <AddressBar />
        <ScreenProblems />
      </section>
      <Card as="section" aria-label="Activity and files" className="min-w-0">
        <Tabs
          label="Activity and files"
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "activity", label: "Activity", icon: Activity },
            { value: "files", label: "Files", icon: FolderOpen },
          ]}
        >
          {tab === "activity" ? (
            <ActivityList items={computer.activity} />
          ) : (
            <FilesList agentId={computer.agentId} highlight={highlightFile} />
          )}
        </Tabs>
      </Card>
    </div>
  );
}
