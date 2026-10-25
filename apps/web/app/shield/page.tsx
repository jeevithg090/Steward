import type { Metadata } from "next";
import { ShieldPage } from "./ShieldPage";

export const metadata: Metadata = {
  title: "Scam Shield",
  description: "Paste a message you are unsure of. Tempo checks the words, the links, the registers and public phishing lists, and says what it found, in your language.",
};

export default function Page() {
  return <ShieldPage />;
}
