"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useShowcase } from "@/lib/use-showcase";
import { A11yControls } from "./A11yControls";
import { ShowcaseBadge } from "./ShowcaseBadge";
import { DOCS, GITHUB } from "./ui";

export const NAV = [
  { href: "/", label: "Home" },
  { href: "/control", label: "Mission Control" },
  { href: "/profiles", label: "Profiles" },
  { href: "/skills", label: "Skills" },
  { href: "/read", label: "Read it to me" },
  { href: "/shield", label: "Scam Shield" },
  { href: "/accessibility", label: "Accessibility" },
];

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Skip link, header, the accessibility controls, the main landmark and the honest footer. */
export function SiteChrome({ children, pathname: forcedPath }: { children: ReactNode; pathname?: string }) {
  const routerPath = usePathname() as string | null;
  const pathname = forcedPath ?? routerPath ?? "/";
  const showcase = useShowcase();
  // Mission Control brings its own <main>; wrapping it in another would make two main landmarks.
  const Main = pathname === "/control" ? "div" : "main";

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-teal-800 focus:px-5 focus:py-3 focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <header className="border-b-2 border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href={showcase.href("/")} className="inline-flex min-h-11 items-center text-2xl font-bold text-teal-900 no-underline">
            Tempo
          </Link>
          <nav aria-label="Main">
            <ul className="flex flex-wrap items-center gap-1">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={showcase.href(item.href)}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-lg px-3 font-medium ${
                      isCurrent(pathname, item.href) ? "bg-teal-50 text-teal-900 underline decoration-2 underline-offset-4" : "text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={GITHUB} rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-slate-800 hover:bg-slate-100">
                  GitHub
                </a>
              </li>
            </ul>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            {showcase.active && <ShowcaseBadge />}
            <A11yControls compact />
          </div>
        </div>
      </header>

      <Main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </Main>

      <footer className="border-t-2 border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 text-slate-700 sm:px-6">
          <p className="font-medium text-slate-900">
            Models read and plan; code decides money, time and permissions. Nothing is filed without your signed yes, and STOP stops everything.
          </p>
          <p className="mt-2 text-sm">
            Rule packs, clocks and benefit figures are demo values until a person checks each source. The badge at the top of Mission Control says what is real
            in this run.
            {showcase.active && " This showcase is a recording of a replay-mode Gateway: no company, model or person was contacted."}
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <li><a href={DOCS.security} rel="noopener noreferrer" className="underline">How we keep it safe</a></li>
            <li><a href={DOCS.accessibility} rel="noopener noreferrer" className="underline">Accessibility statement</a></li>
            <li><a href={DOCS.addUseCase} rel="noopener noreferrer" className="underline">Add your use case</a></li>
            <li><a href={GITHUB} rel="noopener noreferrer" className="underline">Source on GitHub (Apache-2.0)</a></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
