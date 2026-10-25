import Link from "next/link";
import type { ReactNode } from "react";
import type { ProfileStatus, SkillStatus } from "@/lib/profiles";

export const GITHUB = "https://github.com/jeevithg090/Tempo";
export const DOCS = {
  addUseCase: `${GITHUB}/blob/main/docs/add-a-usecase.md`,
  security: `${GITHUB}/blob/main/docs/security.md`,
  accessibility: `${GITHUB}/blob/main/docs/accessibility.md`,
  profiles: `${GITHUB}/blob/main/docs/profiles.md`,
};

/** Plain words for a status, said out loud (honesty is a product rule). */
export const STATUS_WORDS: Record<SkillStatus | ProfileStatus, string> = {
  ready: "ready",
  "demo-values": "demo values: not yet checked against the published terms",
  experimental: "experimental",
  starter: "starter profile by the Tempo team",
  community: "community profile",
};

export function Chip({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "teal" | "amber" | "rose" }) {
  const tones = {
    slate: "border-slate-400 bg-white text-slate-800",
    teal: "border-teal-700 bg-teal-50 text-teal-900",
    amber: "border-amber-700 bg-amber-50 text-amber-900",
    rose: "border-rose-700 bg-rose-50 text-rose-900",
  };
  return <span className={`inline-block rounded-full border-2 px-3 py-1 text-sm font-medium ${tones[tone]}`}>{children}</span>;
}

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <article id={id} className={`rounded-xl border-2 border-slate-200 bg-white p-5 ${className}`}>
      {children}
    </article>
  );
}

export function PageIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">{title}</h1>
      {children && <div className="mt-3 max-w-3xl text-lg text-slate-700">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border-2 border-rose-300 bg-rose-50 p-4 text-rose-900">
      {children}
    </p>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-amber-950">{children}</p>;
}

const BUTTON = {
  primary: "bg-teal-800 text-white hover:bg-teal-900",
  secondary: "border-2 border-teal-800 text-teal-900 hover:bg-teal-50",
  quiet: "border-2 border-slate-700 text-slate-900 hover:bg-slate-100",
};

export function buttonClass(kind: keyof typeof BUTTON = "primary"): string {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 py-2 font-semibold no-underline disabled:opacity-50 ${BUTTON[kind]}`;
}

export function ButtonLink({ href, kind = "primary", children }: { href: string; kind?: keyof typeof BUTTON; children: ReactNode }) {
  const external = /^https?:/.test(href);
  if (external) {
    return (
      <a href={href} className={buttonClass(kind)} rel="noopener noreferrer">
        {children}
        <span className="sr-only"> (opens GitHub)</span>
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass(kind)}>
      {children}
    </Link>
  );
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
