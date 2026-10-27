import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { type ReactNode, useState } from "react";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { createQueryClient, useSettings } from "@/lib/api.ts";
import { AccessibilityProvider, useAccessibility } from "./accessibility.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { StewardCopilotProvider } from "./features.ts";
import { useWideLayout } from "./layout-mode.ts";
import { AppRoutes } from "./routes.tsx";

/**
 * The root: data (react-query), the person's accessibility settings, toasts, CopilotKit and the
 * router. Order matters: settings sit above everything that draws, and CopilotKit sits inside the
 * router so its tools can navigate.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AccessibilityRoot>
        <ErrorBoundary>
          <BrowserRouter>
            <StewardCopilotProvider>
              <AppRoutes />
            </StewardCopilotProvider>
          </BrowserRouter>
        </ErrorBoundary>
        <ThemedToaster />
      </AccessibilityRoot>
    </QueryClientProvider>
  );
}

/** Feeds the server's plain-language setting in, and makes motion follow the person's choice. */
function AccessibilityRoot({ children }: { children: ReactNode }) {
  const settings = useSettings({ retry: false });
  return (
    <AccessibilityProvider serverPlainLanguage={settings.data?.plainLanguage}>
      <ReducedMotion>{children}</ReducedMotion>
    </AccessibilityProvider>
  );
}

function ReducedMotion({ children }: { children: ReactNode }) {
  const { reducedMotion } = useAccessibility();
  return <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>{children}</MotionConfig>;
}

/** Toasts sit above the phone's bottom bar, and announce themselves to screen readers. */
function ThemedToaster() {
  const { resolvedTheme } = useAccessibility();
  const wide = useWideLayout();
  const clearOfBar = { bottom: "calc(5.5rem + env(safe-area-inset-bottom))" };
  return (
    <Toaster
      theme={resolvedTheme}
      position="bottom-right"
      closeButton
      containerAriaLabel="Notifications from Steward"
      offset={wide ? undefined : clearOfBar}
      mobileOffset={clearOfBar}
      // Sonner sizes toasts in pixels; a rem size lets them grow with the person's text size.
      toastOptions={{ className: "font-sans", style: { fontSize: "0.875rem" } }}
    />
  );
}
