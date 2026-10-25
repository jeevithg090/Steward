import type { Metadata } from "next";
import { ControlClient } from "@/components/site/ControlClient";
import { isShowcaseEnv } from "@/lib/showcase";

export const metadata: Metadata = {
  title: "Mission Control",
  description: "Live view of Tempo's missions: the question, the proof, the court, the ledger.",
};

/** `?showcase=1` is read on the server so the right clients are used from the first render. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const showcase = isShowcaseEnv() || query.showcase === "1";
  return <ControlClient showcase={showcase} />;
}
