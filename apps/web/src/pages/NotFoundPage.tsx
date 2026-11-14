import { Compass, MessageSquare, Sunrise } from "lucide-react";
import { useLocation } from "react-router";
import { LinkButton } from "@/components/ui/Button.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";

export function NotFoundPage() {
  const location = useLocation();
  return (
    <Page title="This page doesn't exist" documentTitle="Not found">
      <div className="flex flex-col items-center gap-3 rounded-card border border-hair border-dashed px-6 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-tile bg-tile text-ink-2">
          <Compass aria-hidden="true" className="size-6" />
        </span>
        <p className="measure text-ink-2 text-sub">
          There is nothing at <code className="break-all text-ink">{location.pathname}</code>. The link may be
          old, or mistyped. Every page is in the menu, or start from one of these.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <LinkButton to="/" variant="primary" icon={<Sunrise />}>
            Go to Today
          </LinkButton>
          <LinkButton to="/chat" variant="secondary" icon={<MessageSquare />}>
            Start a conversation
          </LinkButton>
        </div>
      </div>
    </Page>
  );
}
