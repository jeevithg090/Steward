/**
 * Steward's generative-UI cards: the pieces tool calls draw with in the chat. Each reads its tool's
 * arguments defensively, so a model that phrases them a little differently still gets a card.
 */
export { Chart, ChartTable } from "./Chart.tsx";
export { Choices } from "./Choices.tsx";
export { Comparison, readComparison } from "./Comparison.tsx";
export { type ChartData, type ChartKind, describeChart, readChart } from "./chart.ts";
export { isConsentChoice, readChoices } from "./choices.ts";
export { DataTable } from "./DataTable.tsx";
export { formatWhen, hostOf, recipientsOf, safeHref } from "./format.ts";
export { CardFrame, type LineState, Quiet, ToolLine, UntrustedNote } from "./kit.tsx";
export { DraftCard, type DraftState, EmailCard } from "./MailCards.tsx";
export { type GalleryPreview, GalleryPreviews, PREVIEWS } from "./previews.tsx";
export {
  CommandOutput,
  PageCard,
  RoutineCard,
  SearchResults,
  SourceLine,
  TriageCard,
  takeCareOf,
} from "./SmallCards.tsx";
export { readTable, sortRows, type TableData } from "./table.ts";
