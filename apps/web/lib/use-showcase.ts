"use client";

import { useEffect, useMemo, useState } from "react";
import { CatalogClient, type CatalogSource } from "./catalog-client";
import { ShowcaseCatalog, isShowcaseEnv, isShowcaseQuery } from "./showcase";

export interface ShowcaseState {
  /** Showcase mode is on: no Gateway is called. */
  active: boolean;
  /** It was switched on by `?showcase=1` on this page (so links keep it). */
  viaUrl: boolean;
  /** An internal link that keeps `?showcase=1` when that is how we got here. */
  href: (path: string) => string;
}

/** Showcase is on for the build (NEXT_PUBLIC_TEMPO_SHOWCASE=1) or for this page (`?showcase=1`). */
export function useShowcase(forced?: boolean): ShowcaseState {
  const env = isShowcaseEnv();
  const [viaUrl, setViaUrl] = useState(false);
  useEffect(() => {
    if (isShowcaseQuery(window.location.search)) setViaUrl(true);
  }, []);
  const active = forced ?? (env || viaUrl);
  return useMemo(
    () => ({
      active,
      viaUrl,
      href: (path: string) => {
        if (!viaUrl || !path.startsWith("/") || path.includes("showcase=1")) return path;
        const [base, hash] = path.split("#");
        const joiner = base!.includes("?") ? "&" : "?";
        return `${base}${joiner}showcase=1${hash ? `#${hash}` : ""}`;
      },
    }),
    [active, viaUrl],
  );
}

/** The catalogue source for this page: recorded JSON in showcase, the Gateway otherwise. */
export function useCatalog(injected?: CatalogSource): { source: CatalogSource; showcase: ShowcaseState } {
  const showcase = useShowcase(injected?.showcase);
  const source = useMemo(
    () => injected ?? (showcase.active ? new ShowcaseCatalog() : new CatalogClient()),
    [injected, showcase.active],
  );
  return { source, showcase };
}
