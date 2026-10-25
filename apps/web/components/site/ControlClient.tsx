"use client";

import { useMemo } from "react";
import { MissionControl } from "@/components/MissionControl";
import { ShowcaseGateway, ShowcaseMesh } from "@/lib/showcase";

/**
 * Mission Control, unchanged. With no showcase it builds its own Gateway and Mesh clients from
 * the environment, exactly as the old `/` did; in showcase it runs on the recorded replies.
 */
export function ControlClient({ showcase }: { showcase: boolean }) {
  const clients = useMemo(() => (showcase ? { gateway: new ShowcaseGateway(), mesh: new ShowcaseMesh() } : null), [showcase]);
  return clients ? <MissionControl gateway={clients.gateway} mesh={clients.mesh} /> : <MissionControl />;
}
