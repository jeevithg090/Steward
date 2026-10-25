import type { Metadata } from "next";
import { Landing } from "@/components/site/Landing";

export const metadata: Metadata = {
  title: "Tempo · Your time, returned",
  description: "An AI agent that wins back money and time. Models read and plan; code decides money, time and permissions.",
};

export default function Page() {
  return <Landing />;
}
