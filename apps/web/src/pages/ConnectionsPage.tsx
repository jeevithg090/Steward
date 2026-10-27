import type { ToolKind, ToolSurface } from "@steward/shared";
import { Mail, Plug, Plus, Server, Trash, TriangleAlert } from "lucide-react";
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
import { type McpServerDetail, useConnections, useRemoveMcp, useUpsertMcp } from "@/lib/api.ts";
import { KIND_LABELS, SURFACE_LABELS, toolLabel } from "@/lib/labels.ts";

export function ConnectionsPage() {
  const connections = useConnections();
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
          New tools start switched off. Switch on the ones Steward may use, and mark the ones that only read:
          anything not marked is treated as a change and follows the rules for changes.
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

function McpServerCard({ server }: { server: McpServerDetail }) {
  const upsert = useUpsertMcp();
  const remove = useRemoveMcp();
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();

  function save(granted: string[], reads: string[]) {
    upsert.mutate(
      {
        existing: true,
        id: server.id,
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args ?? [],
        url: server.url,
        granted,
        reads,
      },
      { onError: (error) => toast.error("Couldn't save that change", { description: error.message }) },
    );
  }

  const granted = server.tools.filter((t) => t.granted).map((t) => t.name);
  const reads = server.tools.filter((t) => t.kind === "read").map((t) => t.name);

  return (
    <Card as="article" aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="flex flex-wrap items-center gap-2 font-semibold text-body text-ink">
            <Server aria-hidden="true" className="size-5 text-ink-2" />
            {server.name}
            {statusPill(server)}
          </h3>
          <p className="mt-1 text-caption text-ink-2">
            <code>{server.id}</code> ·{" "}
            {server.transport === "stdio" ? "A program on this computer" : "A web address"}
            {server.url ? ` · ${server.url}` : ""}
            {server.command ? ` · ${server.command} ${(server.args ?? []).join(" ")}` : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          icon={<Trash />}
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${server.name}`}
        >
          Remove
        </Button>
      </div>
      {server.status === "error" && server.error ? (
        <Notice tone="problem" title="It didn't connect">
          {server.error}
        </Notice>
      ) : null}
      {server.tools.length === 0 ? (
        <p className="text-ink-2 text-sub">
          {server.status === "connected"
            ? "This server offers no tools."
            : "Its tools show up here once it connects."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {server.tools.map((tool) => (
            <li
              key={tool.name}
              className="grid gap-x-4 gap-y-1 border-hair-2 border-t py-3 first:border-t-0 sm:grid-cols-[1fr_auto_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink text-sub">{toolLabel(tool.name)}</p>
                <p className="text-caption text-ink-2">{tool.description}</p>
              </div>
              <div>
                <Select
                  aria-label={`What ${tool.name} does`}
                  value={tool.kind}
                  className="min-w-40"
                  disabled={upsert.isPending}
                  onChange={(e) =>
                    save(
                      granted,
                      e.target.value === "read"
                        ? [...new Set([...reads, tool.name])]
                        : reads.filter((r) => r !== tool.name),
                    )
                  }
                >
                  <option value="read">Only reads</option>
                  <option value="write">Changes things</option>
                </Select>
              </div>
              <Switch
                checked={tool.granted}
                disabled={upsert.isPending}
                label={
                  <>
                    Steward may use it<span className="sr-only">: {tool.name}</span>
                  </>
                }
                onCheckedChange={(on) =>
                  save(
                    on ? [...new Set([...granted, tool.name])] : granted.filter((g) => g !== tool.name),
                    reads,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
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
  const [touched, setTouched] = useState(false);

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
    if (idError || endpointError || !name.trim()) return;
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
      },
      {
        onSuccess: (server) => {
          toast.success(`Added ${server.name}`, { description: "Switch on the tools Steward may use." });
          setId("");
          setName("");
          setCommand("");
          setArgs("");
          setUrl("");
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
          </>
        ) : (
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
