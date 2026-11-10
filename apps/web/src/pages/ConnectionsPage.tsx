import type { McpToolKind, ToolKind, ToolSurface } from "@steward/shared";
import { KeyRound, Mail, Plug, Plus, RotateCw, Server, Trash, TriangleAlert, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card, CardHeader } from "@/components/ui/Card.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { ChoiceGroup, Field, Input, Select, Switch, Textarea } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading, Notice } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { Spinner } from "@/components/ui/Spinner.tsx";
import {
  type McpServerDetail,
  useConnections,
  useReconnectMcp,
  useRemoveMcp,
  useUpsertMcp,
} from "@/lib/api.ts";
import { KIND_LABELS, SURFACE_LABELS, toolLabel } from "@/lib/labels.ts";

/** How often the page looks again while a server is still starting. */
const CONNECTING_POLL_MS = 2_000;

export function ConnectionsPage() {
  const connections = useConnections({
    refetchInterval: (query) =>
      query.state.data?.mcp.some((server) => server.status === "connecting") ? CONNECTING_POLL_MS : false,
  });
  return (
    <Page
      title="Connections"
      width="wide"
      description={
        <p>
          Where Steward can read and act: your mail and calendar, apps connected over MCP, and its own
          built-in tools. Every call still goes through your rules.
        </p>
      }
    >
      {connections.isPending ? (
        <Loading>Loading your connections…</Loading>
      ) : connections.isError ? (
        <ErrorNotice
          title="Couldn't load your connections"
          error={connections.error}
          onRetry={() => void connections.refetch()}
        />
      ) : (
        <>
          <MailCard mail={connections.data.mail} />
          <McpSection servers={connections.data.mcp} />
          <AddServer />
          <BuiltinTools tools={connections.data.builtin} />
        </>
      )}
    </Page>
  );
}

function MailCard({ mail }: { mail: { connected: boolean; label: string; isDemo: boolean } }) {
  return (
    <Card as="section" aria-labelledby="conn-mail">
      <CardHeader
        id="conn-mail"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Mail aria-hidden="true" className="size-5 text-ink-2" />
            Mail and calendar
            {mail.isDemo ? <Badge tone="needs">Demo</Badge> : null}
          </span>
        }
        actions={
          mail.connected ? <Pill tone="done">Connected</Pill> : <Pill tone="needs">Not connected</Pill>
        }
      />
      <p className="mt-3 text-ink text-sub">{mail.label}</p>
      <p className="mt-1 text-ink-2 text-sub">
        {mail.isDemo
          ? "This is a made-up inbox and calendar, so you can try Steward safely. Nothing here is real, and nothing is sent anywhere. To use your own Google account, set STEWARD_DEMO_GOOGLE=0 and add your Google credentials in .env, then restart."
          : mail.connected
            ? "Steward can read your mail and calendar. It asks before it sends an email or changes your calendar."
            : "Steward can't read your mail or calendar yet. The brief will say so until it can."}
      </p>
    </Card>
  );
}

function statusPill(server: McpServerDetail) {
  if (server.status === "connected") return <Pill tone="done">Connected</Pill>;
  if (server.status === "error") return <Pill tone="problem">Problem</Pill>;
  if (server.status === "connecting") {
    return (
      <Pill tone="neutral" icon={null}>
        <Spinner />
        Connecting…
      </Pill>
    );
  }
  return <Pill tone="neutral">Off</Pill>;
}

function McpSection({ servers }: { servers: McpServerDetail[] }) {
  return (
    <section aria-labelledby="conn-mcp" className="flex flex-col gap-3">
      <div>
        <h2 id="conn-mcp" className="font-semibold text-ink text-title">
          Connected apps (MCP)
        </h2>
        <p className="mt-1 text-ink-2 text-sub">
          New tools start switched off. Switch on the ones Steward may use, and say what each one does.
          Anything you haven't marked is treated as a change. Tools that send or delete always ask after
          Steward has read something it doesn't trust, and routines never send.
        </p>
      </div>
      {servers.length === 0 ? (
        <EmptyState icon={Plug} title="No apps connected" level={3}>
          Add an MCP server below to give Steward more tools, such as your notes or your project tracker.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {servers.map((server) => (
            <li key={server.id}>
              <McpServerCard server={server} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What the person said about a server's tools: which Steward may use, and what each one does. */
interface Marks {
  granted: string[];
  reads: string[];
  sends: string[];
  deletes: string[];
  /** Tools the person looked at again after their server changed them. */
  allowAgain?: string[];
}

const KIND_CHOICES: { value: McpToolKind; label: string }[] = [
  { value: "read", label: "Only reads" },
  { value: "write", label: "Changes things" },
  { value: "send", label: "Sends or posts" },
  { value: "delete", label: "Deletes things" },
];

/** A tool the server calls destructive is a delete unless marked as sending: nothing looser. */
const DESTRUCTIVE_CHOICES = KIND_CHOICES.filter((c) => c.value === "delete" || c.value === "send");

function marksOf(server: McpServerDetail): Marks {
  const named = (keep: (t: McpServerDetail["tools"][number]) => boolean) =>
    server.tools.filter(keep).map((t) => t.name);
  return {
    granted: named((t) => t.granted),
    reads: named((t) => t.kind === "read"),
    sends: named((t) => t.kind === "send"),
    // A destructive tool is a delete without being marked.
    deletes: named((t) => t.kind === "delete" && !t.destructive),
  };
}

function withKind(marks: Marks, name: string, kind: McpToolKind): Marks {
  const without = (list: string[]) => list.filter((n) => n !== name);
  return {
    granted: marks.granted,
    reads: kind === "read" ? [...without(marks.reads), name] : without(marks.reads),
    sends: kind === "send" ? [...without(marks.sends), name] : without(marks.sends),
    deletes: kind === "delete" ? [...without(marks.deletes), name] : without(marks.deletes),
  };
}

function withGrant(marks: Marks, name: string, on: boolean): Marks {
  const granted = marks.granted.filter((n) => n !== name);
  return { ...marks, granted: on ? [...granted, name] : granted };
}

function McpServerCard({ server }: { server: McpServerDetail }) {
  const upsert = useUpsertMcp();
  const remove = useRemoveMcp();
  const reconnect = useReconnectMcp();
  const [confirming, setConfirming] = useState(false);
  const [editingSecrets, setEditingSecrets] = useState(false);
  const headingId = useId();
  const secretsText = savedSecretsText(server);

  function saveSecrets(change: { env?: Record<string, string | null>; bearerToken?: string | null }) {
    upsert.mutate(
      {
        existing: true,
        id: server.id,
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args ?? [],
        url: server.url,
        ...marks,
        ...change,
      },
      {
        onSuccess: () => {
          setEditingSecrets(false);
          toast.success("Secrets saved", { description: server.name });
        },
        onError: (error) => toast.error("Couldn't save the secrets", { description: error.message }),
      },
    );
  }

  function tryAgain() {
    reconnect.mutate(server.id, {
      onSuccess: (info) => {
        if (info.status === "connected") toast.success(`${server.name} is connected`);
      },
      onError: (error) => toast.error("Couldn't try again", { description: error.message }),
    });
  }

  function save(next: Marks) {
    upsert.mutate(
      {
        existing: true,
        id: server.id,
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args ?? [],
        url: server.url,
        ...next,
      },
      { onError: (error) => toast.error("Couldn't save that change", { description: error.message }) },
    );
  }

  const marks = marksOf(server);

  return (
    <Card as="article" aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="flex flex-wrap items-center gap-2 font-semibold text-body text-ink">
            <Server aria-hidden="true" className="size-5 text-ink-2" />
            {server.name}
            <span aria-live="polite" className="contents">
              {statusPill(server)}
            </span>
          </h3>
          <p className="mt-1 text-caption text-ink-2">
            <code>{server.id}</code> ·{" "}
            {server.transport === "stdio" ? "A program on this computer" : "A web address"}
            {server.url ? ` · ${server.url}` : ""}
            {server.command ? ` · ${server.command} ${(server.args ?? []).join(" ")}` : ""}
          </p>
          {secretsText ? <p className="mt-1 text-caption text-ink-2">{secretsText}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            icon={<KeyRound />}
            onClick={() => setEditingSecrets(true)}
            aria-label={`Secrets for ${server.name}`}
          >
            Secrets
          </Button>
          <Button
            variant="ghost"
            icon={<Trash />}
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${server.name}`}
          >
            Remove
          </Button>
        </div>
      </div>
      {server.status === "error" && server.error ? (
        <Notice
          tone="problem"
          title="It didn't connect"
          action={
            <Button size="sm" icon={<RotateCw />} loading={reconnect.isPending} onClick={tryAgain}>
              Try again
            </Button>
          }
        >
          {server.error}
        </Notice>
      ) : null}
      {server.notice ? <p className="text-ink-2 text-sub">{server.notice}</p> : null}
      {server.tools.length === 0 ? (
        <p className="text-ink-2 text-sub">
          {server.status === "connected"
            ? "This server offers no tools."
            : server.status === "connecting"
              ? "Starting it. A program fetched with npx can take a minute the first time."
              : "Its tools show up here once it connects."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {server.tools.map((tool) => (
            <McpToolRow
              key={tool.name}
              tool={tool}
              busy={upsert.isPending}
              onKind={(kind) => save(withKind(marks, tool.name, kind))}
              onGrant={(on) => save(withGrant(marks, tool.name, on))}
              onAllowAgain={() => save({ ...marks, allowAgain: [tool.name] })}
            />
          ))}
        </ul>
      )}
      <SecretsDialog
        server={server}
        open={editingSecrets}
        onOpenChange={setEditingSecrets}
        onSave={saveSecrets}
        saving={upsert.isPending}
      />
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title={`Remove ${server.name}?`}
        description="Steward stops using its tools straight away. You can add it again later."
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Keep it</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(server.id, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success("Removed", { description: server.name });
                  },
                  onError: (error) => toast.error("Couldn't remove it", { description: error.message }),
                })
              }
            >
              Remove
            </Button>
          </>
        }
      />
    </Card>
  );
}

function McpToolRow({
  tool,
  busy,
  onKind,
  onGrant,
  onAllowAgain,
}: {
  tool: McpServerDetail["tools"][number];
  busy: boolean;
  onKind: (kind: McpToolKind) => void;
  onGrant: (on: boolean) => void;
  onAllowAgain: () => void;
}) {
  const noteId = useId();
  const choices = tool.destructive ? DESTRUCTIVE_CHOICES : KIND_CHOICES;
  // A tool no model could be offered can't be switched on; one already on can still be switched off.
  const blocked = !tool.offerable && !tool.granted;
  return (
    <li className="grid gap-x-4 gap-y-1 border-hair-2 border-t py-3 first:border-t-0 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-medium text-ink text-sub">{toolLabel(tool.name)}</p>
        <p className="text-caption text-ink-2">{tool.description}</p>
        {tool.destructive ? (
          <p id={noteId} className="mt-1 text-caption text-ink-2">
            Its server says it can delete or overwrite things, so Steward treats it as deleting.
          </p>
        ) : null}
        {tool.why ? (
          <p className="mt-1 text-caption text-problem">Steward can't offer it: {tool.why}</p>
        ) : null}
      </div>
      <div>
        <Select
          aria-label={`What ${tool.name} does`}
          aria-describedby={tool.destructive ? noteId : undefined}
          value={tool.kind}
          className="min-w-40"
          disabled={busy}
          onChange={(e) => onKind(e.target.value as McpToolKind)}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </div>
      <Switch
        checked={tool.granted}
        disabled={busy || blocked}
        label={
          <>
            Steward may use it<span className="sr-only">: {tool.name}</span>
          </>
        }
        onCheckedChange={onGrant}
      />
      {tool.changed ? (
        <Notice
          tone="needs"
          title="Changed since you allowed it"
          className="mt-2 sm:col-span-3"
          action={
            <Button size="sm" disabled={busy} onClick={onAllowAgain}>
              Allow again<span className="sr-only">: {tool.name}</span>
            </Button>
          }
        >
          Its server changed what it says this tool does, so Steward has stopped using it. Read what it says
          now, above, and allow it again only if that is still what you want.
        </Notice>
      ) : null}
    </li>
  );
}

// ── Secrets: write-only, never shown again ──────────────────────────────────────────────────────

const TOKEN_HELP =
  "If the server asks for one. Sent as Authorization: Bearer. Saved on this computer and never shown again.";

/** One environment variable being typed: its name and its new value. */
interface SecretRow {
  key: number;
  name: string;
  value: string;
}

let nextSecretKey = 0;
const newSecretRow = (): SecretRow => ({ key: nextSecretKey++, name: "", value: "" });

/** What's wrong with the rows, if anything. Empty rows are ignored. */
function secretRowsError(rows: SecretRow[], saved: string[] = []): string | undefined {
  const names = new Set<string>(saved);
  for (const row of rows) {
    if (!row.name && !row.value) continue;
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(row.name)) {
      return "Each name is capital letters, digits and _, starting with a letter or _.";
    }
    if (row.name === "PATH" || row.name === "HOME") return `${row.name} is Steward's to set.`;
    if (!row.value) return `Give ${row.name} a value.`;
    if (names.has(row.name)) return `${row.name} is there twice.`;
    names.add(row.name);
  }
  return undefined;
}

function envOf(rows: SecretRow[]): Record<string, string> | undefined {
  const filled = rows.filter((row) => row.name && row.value);
  return filled.length > 0 ? Object.fromEntries(filled.map((row) => [row.name, row.value])) : undefined;
}

/** Environment variables for a program: name and value, values hidden as they are typed. */
function SecretRowsEditor({
  rows,
  onChange,
  error,
}: {
  rows: SecretRow[];
  onChange: (rows: SecretRow[]) => void;
  error?: string;
}) {
  const update = (key: number, change: Partial<SecretRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-medium text-ink text-sub">Secret settings</legend>
      <p className="-mt-1 text-caption text-ink-2">
        For an access token the program reads from its environment, such as GITHUB_PERSONAL_ACCESS_TOKEN. Put
        tokens here, not in the arguments: arguments are shown on this page. Saved on this computer and never
        shown again.
      </p>
      {rows.map((row, index) => (
        <div key={row.key} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label={`Name ${index + 1}`}>
            <Input
              value={row.name}
              onChange={(e) => update(row.key, { name: e.target.value.toUpperCase() })}
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
              placeholder="API_TOKEN"
            />
          </Field>
          <Field label={`Value ${index + 1}`}>
            <Input
              type="password"
              value={row.value}
              onChange={(e) => update(row.key, { value: e.target.value })}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <Button
            variant="ghost"
            icon={<X />}
            aria-label={`Remove setting ${index + 1}`}
            onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
          />
        </div>
      ))}
      {error ? (
        <p role="alert" className="font-medium text-caption text-problem">
          {error}
        </p>
      ) : null}
      <div>
        <Button size="sm" icon={<Plus />} onClick={() => onChange([...rows, newSecretRow()])}>
          Add a secret setting
        </Button>
      </div>
    </fieldset>
  );
}

/** What a card says about its saved secrets, without ever having their values. */
function savedSecretsText(server: McpServerDetail): string | undefined {
  if (server.transport === "http") return server.hasToken ? "An access token is saved." : undefined;
  const names = server.envNames ?? [];
  return names.length > 0 ? `Secret settings saved: ${names.join(", ")}.` : undefined;
}

/** Replace, remove or add a server's secrets. Saved values never come back, so only new ones are typed. */
function SecretsDialog({
  server,
  open,
  onOpenChange,
  onSave,
  saving,
}: {
  server: McpServerDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (change: { env?: Record<string, string | null>; bearerToken?: string | null }) => void;
  saving: boolean;
}) {
  const saved = server.envNames ?? [];
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [token, setToken] = useState("");
  const [removeToken, setRemoveToken] = useState(false);
  const [touched, setTouched] = useState(false);
  const error = server.transport === "stdio" ? secretRowsError(rows, saved) : undefined;

  function reset(next: boolean) {
    if (!next) {
      setReplacements({});
      setRemoved([]);
      setRows([]);
      setToken("");
      setRemoveToken(false);
      setTouched(false);
    }
    onOpenChange(next);
  }

  function save() {
    setTouched(true);
    if (error) return;
    if (server.transport === "http") {
      if (removeToken) onSave({ bearerToken: null });
      else if (token.trim()) onSave({ bearerToken: token.trim() });
      else reset(false);
      return;
    }
    const env: Record<string, string | null> = {};
    for (const name of removed) env[name] = null;
    for (const [name, value] of Object.entries(replacements))
      if (value && !removed.includes(name)) env[name] = value;
    Object.assign(env, envOf(rows));
    if (Object.keys(env).length > 0) onSave({ env });
    else reset(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={reset}
      size="md"
      title={`Secrets for ${server.name}`}
      description="Steward never shows a saved value again. Type a new one to replace it."
      footer={
        <>
          <Button onClick={() => reset(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save secrets
          </Button>
        </>
      }
    >
      {server.transport === "http" ? (
        <div className="flex flex-col gap-3">
          <Field label="Access token" description={TOKEN_HELP}>
            <Input
              type="password"
              value={token}
              disabled={removeToken}
              onChange={(e) => setToken(e.target.value)}
              placeholder={server.hasToken ? "Saved. Type a new one to replace it." : "None saved"}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          {server.hasToken ? (
            <Switch checked={removeToken} onCheckedChange={setRemoveToken} label="Remove the saved token" />
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {saved.map((name) => (
            <div key={name} className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
              <Field label={<code>{name}</code>}>
                <Input
                  type="password"
                  value={replacements[name] ?? ""}
                  disabled={removed.includes(name)}
                  onChange={(e) => setReplacements({ ...replacements, [name]: e.target.value })}
                  placeholder="Saved. Type a new value to replace it."
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
              <Switch
                checked={removed.includes(name)}
                onCheckedChange={(on) =>
                  setRemoved(on ? [...removed, name] : removed.filter((n) => n !== name))
                }
                label={
                  <>
                    Remove<span className="sr-only"> {name}</span>
                  </>
                }
              />
            </div>
          ))}
          <SecretRowsEditor rows={rows} onChange={setRows} error={touched ? error : undefined} />
        </div>
      )}
    </Dialog>
  );
}

/** Splits "-y @modelcontextprotocol/server-everything" or one-per-line into arguments. */
function splitArgs(text: string): string[] {
  return text
    .split(/\n/)
    .flatMap((line) => (line.includes(" ") && !line.includes('"') ? line.split(/\s+/) : [line]))
    .map((a) => a.trim())
    .filter(Boolean);
}

function AddServer() {
  const upsert = useUpsertMcp();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [secretRows, setSecretRows] = useState<SecretRow[]>([]);
  const [token, setToken] = useState("");
  const [touched, setTouched] = useState(false);

  const secretsError = transport === "stdio" ? secretRowsError(secretRows) : undefined;
  const idError = !/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)
    ? "Lowercase letters, numbers and dashes, starting with a letter or number."
    : undefined;
  const endpointError =
    transport === "stdio"
      ? command.trim()
        ? undefined
        : "Say which program to run."
      : /^https?:\/\/\S+$/.test(url.trim())
        ? undefined
        : "Give the full address, starting with https://.";

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (idError || endpointError || secretsError || !name.trim()) return;
    const env = transport === "stdio" ? envOf(secretRows) : undefined;
    upsert.mutate(
      {
        id,
        name: name.trim(),
        transport,
        command: transport === "stdio" ? command.trim() : undefined,
        args: transport === "stdio" ? splitArgs(args) : [],
        url: transport === "http" ? url.trim() : undefined,
        granted: [],
        reads: [],
        sends: [],
        deletes: [],
        ...(env ? { env } : {}),
        ...(transport === "http" && token.trim() ? { bearerToken: token.trim() } : {}),
      },
      {
        onSuccess: (server) => {
          if (server.status === "error") {
            toast.warning(`Saved ${server.name}, but it didn't connect`, {
              description: server.error ?? "Its card below says what went wrong.",
            });
          } else if (server.status === "connecting") {
            toast.success(`Added ${server.name}`, {
              description: "It's still starting. Its tools show up once it connects.",
            });
          } else {
            toast.success(`Added ${server.name}`, { description: "Switch on the tools Steward may use." });
          }
          setId("");
          setName("");
          setCommand("");
          setArgs("");
          setUrl("");
          setSecretRows([]);
          setToken("");
          setTouched(false);
        },
      },
    );
  }

  return (
    <Card as="section" aria-labelledby="conn-add">
      <CardHeader
        id="conn-add"
        title="Add an app"
        description="Connect any MCP server: a program on this computer or a web address."
      />
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={touched && !name.trim() ? "Give it a name." : undefined}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My notes"
              maxLength={120}
            />
          </Field>
          <Field
            label="Short id"
            required
            description="Used in tool names: mcp__<id>__<tool>."
            error={touched ? idError : undefined}
          >
            <Input
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase())}
              placeholder="notes"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
        </div>
        <ChoiceGroup
          legend="How Steward reaches it"
          value={transport}
          onValueChange={setTransport}
          choices={[
            { value: "stdio", label: "A program on this computer" },
            { value: "http", label: "A web address" },
          ]}
        />
        {transport === "stdio" ? (
          <>
            <Notice tone="needs" title="Only add programs you trust">
              Steward starts this program on your computer, with your permissions.
            </Notice>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Program" required error={touched ? endpointError : undefined}>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className="font-mono"
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>
              <Field label="Arguments" description="Separated by spaces, or one per line.">
                <Textarea
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  rows={2}
                  className="font-mono text-sub"
                  spellCheck={false}
                  placeholder="-y @modelcontextprotocol/server-everything"
                />
              </Field>
            </div>
            <SecretRowsEditor
              rows={secretRows}
              onChange={setSecretRows}
              error={touched ? secretsError : undefined}
            />
          </>
        ) : (
          <>
            <Field label="Address" required error={touched ? endpointError : undefined}>
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field label="Access token" description={TOKEN_HELP}>
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          </>
        )}
        {upsert.isError ? (
          <p role="alert" className="flex items-center gap-2 font-medium text-problem text-sub">
            <TriangleAlert aria-hidden="true" className="size-4" />
            {upsert.error.message}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" icon={<Plus />} loading={upsert.isPending}>
            Add app
          </Button>
        </div>
      </form>
    </Card>
  );
}

function BuiltinTools({
  tools,
}: {
  tools: { name: string; description: string; kind: string; surface: string }[];
}) {
  return (
    <section aria-labelledby="conn-builtin" className="flex flex-col gap-3">
      <div>
        <h2 id="conn-builtin" className="font-semibold text-ink text-title">
          Built-in tools
        </h2>
        <p className="mt-1 text-ink-2 text-sub">
          What Steward can do on its own computer and with your connections.
        </p>
      </div>
      <div className="overflow-x-auto rounded-card bg-card shadow-card">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sub">
          <caption className="sr-only">Built-in tools, what each does, and where it acts</caption>
          <thead>
            <tr className="border-hair border-b text-ink-2">
              <th scope="col" className="px-4 py-3 font-medium">
                Tool
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                What it does
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Kind
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Where
              </th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.name} className="border-hair-2 border-t align-top first:border-t-0">
                <th scope="row" className="px-4 py-3 font-medium text-ink">
                  {toolLabel(tool.name)}
                  <code className="block font-normal text-caption text-ink-3">{tool.name}</code>
                </th>
                <td className="px-4 py-3 text-ink-2">{tool.description}</td>
                <td className="px-4 py-3 text-ink">{KIND_LABELS[tool.kind as ToolKind] ?? tool.kind}</td>
                <td className="px-4 py-3 text-ink">
                  {SURFACE_LABELS[tool.surface as ToolSurface] ?? tool.surface}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
