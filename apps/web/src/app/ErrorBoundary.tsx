import { TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** When any of these change (the route, say), a caught error is cleared and the page tries again. */
  resetKeys?: unknown[];
  /** Where the message sits: a whole screen, or one region. */
  variant?: "page" | "region";
}

interface ErrorBoundaryState {
  error: Error | undefined;
}

/**
 * Catches a crash in what it wraps and shows a calm message with a way out, instead of a blank
 * screen. The details stay in the browser console for whoever is debugging.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Steward caught an error while drawing the page", error, info.componentStack);
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (!this.state.error) return;
    const a = prev.resetKeys ?? [];
    const b = this.props.resetKeys ?? [];
    if (a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))) this.setState({ error: undefined });
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const page = this.props.variant !== "region";
    const Heading = page ? "h1" : "h2";
    return (
      <div
        role="alert"
        className={
          page
            ? "mx-auto flex max-w-xl flex-col items-start gap-3 px-6 py-16"
            : "flex flex-col items-start gap-3 rounded-card bg-card p-5 shadow-card"
        }
      >
        <TriangleAlert aria-hidden="true" className="size-8 text-needs" />
        <Heading className="font-semibold text-display text-ink">Something went wrong on this page</Heading>
        <p className="text-ink-2 text-sub">
          Steward is still running, and nothing it was doing has been lost. Try again, or go back to Today.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: undefined })}
            className="inline-flex min-h-target items-center rounded-field bg-accent px-4 font-medium text-on-accent text-sub hover:bg-accent-hover"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex min-h-target items-center rounded-field px-4 font-medium text-ink text-sub shadow-[inset_0_0_0_1px_var(--st-line)] hover:bg-tile"
          >
            Go to Today
          </a>
        </div>
      </div>
    );
  }
}
