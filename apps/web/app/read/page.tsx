import type { Metadata } from "next";
import { ReadItToMe } from "@/components/site/ReadItToMe";

export const metadata: Metadata = {
  title: "Read it to me",
  description: "A photo of an official letter, read back in plain words: what it is, what it says, what to do by when.",
};

export default function Page() {
  return <ReadItToMe />;
}
