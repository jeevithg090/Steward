"use client";

import { useEffect } from "react";

/**
 * The Gateway builds device-pairing links as `<web origin>/#pair=<code>`. Mission Control now
 * lives at /control, so the landing hands the link on, keeping the fragment (it never reaches
 * a server log). Runs before anything else on the landing is interactive.
 */
export function PairRedirect({ navigate }: { navigate?: (url: string) => void }) {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#pair=")) return;
    (navigate ?? ((url: string) => window.location.replace(url)))(`/control${hash}`);
  }, [navigate]);
  return null;
}
