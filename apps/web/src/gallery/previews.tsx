/**
 * Every generative-UI card with example data, for a components page in Settings or for docs. The
 * arguments here are also the reference for what each display tool accepts, so the agent's
 * parameter schemas can be checked against them.
 *
 * The data is invented and labelled as an example on screen. People in it are fictional, and no
 * card addresses the person by a name.
 */
import type { ReactNode } from "react";
import { Chart } from "./Chart.tsx";
import { Choices } from "./Choices.tsx";
import { Comparison } from "./Comparison.tsx";
import { DataTable } from "./DataTable.tsx";
import { ToolLine } from "./kit.tsx";
import { DraftCard, EmailCard } from "./MailCards.tsx";
import { PageCard, RoutineCard, SearchResults, TriageCard } from "./SmallCards.tsx";

export interface GalleryPreview {
  /** The tool that draws it. */
  tool: string;
  title: string;
  /** Example arguments, in the shape the card reads. */
  args?: Record<string, unknown>;
  render: () => ReactNode;
}

const hour = (h: number) => new Date(new Date().setHours(h, 0, 0, 0)).toISOString();

export const TABLE_EXAMPLE = {
  title: "Delivery quotes",
  caption: "Three carriers, for 40 boxes to the studio.",
  columns: ["Carrier", "Price", "Days"],
  rows: [
    ["Northline", "£184", 3],
    ["Parcelwise", "£162", 5],
    ["Swift & Co", "£210", 2],
  ],
};

export const CHART_EXAMPLES = {
  bar: {
    type: "bar",
    title: "Orders by month",
    points: [
      { label: "July", value: 12 },
      { label: "August", value: 42 },
      { label: "September", value: 30 },
    ],
  },
  line: {
    type: "line",
    title: "Visits this week",
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    series: [
      { name: "Website", values: [120, 140, 135, 160, 180] },
      { name: "Shop", values: [60, 72, 70, 90, 88] },
    ],
  },
  pie: {
    type: "pie",
    title: "Where the time went",
    unit: "h",
    points: [
      { label: "Email", value: 9 },
      { label: "Meetings", value: 12 },
      { label: "Making", value: 18 },
    ],
  },
};

export const COMPARISON_EXAMPLE = {
  title: "Two ways to ship the order",
  options: [
    { name: "Northline", summary: "Cheaper, slower.", pros: ["£22 less", "Tracked"], cons: ["Five days"] },
    { name: "Swift & Co", summary: "Arrives Friday.", pros: ["Two days"], cons: ["£26 more"] },
  ],
  verdict: "Swift & Co, since the fair starts on Saturday.",
  pick: "Swift & Co",
};

export const CHOICES_EXAMPLE = {
  question: "Which day suits you?",
  choices: ["Thursday", "Friday", "Next week"],
};

export const PREVIEWS: GalleryPreview[] = [
  {
    tool: "show_table",
    title: "Sortable table",
    args: TABLE_EXAMPLE,
    render: () => <DataTable args={TABLE_EXAMPLE} />,
  },
  {
    tool: "show_chart",
    title: "Bar chart",
    args: CHART_EXAMPLES.bar,
    render: () => <Chart args={CHART_EXAMPLES.bar} />,
  },
  {
    tool: "show_chart",
    title: "Line chart",
    args: CHART_EXAMPLES.line,
    render: () => <Chart args={CHART_EXAMPLES.line} />,
  },
  {
    tool: "show_chart",
    title: "Pie chart",
    args: CHART_EXAMPLES.pie,
    render: () => <Chart args={CHART_EXAMPLES.pie} />,
  },
  {
    tool: "show_comparison",
    title: "Comparison",
    args: COMPARISON_EXAMPLE,
    render: () => <Comparison args={COMPARISON_EXAMPLE} />,
  },
  {
    tool: "show_choices",
    title: "Quick replies",
    args: CHOICES_EXAMPLE,
    render: () => <Choices args={CHOICES_EXAMPLE} />,
  },
  {
    tool: "mail_read",
    title: "An email Steward read",
    render: () => (
      <EmailCard
        email={{
          subject: "Friday delivery",
          from: { name: "Ana Pereira", email: "ana@example.com" },
          to: [{ email: "you@example.com" }],
          receivedAt: hour(9),
          body: "Could you confirm the Friday delivery by noon? The van leaves at two.",
        }}
        untrusted
      />
    ),
  },
  {
    tool: "mail_send",
    title: "A draft waiting for your answer",
    render: () => (
      <DraftCard
        draft={{
          to: [{ name: "Ana Pereira", email: "ana@example.com" }],
          subject: "Re: Friday delivery",
          body: "Confirmed for Friday. Thanks for checking.",
        }}
        state="waiting"
        note="Steward is waiting for your answer before this leaves."
      />
    ),
  },
  {
    tool: "triage_inbox",
    title: "Mail, sorted",
    render: () => (
      <TriageCard
        items={[
          {
            emailId: "e1",
            subject: "Friday delivery",
            from: { name: "Ana Pereira", email: "ana@example.com" },
            verdict: "needs_you",
            reason: "Asks you to confirm Friday's delivery by noon.",
          },
          {
            emailId: "e2",
            subject: "October newsletter",
            from: { name: "Kiln Supplies", email: "news@example.com" },
            verdict: "can_wait",
            reason: "A newsletter.",
          },
        ]}
      />
    ),
  },
  {
    tool: "routine_create",
    title: "Routine",
    render: () => (
      <RoutineCard
        routine={{
          title: "Morning brief",
          prompt: "Tell me what needs me today.",
          schedule: "0 8 * * 1-5",
          enabled: true,
          nextRunAt: hour(32),
        }}
      />
    ),
  },
  {
    tool: "make_page",
    title: "A page Steward made",
    render: () => (
      <PageCard
        page={{
          title: "Shipping options",
          kind: "doc",
          path: "pages/shipping.md",
          summary: "Two carriers compared.",
        }}
      />
    ),
  },
  {
    tool: "web_search",
    title: "Web results",
    render: () => (
      <SearchResults
        query="stoneware glaze suppliers"
        results={[
          {
            title: "Glaze guide",
            url: "https://example.com/glazes",
            snippet: "How to choose a stoneware glaze.",
          },
          {
            title: "Supplier list",
            url: "https://example.org/suppliers",
            snippet: "Kiln and glaze suppliers by region.",
          },
        ]}
      />
    ),
  },
  {
    tool: "browser_navigate",
    title: "A step on the computer",
    render: () => <ToolLine label="Opened news.ycombinator.com" detail="Hacker News" />,
  },
];

/** All previews, each under its tool name, with an "Example" label so the data never passes for real. */
export function GalleryPreviews() {
  return (
    <div className="flex flex-col gap-6">
      {PREVIEWS.map((preview) => (
        <section key={`${preview.tool}-${preview.title}`} aria-label={`${preview.title} (example)`}>
          <p className="m-0 mb-1 text-caption text-ink-3">
            <span className="font-medium text-ink-2">{preview.title}</span> · <code>{preview.tool}</code> ·
            Example data
          </p>
          {preview.render()}
        </section>
      ))}
    </div>
  );
}
