import type { Metadata } from "next";
import { ImportProfile } from "@/components/site/ImportProfile";

export const metadata: Metadata = {
  title: "Import a profile",
  description: "Open a Tempo profile somebody shared with you. Nothing is stored.",
};

export default function Page() {
  return <ImportProfile />;
}
