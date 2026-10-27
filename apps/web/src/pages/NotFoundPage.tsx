import { Compass } from "lucide-react";
import { useLocation } from "react-router";
import { LinkButton } from "@/components/ui/Button.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";

export function NotFoundPage() {
  const location = useLocation();
  return (
    <Page title="This page doesn't exist" documentTitle="Not found">
      <div className="flex flex-col items-start gap-4">
        <Compass aria-hidden="true" className="size-10 text-ink-2" />
        <p className="text-ink-2 text-sub">
          There is nothing at <code className="break-all text-ink">{location.pathname}</code>. The link may be
          old, or mistyped.
        </p>
        <LinkButton to="/" variant="primary">
          Go to Today
        </LinkButton>
      </div>
    </Page>
  );
}
