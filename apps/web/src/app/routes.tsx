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
        <Route path="tasks" element={<TasksPage />} />
        <Route path="computer" element={<ComputerPage />} />
        <Route path="routines" element={<RoutinesPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="record" element={<RecordPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="memory" element={<MemoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
