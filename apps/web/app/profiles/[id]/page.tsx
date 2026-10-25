import type { Metadata } from "next";
import { ProfileDetail } from "@/components/site/ProfileDetail";

export const metadata: Metadata = {
  title: "Profile",
  description: "One Tempo profile in full, with a share link and the YAML file.",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfileDetail id={id} />;
}
