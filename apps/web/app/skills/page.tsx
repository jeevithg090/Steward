import type { Metadata } from "next";
import { SkillsPage } from "@/components/site/SkillsPage";

export const metadata: Metadata = {
  title: "Skills",
  description: "The skills a Tempo profile is made of, each with a manifest in plain words.",
};

export default function Page() {
  return <SkillsPage />;
}
