import {
  type ActivityItem,
  type AgentsResponse,
  type AppInfo,
  type AppNotification,
  type Approval,
  type ApprovalDecisionBody,
  type AuditPage,
  type BotInstallBody,
  type BotListing,
  type BotMakeBody,
  type BotPack,
  type BotPreview,
  type BotPreviewBody,
  type BotsQuery,
  type Brief,
  type CalendarEvent,
  type ChainCheck,
  type ComputerStatus,
  type ConnectionsInfo,
  type Decision,
  type Device,
  type DeviceKind,
  type DevicePatchBody,
  type DryRunBody,
  type EmailSummary,
  type HarnessInfo,
  type InstalledBot,
  type McpServerBody,
  type McpServerInfo,
  type MemoryFact,
  type PairingOffer,
  type PhoneCatalogue,
  type PhoneInfo,
  type RemotePairing,
  type RemotePairingState,
  ROUTES,
  type Routine,
  type RoutineBody,
  type Rule,
  type RuleBody,
  route,
  type Settings,
  type SettingsBody,
  type SetupCheck,
  type ShortcutInstall,
  type Skill,
  type SkillBody,
  type Task,
  type TaskPatchBody,
  type TaskStartBody,
  type TaskState,
  type TasksResponse,
  type ThreadCreateBody,
  type ThreadSummary,
  type TriageItem,
  type WorkspaceFile,
} from "@steward/shared";
import {
  QueryClient,
  type UseQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import { localDate } from "./utils.ts";

/**
 * The typed client for Steward's REST API (`packages/shared/src/api.ts`), and a react-query hook per
 * route. Every path is built from `ROUTES` with `route()`, so the client and the server agree on one
 * list. Errors arrive as `{ error: "<a sentence a person can act on>" }` and are thrown as `ApiError`
 * with that sentence as the message, ready to show.
 */

// ── Request bodies, as callers write them (defaults optional) ──────────────────────────────────

export type ApprovalDecisionInput = z.input<typeof ApprovalDecisionBody>;
export type RuleInput = z.input<typeof RuleBody>;
export type DryRunInput = z.input<typeof DryRunBody>;
export type TaskPatchInput = z.input<typeof TaskPatchBody>;
export type TaskStartInput = z.input<typeof TaskStartBody>;
export type RoutineInput = z.input<typeof RoutineBody>;
export type SkillInput = z.input<typeof SkillBody>;
export type McpServerInput = z.input<typeof McpServerBody>;
export type SettingsInput = z.input<typeof SettingsBody>;
export type ThreadCreateInput = z.input<typeof ThreadCreateBody>;
export type BotPreviewInput = z.input<typeof BotPreviewBody>;
export type BotInstallInput = z.input<typeof BotInstallBody>;
export type BotMakeInput = z.input<typeof BotMakeBody>;
export type BotsQueryInput = z.input<typeof BotsQuery>;
export type DevicePatchInput = z.input<typeof DevicePatchBody>;

/** `GET /api/bots`: one page of the directory, with the categories the index names. */
export interface BotsResponse {
  bots: BotListing[];
  total: number;
  /** Category id to its label, e.g. `home` → "Home & family". */
  categories?: Record<string, string>;
}

/** `GET /api/inbox` returns summaries with their triage verdict when one has been made. */
export type InboxEmail = EmailSummary & { triage?: TriageItem };

/**
 * What the Connections page reads for an MCP server. The contract's `McpServerInfo` has no command,
 * args or URL, but a PUT needs them; the server is asked to include them (none are secret) and the
 * client sends them back when it has them.
 */
export type McpServerDetail = McpServerInfo & { command?: string; args?: string[]; url?: string };

export interface AuditFilters {
  type?: string;
  effect?: string;
  q?: string;
  limit?: number;
}

// ── The fetch layer ────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Query = Record<string, string | number | boolean | undefined | null>;

/** Empty in the normal setup (same origin, or Vite's proxy). Set VITE_STEWARD_API_URL to call a server elsewhere. */
const BASE = String(import.meta.env.VITE_STEWARD_API_URL ?? "").replace(/\/$/, "");

/** Appends the defined, non-empty values as a query string. */
export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string" && record.error) return record.error;
    if (typeof record.message === "string" && record.message) return record.message;
  }
  if (typeof body === "string" && body.length > 0 && body.length < 300 && !body.startsWith("<")) return body;
  if (status === 404) return "Couldn't find that. It may have been removed.";
  if (status === 409) return "That changed while you were looking. Reload and try again.";
  if (status === 401 || status === 403) return "Steward turned that request away.";
  if (status === 413) return "That is too large to send.";
  if (status >= 500) return "Steward hit a problem. Try again in a moment.";
  return `That didn't work (error ${status}).`;
}

export async function request<T>(
  method: Method,
  path: string,
  opts: { body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    res = await fetch(BASE + withQuery(path, opts.query), {
      method,
      headers: hasBody
        ? { "content-type": "application/json", accept: "application/json" }
        : { accept: "application/json" },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new ApiError("Couldn't reach Steward. Check that the server is running, then try again.", 0);
  }
  const text = await res.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new ApiError(errorMessage(data, res.status), res.status, data);
  return data as T;
}

const get = <T>(path: string, query?: Query, signal?: AbortSignal) =>
  request<T>("GET", path, { query, signal });
const send = <T>(method: Exclude<Method, "GET">, path: string, body?: unknown) =>
  request<T>(method, path, { body });

/**
 * The agent the app talks to unless told otherwise: the tenant's first agent, from `/api/info`.
 * `steward` until the info has loaded. A live binding, so readers always see the current value.
 */
export let DEFAULT_AGENT_ID = "steward";

export function setDefaultAgentId(id: string): void {
  DEFAULT_AGENT_ID = id;
}

// ── The client: one function per route ────────────────────────────────────────────────────────

export const api = {
  info: (signal?: AbortSignal) => get<AppInfo>(ROUTES.info, undefined, signal),
  /** Every agent with the model it runs on and whether it can answer now. */
  agents: (signal?: AbortSignal) => get<AgentsResponse>(ROUTES.agents, undefined, signal),
  /** The external coding agents the tenant offers, and whether each one's program is installed. */
  harnesses: (signal?: AbortSignal) => get<HarnessInfo[]>(ROUTES.harnesses, undefined, signal),
  health: () => get<{ ok: true }>(ROUTES.health),

  settings: {
    get: (signal?: AbortSignal) => get<Settings>(ROUTES.settings, undefined, signal),
    update: (body: SettingsInput) => send<Settings>("PUT", ROUTES.settings, body),
  },

  setup: {
    list: (signal?: AbortSignal) => get<SetupCheck[]>(ROUTES.setup, undefined, signal),
    check: () => send<SetupCheck[]>("POST", `${ROUTES.setup}/check`),
  },

  threads: {
    list: (signal?: AbortSignal) => get<ThreadSummary[]>(ROUTES.threads, undefined, signal),
    get: (id: string) => get<ThreadSummary>(route(ROUTES.thread, { id })),
    create: (body: ThreadCreateInput = {}) => send<ThreadSummary>("POST", ROUTES.threads, body),
    remove: (id: string) => send<void>("DELETE", route(ROUTES.thread, { id })),
  },

  approvals: {
    list: (status?: Approval["status"], signal?: AbortSignal) =>
      get<Approval[]>(ROUTES.approvals, { status }, signal),
    get: (id: string, signal?: AbortSignal) =>
      get<Approval>(route(ROUTES.approval, { id }), undefined, signal),
    decide: (id: string, body: ApprovalDecisionInput) =>
      send<Approval>("POST", route(ROUTES.approvalDecide, { id }), body),
  },

  rules: {
    list: (signal?: AbortSignal) => get<Rule[]>(ROUTES.rules, undefined, signal),
    presets: (signal?: AbortSignal) => get<Rule[]>(ROUTES.rulesPresets, undefined, signal),
    create: (body: RuleInput) => send<Rule>("POST", ROUTES.rules, body),
    update: (id: string, body: RuleInput) => send<Rule>("PUT", route(ROUTES.rule, { id }), body),
    remove: (id: string) => send<void>("DELETE", route(ROUTES.rule, { id })),
    dryRun: (body: DryRunInput) => send<Decision>("POST", ROUTES.rulesDryRun, body),
  },

  audit: {
    page: (opts: AuditFilters & { before?: number } = {}, signal?: AbortSignal) =>
      get<AuditPage>(ROUTES.audit, { ...opts }, signal),
    verify: (signal?: AbortSignal) => get<ChainCheck>(ROUTES.auditVerify, undefined, signal),
  },

  tasks: {
    list: (state?: TaskState, signal?: AbortSignal) => get<TasksResponse>(ROUTES.tasks, { state }, signal),
    patch: (id: string, body: TaskPatchInput) => send<Task>("PATCH", route(ROUTES.task, { id }), body),
    start: (id: string, body: TaskStartInput = {}) =>
      send<{ task: Task; threadId: string }>("POST", route(ROUTES.taskStart, { id }), body),
  },

  brief: {
    get: (date: string, signal?: AbortSignal) => get<Brief | null>(ROUTES.brief, { date }, signal),
    /** Without a date, the server picks today in the Settings time zone. */
    generate: (body?: { date?: string; force?: boolean }) => send<Brief>("POST", ROUTES.briefGenerate, body),
  },

  inbox: (signal?: AbortSignal) => get<InboxEmail[]>(ROUTES.inbox, undefined, signal),
  calendar: (from: string, to: string, signal?: AbortSignal) =>
    get<CalendarEvent[]>(ROUTES.calendar, { from, to }, signal),

  routines: {
    list: (signal?: AbortSignal) => get<Routine[]>(ROUTES.routines, undefined, signal),
    create: (body: RoutineInput) => send<Routine>("POST", ROUTES.routines, body),
    update: (id: string, body: Partial<RoutineInput>) =>
      send<Routine>("PATCH", route(ROUTES.routine, { id }), body),
    remove: (id: string) => send<void>("DELETE", route(ROUTES.routine, { id })),
    run: (id: string) => send<{ threadId: string }>("POST", route(ROUTES.routineRun, { id })),
  },

  memory: {
    list: (signal?: AbortSignal) => get<MemoryFact[]>(ROUTES.memory, undefined, signal),
    add: (text: string) => send<MemoryFact>("POST", ROUTES.memory, { text }),
    remove: (id: string) => send<void>("DELETE", route(ROUTES.memoryItem, { id })),
  },

  skills: {
    list: (signal?: AbortSignal) => get<Skill[]>(ROUTES.skills, undefined, signal),
    create: (body: SkillInput) => send<Skill>("POST", ROUTES.skills, body),
    update: (id: string, body: SkillInput) => send<Skill>("PUT", route(ROUTES.skill, { id }), body),
    remove: (id: string) => send<void>("DELETE", route(ROUTES.skill, { id })),
  },

  connections: {
    get: (signal?: AbortSignal) =>
      get<ConnectionsInfo & { mcp: McpServerDetail[] }>(ROUTES.connections, undefined, signal),
    addMcp: (body: McpServerInput) => send<McpServerInfo>("POST", ROUTES.mcpServers, body),
    updateMcp: (id: string, body: McpServerInput) =>
      send<McpServerInfo>("PUT", route(ROUTES.mcpServer, { id }), body),
    removeMcp: (id: string) => send<void>("DELETE", route(ROUTES.mcpServer, { id })),
  },

  computer: {
    status: (agentId: string, signal?: AbortSignal) =>
      get<ComputerStatus>(route(ROUTES.computer, { agentId }), undefined, signal),
    activity: (agentId: string, signal?: AbortSignal) =>
      get<ActivityItem[]>(route(ROUTES.computerActivity, { agentId }), undefined, signal),
    files: (agentId: string, dir?: string, signal?: AbortSignal) =>
      get<WorkspaceFile[]>(route(ROUTES.computerFiles, { agentId }), { dir }, signal),
    reset: (agentId: string) => send<ComputerStatus>("POST", route(ROUTES.computerReset, { agentId })),
    /** The WebSocket URL for the live screen, on this page's own host. */
    wsUrl: (agentId: string) => {
      const base = BASE || globalThis.location?.origin || "";
      return `${base.replace(/^http/, "ws")}${route(ROUTES.computerWs, { agentId })}`;
    },
  },

  notifications: {
    list: (signal?: AbortSignal) => get<AppNotification[]>(ROUTES.notifications, undefined, signal),
    readAll: () => send<void>("POST", `${ROUTES.notifications}/read-all`),
  },

  bots: {
    list: (query: BotsQueryInput = {}, signal?: AbortSignal) =>
      get<BotsResponse>(ROUTES.bots, { ...query }, signal),
    installed: (signal?: AbortSignal) => get<InstalledBot[]>(ROUTES.botsInstalled, undefined, signal),
    /** What a pack would mean for this Steward: what it may do, what is missing. Nothing is installed. */
    preview: (body: BotPreviewInput) => send<BotPreview>("POST", ROUTES.botsPreview, body),
    install: (body: BotInstallInput) => send<InstalledBot>("POST", ROUTES.botsInstall, body),
    remove: (id: string) => send<void>("DELETE", route(ROUTES.botInstalled, { id })),
    /** Applies the newer version the directory has for an installed bot. */
    update: (id: string) => send<InstalledBot>("POST", `${route(ROUTES.botInstalled, { id })}/update`),
    /** Writes a pack from a job in the person's words. Returned, not installed. */
    make: (body: BotMakeInput) => send<BotPack>("POST", ROUTES.botsMake, body),
  },

  phone: {
    get: (signal?: AbortSignal) => get<PhoneInfo>(ROUTES.phone, undefined, signal),
    setUrl: (url: string) => send<PhoneInfo>("PUT", ROUTES.phone, { url }),
    catalogue: (signal?: AbortSignal) => get<PhoneCatalogue>(ROUTES.phoneCatalogue, undefined, signal),
    /** A one-time download link for the phone: `steward` (the one-tap file) or a launcher's id. */
    install: (id: string) => send<ShortcutInstall>("POST", route(ROUTES.phoneShortcutInstall, { id })),
  },

  devices: {
    list: (signal?: AbortSignal) => get<Device[]>(ROUTES.devices, undefined, signal),
    /** A one-time code and the two things to scan. Shown once; never stored by the page. */
    pair: (kind: DeviceKind = "shortcut") => send<PairingOffer>("POST", ROUTES.devicesPairing, { kind }),
    patch: (id: string, body: DevicePatchInput) => send<Device>("PATCH", route(ROUTES.device, { id }), body),
    revoke: (id: string) => send<void>("DELETE", route(ROUTES.device, { id })),
    /** The phone app, through the relay: a two-minute, one-time QR address. */
    remotePair: () => send<RemotePairing>("POST", ROUTES.remotePairing),
    remoteState: (id: string, signal?: AbortSignal) =>
      get<RemotePairingState>(route(ROUTES.remotePairingState, { id }), undefined, signal),
    remoteConfirm: (id: string) => send<Device>("POST", route(ROUTES.remotePairingConfirm, { id })),
    remoteRefuse: (id: string) => send<{ ok: true }>("POST", route(ROUTES.remotePairingRefuse, { id })),
  },
};

// ── Query keys ────────────────────────────────────────────────────────────────────────────────

/** One place for every cache key, so live events and mutations invalidate exactly what changed. */
export const queryKeys = {
  info: ["info"] as const,
  agents: ["agents"] as const,
  settings: ["settings"] as const,
  setup: ["setup"] as const,
  threads: ["threads"] as const,
  approvals: ["approvals"] as const,
  /** Every approval list, but not the single approvals (those are set directly when they change). */
  approvalLists: ["approvals", "list"] as const,
  approvalList: (status?: Approval["status"]) => ["approvals", "list", status ?? "all"] as const,
  approval: (id: string) => ["approvals", "one", id] as const,
  rules: ["rules"] as const,
  ruleList: ["rules", "list"] as const,
  presets: ["rules", "presets"] as const,
  audit: ["audit"] as const,
  auditPages: (filters: AuditFilters) => ["audit", "pages", filters] as const,
  auditVerify: ["audit", "verify"] as const,
  tasks: ["tasks"] as const,
  taskList: (state?: TaskState) => ["tasks", state ?? "all"] as const,
  brief: ["brief"] as const,
  briefFor: (date: string) => ["brief", date] as const,
  inbox: ["inbox"] as const,
  calendar: (from: string, to: string) => ["calendar", from, to] as const,
  routines: ["routines"] as const,
  memory: ["memory"] as const,
  skills: ["skills"] as const,
  connections: ["connections"] as const,
  computer: (agentId: string) => ["computer", agentId] as const,
  computerStatus: (agentId: string) => ["computer", agentId, "status"] as const,
  computerActivity: (agentId: string) => ["computer", agentId, "activity"] as const,
  computerFiles: (agentId: string, dir?: string) => ["computer", agentId, "files", dir ?? ""] as const,
  notifications: ["notifications"] as const,
  /** Every bots query: the directory pages and the installed list. */
  bots: ["bots"] as const,
  phone: ["phone"] as const,
  phoneCatalogue: ["phone", "catalogue"] as const,
  devices: ["devices"] as const,
  botList: (query: BotsQueryInput) => ["bots", "list", query] as const,
  botsInstalled: ["bots", "installed"] as const,
};

/** A client with Steward's defaults: retry only what might succeed on a second try. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => {
          const status = error instanceof ApiError ? error.status : 0;
          return count < 2 && (status === 0 || status >= 500);
        },
      },
      mutations: { retry: false },
    },
  });
}

type QueryOpts<T> = Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn">;

// ── App, settings, setup ───────────────────────────────────────────────────────────────────────

export function useInfo(opts?: QueryOpts<AppInfo>) {
  return useQuery<AppInfo, ApiError>({
    queryKey: queryKeys.info,
    queryFn: ({ signal }) => api.info(signal),
    staleTime: 60_000,
    ...opts,
  });
}

/** The agents as the picker shows them: name, model, and whether each can answer. */
export function useAgents(opts?: QueryOpts<AgentsResponse>) {
  return useQuery<AgentsResponse, ApiError>({
    queryKey: queryKeys.agents,
    queryFn: ({ signal }) => api.agents(signal),
    staleTime: 60_000,
    ...opts,
  });
}

export function useSettings(opts?: QueryOpts<Settings>) {
  return useQuery<Settings, ApiError>({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => api.settings.get(signal),
    ...opts,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation<Settings, ApiError, SettingsInput>({
    mutationFn: (body) => api.settings.update(body),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.settings, settings);
      void qc.invalidateQueries({ queryKey: queryKeys.info });
      // A new default model changes what the agents without a model of their own run on.
      void qc.invalidateQueries({ queryKey: queryKeys.agents });
      void qc.invalidateQueries({ queryKey: queryKeys.setup });
    },
  });
}

export function useSetup(opts?: QueryOpts<SetupCheck[]>) {
  return useQuery<SetupCheck[], ApiError>({
    queryKey: queryKeys.setup,
    queryFn: ({ signal }) => api.setup.list(signal),
    ...opts,
  });
}

/** "Check again": re-runs every setup check on the server. */
export function useCheckSetup() {
  const qc = useQueryClient();
  return useMutation<SetupCheck[], ApiError, void>({
    mutationFn: () => api.setup.check(),
    onSuccess: (checks) => {
      if (Array.isArray(checks)) qc.setQueryData(queryKeys.setup, checks);
      else void qc.invalidateQueries({ queryKey: queryKeys.setup });
    },
  });
}

// ── Threads ────────────────────────────────────────────────────────────────────────────────────

export function useThreads(opts?: QueryOpts<ThreadSummary[]>) {
  return useQuery<ThreadSummary[], ApiError>({
    queryKey: queryKeys.threads,
    queryFn: ({ signal }) => api.threads.list(signal),
    ...opts,
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation<ThreadSummary, ApiError, ThreadCreateInput | undefined>({
    mutationFn: (body) => api.threads.create(body ?? {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.threads }),
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api.threads.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.threads }),
  });
}

// ── Approvals ──────────────────────────────────────────────────────────────────────────────────

export function useApprovals(status?: Approval["status"], opts?: QueryOpts<Approval[]>) {
  return useQuery<Approval[], ApiError>({
    queryKey: queryKeys.approvalList(status),
    queryFn: ({ signal }) => api.approvals.list(status, signal),
    ...opts,
  });
}

export function useApproval(id: string, initial?: Approval, opts?: QueryOpts<Approval>) {
  return useQuery<Approval, ApiError>({
    queryKey: queryKeys.approval(id),
    queryFn: ({ signal }) => api.approvals.get(id, signal),
    initialData: initial,
    enabled: Boolean(id),
    ...opts,
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation<Approval, ApiError, { id: string } & ApprovalDecisionInput>({
    mutationFn: ({ id, ...body }) => api.approvals.decide(id, body),
    onSuccess: (approval) => {
      qc.setQueryData(queryKeys.approval(approval.id), approval);
      void qc.invalidateQueries({ queryKey: queryKeys.approvalLists });
      void qc.invalidateQueries({ queryKey: queryKeys.tasks });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
      if (approval.answer === "always") void qc.invalidateQueries({ queryKey: queryKeys.rules });
    },
  });
}

// ── Rules ──────────────────────────────────────────────────────────────────────────────────────

export function useRules(opts?: QueryOpts<Rule[]>) {
  return useQuery<Rule[], ApiError>({
    queryKey: queryKeys.ruleList,
    queryFn: ({ signal }) => api.rules.list(signal),
    ...opts,
  });
}

export function usePresets(opts?: QueryOpts<Rule[]>) {
  return useQuery<Rule[], ApiError>({
    queryKey: queryKeys.presets,
    queryFn: ({ signal }) => api.rules.presets(signal),
    staleTime: 5 * 60_000,
    ...opts,
  });
}

function useRulesMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      // The list and the built-in presets both: switching a preset off shows on the presets list.
      void qc.invalidateQueries({ queryKey: queryKeys.rules });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

export const useCreateRule = () => useRulesMutation((body: RuleInput) => api.rules.create(body));
export const useUpdateRule = () =>
  useRulesMutation(({ id, ...body }: RuleInput & { id: string }) => api.rules.update(id, body));
export const useDeleteRule = () => useRulesMutation((id: string) => api.rules.remove(id));

export function useDryRun() {
  return useMutation<Decision, ApiError, DryRunInput>({ mutationFn: (body) => api.rules.dryRun(body) });
}

// ── The record ─────────────────────────────────────────────────────────────────────────────────

export function useAudit(filters: AuditFilters = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.auditPages(filters),
    queryFn: ({ pageParam, signal }) => api.audit.page({ ...filters, before: pageParam }, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last: AuditPage) => last.nextBefore,
  });
}

export function useVerifyAudit(opts?: QueryOpts<ChainCheck>) {
  return useQuery<ChainCheck, ApiError>({
    queryKey: queryKeys.auditVerify,
    queryFn: ({ signal }) => api.audit.verify(signal),
    ...opts,
  });
}

// ── Tasks ──────────────────────────────────────────────────────────────────────────────────────

export function useTasks(state?: TaskState, opts?: QueryOpts<TasksResponse>) {
  return useQuery<TasksResponse, ApiError>({
    queryKey: queryKeys.taskList(state),
    queryFn: ({ signal }) => api.tasks.list(state, signal),
    ...opts,
  });
}

export function usePatchTask() {
  const qc = useQueryClient();
  return useMutation<Task, ApiError, { id: string } & TaskPatchInput>({
    mutationFn: ({ id, ...body }) => api.tasks.patch(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tasks });
      void qc.invalidateQueries({ queryKey: queryKeys.brief });
    },
  });
}

export function useStartTask() {
  const qc = useQueryClient();
  return useMutation<{ task: Task; threadId: string }, ApiError, { id: string } & TaskStartInput>({
    mutationFn: ({ id, ...body }) => api.tasks.start(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tasks });
      void qc.invalidateQueries({ queryKey: queryKeys.threads });
    },
  });
}

// ── Brief, mail, calendar ──────────────────────────────────────────────────────────────────────

/**
 * Today, as the server counts days: in the Settings time zone, which can differ from this browser's.
 * Undefined until the settings have loaded; if they cannot be read, this browser's day stands in.
 */
export function useBriefDate(): string | undefined {
  const settings = useSettings();
  if (settings.isPending) return undefined;
  return localDate(new Date(), settings.data?.timezone);
}

/** The brief for a day. Waits while the day is not known yet. */
export function useBrief(date: string | undefined, opts?: QueryOpts<Brief | null>) {
  return useQuery<Brief | null, ApiError>({
    queryKey: queryKeys.briefFor(date ?? ""),
    queryFn: async ({ signal }) => (date ? ((await api.brief.get(date, signal)) ?? null) : null),
    ...opts,
    enabled: Boolean(date) && opts?.enabled !== false,
  });
}

/** Makes the brief for the day the page shows, so it is read back under the same date. */
export function useGenerateBrief() {
  const qc = useQueryClient();
  return useMutation<Brief, ApiError, string | undefined>({
    mutationFn: (date) => api.brief.generate(date ? { date } : undefined),
    onSuccess: (brief) => {
      qc.setQueryData(queryKeys.briefFor(brief.date), brief);
      void qc.invalidateQueries({ queryKey: queryKeys.brief });
      void qc.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });
}

export function useInbox(opts?: QueryOpts<InboxEmail[]>) {
  return useQuery<InboxEmail[], ApiError>({
    queryKey: queryKeys.inbox,
    queryFn: ({ signal }) => api.inbox(signal),
    ...opts,
  });
}

export function useCalendar(from: string, to: string, opts?: QueryOpts<CalendarEvent[]>) {
  return useQuery<CalendarEvent[], ApiError>({
    queryKey: queryKeys.calendar(from, to),
    queryFn: ({ signal }) => api.calendar(from, to, signal),
    ...opts,
  });
}

// ── Routines ───────────────────────────────────────────────────────────────────────────────────

export function useRoutines(opts?: QueryOpts<Routine[]>) {
  return useQuery<Routine[], ApiError>({
    queryKey: queryKeys.routines,
    queryFn: ({ signal }) => api.routines.list(signal),
    ...opts,
  });
}

function useRoutinesMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.routines });
      void qc.invalidateQueries({ queryKey: queryKeys.threads });
    },
  });
}

export const useCreateRoutine = () => useRoutinesMutation((body: RoutineInput) => api.routines.create(body));
export const useUpdateRoutine = () =>
  useRoutinesMutation(({ id, ...body }: Partial<RoutineInput> & { id: string }) =>
    api.routines.update(id, body),
  );
export const useDeleteRoutine = () => useRoutinesMutation((id: string) => api.routines.remove(id));
export const useRunRoutine = () => useRoutinesMutation((id: string) => api.routines.run(id));

// ── Memory ─────────────────────────────────────────────────────────────────────────────────────

export function useMemory(opts?: QueryOpts<MemoryFact[]>) {
  return useQuery<MemoryFact[], ApiError>({
    queryKey: queryKeys.memory,
    queryFn: ({ signal }) => api.memory.list(signal),
    ...opts,
  });
}

export function useAddMemory() {
  const qc = useQueryClient();
  return useMutation<MemoryFact, ApiError, string>({
    mutationFn: (text) => api.memory.add(text),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.memory }),
  });
}

export function useRemoveMemory() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api.memory.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.memory }),
  });
}

// ── Skills ─────────────────────────────────────────────────────────────────────────────────────

export function useSkills(opts?: QueryOpts<Skill[]>) {
  return useQuery<Skill[], ApiError>({
    queryKey: queryKeys.skills,
    queryFn: ({ signal }) => api.skills.list(signal),
    ...opts,
  });
}

function useSkillsMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.skills }),
  });
}

export const useCreateSkill = () => useSkillsMutation((body: SkillInput) => api.skills.create(body));
export const useUpdateSkill = () =>
  useSkillsMutation(({ id, ...body }: SkillInput & { id: string }) => api.skills.update(id, body));
export const useDeleteSkill = () => useSkillsMutation((id: string) => api.skills.remove(id));

// ── Connections ────────────────────────────────────────────────────────────────────────────────

export function useConnections(opts?: QueryOpts<ConnectionsInfo & { mcp: McpServerDetail[] }>) {
  return useQuery<ConnectionsInfo & { mcp: McpServerDetail[] }, ApiError>({
    queryKey: queryKeys.connections,
    queryFn: ({ signal }) => api.connections.get(signal),
    ...opts,
  });
}

/** Adds a server, or updates it when `existing` is true. */
export function useUpsertMcp() {
  const qc = useQueryClient();
  return useMutation<McpServerInfo, ApiError, McpServerInput & { existing?: boolean }>({
    mutationFn: ({ existing, ...body }) =>
      existing ? api.connections.updateMcp(body.id, body) : api.connections.addMcp(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.connections });
      void qc.invalidateQueries({ queryKey: queryKeys.setup });
    },
  });
}

export function useRemoveMcp() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api.connections.removeMcp(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.connections }),
  });
}

// ── The computer ───────────────────────────────────────────────────────────────────────────────

export function useComputerStatus(agentId: string = DEFAULT_AGENT_ID, opts?: QueryOpts<ComputerStatus>) {
  return useQuery<ComputerStatus, ApiError>({
    queryKey: queryKeys.computerStatus(agentId),
    queryFn: ({ signal }) => api.computer.status(agentId, signal),
    ...opts,
  });
}

export function useComputerActivity(agentId: string = DEFAULT_AGENT_ID, opts?: QueryOpts<ActivityItem[]>) {
  return useQuery<ActivityItem[], ApiError>({
    queryKey: queryKeys.computerActivity(agentId),
    queryFn: ({ signal }) => api.computer.activity(agentId, signal),
    ...opts,
  });
}

export function useComputerFiles(
  agentId: string = DEFAULT_AGENT_ID,
  dir?: string,
  opts?: QueryOpts<WorkspaceFile[]>,
) {
  return useQuery<WorkspaceFile[], ApiError>({
    queryKey: queryKeys.computerFiles(agentId, dir),
    queryFn: ({ signal }) => api.computer.files(agentId, dir, signal),
    ...opts,
  });
}

export function useResetComputer() {
  const qc = useQueryClient();
  return useMutation<ComputerStatus, ApiError, string | undefined>({
    mutationFn: (agentId) => api.computer.reset(agentId ?? DEFAULT_AGENT_ID),
    onSuccess: (status) => {
      qc.setQueryData(queryKeys.computerStatus(status.agentId), status);
      void qc.invalidateQueries({ queryKey: queryKeys.computer(status.agentId) });
    },
  });
}

// ── Notifications ──────────────────────────────────────────────────────────────────────────────

export function useNotifications(opts?: QueryOpts<AppNotification[]>) {
  return useQuery<AppNotification[], ApiError>({
    queryKey: queryKeys.notifications,
    queryFn: ({ signal }) => api.notifications.list(signal),
    ...opts,
  });
}

export function useReadAllNotifications() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => api.notifications.readAll(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

// ── Bots ───────────────────────────────────────────────────────────────────────────────────────

export function useBots(query: BotsQueryInput = {}, opts?: QueryOpts<BotsResponse>) {
  return useQuery<BotsResponse, ApiError>({
    queryKey: queryKeys.botList(query),
    queryFn: ({ signal }) => api.bots.list(query, signal),
    staleTime: 60_000,
    ...opts,
  });
}

export function useInstalledBots(opts?: QueryOpts<InstalledBot[]>) {
  return useQuery<InstalledBot[], ApiError>({
    queryKey: queryKeys.botsInstalled,
    queryFn: ({ signal }) => api.bots.installed(signal),
    ...opts,
  });
}

/** A preview is asked for when a listing opens; nothing is cached, since the answer depends on today's rules. */
export function useBotPreview() {
  return useMutation<BotPreview, ApiError, BotPreviewInput>({ mutationFn: (body) => api.bots.preview(body) });
}

/**
 * Installing, removing or updating a bot changes more than the bots list: the agents in `/api/info`,
 * the skills and rules it brought, and its routines.
 */
function useBotsMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: () => invalidateBots(qc),
  });
}

export function invalidateBots(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: queryKeys.bots });
  void qc.invalidateQueries({ queryKey: queryKeys.info });
  void qc.invalidateQueries({ queryKey: queryKeys.agents });
  void qc.invalidateQueries({ queryKey: queryKeys.skills });
  void qc.invalidateQueries({ queryKey: queryKeys.rules });
  void qc.invalidateQueries({ queryKey: queryKeys.routines });
  void qc.invalidateQueries({ queryKey: queryKeys.audit });
}

export const useInstallBot = () => useBotsMutation((body: BotInstallInput) => api.bots.install(body));
export const useRemoveBot = () => useBotsMutation((id: string) => api.bots.remove(id));
export const useUpdateBot = () => useBotsMutation((id: string) => api.bots.update(id));

/** Make a bot: the pack comes back for the person to read; adding it is a separate step. */
export function useMakeBot() {
  return useMutation<BotPack, ApiError, BotMakeInput>({ mutationFn: (body) => api.bots.make(body) });
}

// ── Phone ──────────────────────────────────────────────────────────────────────────────────────

export function usePhone(opts?: QueryOpts<PhoneInfo>) {
  return useQuery<PhoneInfo, ApiError>({
    queryKey: queryKeys.phone,
    queryFn: ({ signal }) => api.phone.get(signal),
    ...opts,
  });
}

export function useSetPhoneUrl() {
  const qc = useQueryClient();
  return useMutation<PhoneInfo, ApiError, string>({
    mutationFn: (url) => api.phone.setUrl(url),
    onSuccess: (info) => qc.setQueryData(queryKeys.phone, info),
  });
}

export function usePhoneCatalogue(opts?: QueryOpts<PhoneCatalogue>) {
  return useQuery<PhoneCatalogue, ApiError>({
    queryKey: queryKeys.phoneCatalogue,
    queryFn: ({ signal }) => api.phone.catalogue(signal),
    ...opts,
  });
}

export function useShortcutInstall() {
  const qc = useQueryClient();
  return useMutation<ShortcutInstall, ApiError, string>({
    mutationFn: (id) => api.phone.install(id),
    onSuccess: (install) => {
      if (install.personal) void qc.invalidateQueries({ queryKey: queryKeys.devices });
    },
  });
}

/** Paired phones. While a pairing offer is on screen the list is polled, so the card turns green. */
export function useDevices(opts?: QueryOpts<Device[]>) {
  return useQuery<Device[], ApiError>({
    queryKey: queryKeys.devices,
    queryFn: ({ signal }) => api.devices.list(signal),
    ...opts,
  });
}

/** While an app pairing is open, its state is polled until the codes are ready to compare. */
export function useRemotePairing(id: string | undefined) {
  return useQuery<RemotePairingState, ApiError>({
    queryKey: ["devices", "remote", id],
    queryFn: ({ signal }) => api.devices.remoteState(id!, signal),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && q.state.data.state !== "waiting" ? false : 1500),
  });
}

export function usePairDevice() {
  return useMutation<PairingOffer, ApiError, DeviceKind>({ mutationFn: (kind) => api.devices.pair(kind) });
}

export function usePatchDevice() {
  const qc = useQueryClient();
  return useMutation<Device, ApiError, { id: string } & DevicePatchInput>({
    mutationFn: ({ id, ...body }) => api.devices.patch(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.devices });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api.devices.revoke(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.devices });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

// ── Derived counts ─────────────────────────────────────────────────────────────────────────────

/**
 * How many things wait on the person: tasks that need them, tasks that could not finish, and
 * pending approvals no task already stands for. The Tasks badge and the Needs you tab use this.
 */
export function needsYouCount(tasks: TasksResponse | undefined, pending: Approval[] | undefined): number {
  const taskCount = (tasks?.counts.needs_you ?? 0) + (tasks?.counts.failed ?? 0);
  const linked = new Set((tasks?.tasks ?? []).map((t) => t.approvalId).filter(Boolean));
  const loose = (pending ?? []).filter((a) => a.status === "pending" && !linked.has(a.id)).length;
  return taskCount + loose;
}
