import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteChrome } from "@/components/site/SiteChrome";
import { BOOT_SCRIPT } from "@/lib/a11y-prefs";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tempo", template: "%s · Tempo" },
  description: "Your time, returned. An AI agent that wins back money and time; code decides money, time and permissions.",
};

export const viewport: Viewport = { themeColor: "#115e59" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The boot script sets data-text-size and data-plain from this browser's saved settings
    // before paint, so hydration must not complain about <html> attributes it did not render.
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
