import type { Metadata } from "next";
import { ProfilesPage } from "@/components/site/ProfilesPage";

export const metadata: Metadata = {
  title: "Profiles",
  description: "Who Tempo works for, which skills are on, how it speaks with you, and what it may never do.",
};

export default function Page() {
  return <ProfilesPage />;
}
