import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Loading } from "@/components/ui/Notice.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { ChatPage, ComputerPage } from "./features.ts";
import { AppShell } from "./Layout.tsx";

/** Each page is its own chunk, fetched the first time someone opens it. */
const TodayPage = lazy(() => import("@/pages/TodayPage.tsx").then((m) => ({ default: m.TodayPage })));
const TasksPage = lazy(() => import("@/pages/TasksPage.tsx").then((m) => ({ default: m.TasksPage })));
const RoutinesPage = lazy(() =>
  import("@/pages/RoutinesPage.tsx").then((m) => ({ default: m.RoutinesPage })),
);
const RulesPage = lazy(() => import("@/pages/RulesPage.tsx").then((m) => ({ default: m.RulesPage })));
const RecordPage = lazy(() => import("@/pages/RecordPage.tsx").then((m) => ({ default: m.RecordPage })));
const ConnectionsPage = lazy(() =>
  import("@/pages/ConnectionsPage.tsx").then((m) => ({ default: m.ConnectionsPage })),
);
const SkillsPage = lazy(() => import("@/pages/SkillsPage.tsx").then((m) => ({ default: m.SkillsPage })));
const BotsPage = lazy(() => import("@/pages/BotsPage.tsx").then((m) => ({ default: m.BotsPage })));
const BotListingPage = lazy(() =>
  import("@/pages/BotListingPage.tsx").then((m) => ({ default: m.BotListingPage })),
);
const BotAddPage = lazy(() => import("@/pages/BotAddPage.tsx").then((m) => ({ default: m.BotAddPage })));
const ShortcutsPage = lazy(() =>
  import("@/pages/ShortcutsPage.tsx").then((m) => ({ default: m.ShortcutsPage })),
);
const MemoryPage = lazy(() => import("@/pages/MemoryPage.tsx").then((m) => ({ default: m.MemoryPage })));
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage.tsx").then((m) => ({ default: m.SettingsPage })),
);
const WelcomePage = lazy(() => import("@/pages/WelcomePage.tsx").then((m) => ({ default: m.WelcomePage })));
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage.tsx").then((m) => ({ default: m.NotFoundPage })),
);

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/welcome"
        element={
          <ErrorBoundary>
            <Suspense fallback={<Loading>Loading…</Loading>}>
              <WelcomePage />
            </Suspense>
          </ErrorBoundary>
        }
      />
      <Route element={<AppShell />}>
        <Route index element={<TodayPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="chat/:threadId" element={<ChatPage />} />
        <Route path="bots" element={<BotsPage />} />
        <Route path="bots/add" element={<BotAddPage />} />
        <Route path="bots/:id" element={<BotListingPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="computer" element={<ComputerPage />} />
        <Route path="routines" element={<RoutinesPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="record" element={<RecordPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="shortcuts" element={<ShortcutsPage />} />
        <Route path="memory" element={<MemoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
