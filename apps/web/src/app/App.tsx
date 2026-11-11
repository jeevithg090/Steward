import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { createQueryClient, useSettings, useUpdateSettings } from "@/lib/api.ts";
import { AccessibilityProvider, useAccessibility } from "./accessibility.tsx";
import { DefaultAgent } from "./default-agent.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { prefetchChat } from "./features.ts";
import { useWideLayout } from "./layout-mode.ts";
import { AppRoutes } from "./routes.tsx";

/**
 * The root: data (react-query), the person's accessibility settings, toasts, the default agent and
 * the router. Order matters: settings sit above everything that draws. CopilotKit is not here: it
 * loads with the chat (`features.ts`), fetched in the background once the first page has drawn.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  useEffect(() => prefetchChat(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <AccessibilityRoot>
        <ErrorBoundary>
          <BrowserRouter>
            <DefaultAgent>
              <AppRoutes />
            </DefaultAgent>
          </BrowserRouter>
        </ErrorBoundary>
        <ThemedToaster />
      </AccessibilityRoot>
    </QueryClientProvider>
  );
}

/**
 * Feeds the server's plain-language setting in and saves it back through the settings cache, and
 * makes motion follow the person's choice.
 */
function AccessibilityRoot({ children }: { children: ReactNode }) {
  const settings = useSettings({ retry: false });
  const update = useUpdateSettings();
  return (
    <AccessibilityProvider
      serverPlainLanguage={settings.data?.plainLanguage}
      savePlainLanguage={(plainLanguage) => update.mutateAsync({ plainLanguage })}
    >
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
