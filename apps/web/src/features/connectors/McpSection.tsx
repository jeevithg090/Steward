// "Use Tempo from your AI (MCP)" (plan.md §14.1, §14.2): the Gateway's MCP server URL, its
// transport, the tools with read-only badges, and a config to copy for Claude Code, Zed, Cursor and
// Claude Desktop. No tool approves anything: a started claim waits for the person's own yes.
import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, Eye, EyeOff, Hand, Lock, Play } from "lucide-react";
import { Badge, Button, EmptyState, Skeleton, toast } from "@/components/ui";
import type { Gateway, McpEntry, McpInfo } from "@/lib/api";
import { gatewayConfig } from "@/lib/config";
import { plainError } from "@/components/mission";

/** What the snippets show in the showcase, where there is no Gateway and no token. */
export const PLACEHOLDER_TOKEN = "<your-token>";
const MASK = "••••••••";
const TAP = "min-h-[44px]";
/** Long addresses and names wrap where they must, at a space when there is one, never off the screen. */
const WRAP = "[overflow-wrap:anywhere]";

/** A tool name that may break after each underscore on a narrow screen. */
function ToolName({ name }: { name: string }) {
  const parts = name.split("_");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              _<wbr />
            </>
          )}
        </span>
      ))}
    </>
  );
}

export interface McpClient {
  id: string;
  name: string;
  /** Where the snippet goes, in plain words. */
  where: string;
  build: (url: string, token: string) => string;
}

/** The mcp-remote version docs/mcp.md was checked against. */
export const MCP_REMOTE = "0.14.3";

/** The four clients docs/mcp.md gives configs for, in the same shapes. */
export const MCP_CLIENTS: McpClient[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    where: "Run this once in a terminal.",
    build: (url, token) => `claude mcp add --transport http tempo ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    id: "zed",
    name: "Zed",
    where: "Add this to your Zed settings.json.",
    build: (url, token) => JSON.stringify({ context_servers: { tempo: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
  {
    id: "cursor",
    name: "Cursor",
    where: "Put this in .cursor/mcp.json in a project, or ~/.cursor/mcp.json.",
    build: (url, token) => JSON.stringify({ mcpServers: { tempo: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    where: "Put this in claude_desktop_config.json, then restart Claude Desktop. It runs the mcp-remote bridge with npx.",
    build: (url, token) =>
      JSON.stringify(
        {
          mcpServers: {
            tempo: {
              command: "npx",
              args: ["-y", `mcp-remote@${MCP_REMOTE}`, url, "--transport", "http-only", "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      ),
  },
];

const TRANSPORT_WORDS: Record<string, string> = { "streamable-http": "Streamable HTTP" };

function entryName(entry: McpEntry): string {
  return typeof entry === "string" ? entry : (entry.uri_template ?? entry.uri ?? entry.name ?? "");
}

function entryWords(entry: McpEntry): string | null {
  return typeof entry === "string" ? null : (entry.description ?? null);
}

async function copyText(text: string, done: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
    toast.success(done);
    return true;
  } catch {
    toast.error("Couldn't copy. Select the text and copy it yourself.");
    return false;
  }
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="quiet"
      size="sm"
      aria-label={label}
      className={`${TAP} shrink-0 px-3`}
      icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      onClick={() => void copyText(text, done).then(setCopied)}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Snippet({ client, url, token, shown, live }: { client: McpClient; url: string; token: string; shown: boolean; live: boolean }) {
  const real = client.build(url, token);
  const visible = live && !shown ? client.build(url, MASK) : real;
  return (
    <li className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="min-w-0 text-sm font-semibold text-slate-100">{client.name}</h4>
        <CopyButton
          text={real}
          label={`Copy the ${client.name} config`}
          done={live ? `Copied the ${client.name} config. It has your token in it: keep it private.` : `Copied the ${client.name} config. Put in your own Gateway address and token.`}
        />
      </div>
      <p className="text-xs text-slate-400">{client.where}</p>
      <pre className={`mt-2 max-w-full overflow-hidden whitespace-pre-wrap rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-slate-200 ${WRAP}`}>
        <code>{visible}</code>
      </pre>
    </li>
  );
}

interface McpSectionProps {
  gateway: Gateway;
  showcase: boolean;
}

export function McpSection({ gateway, showcase }: McpSectionProps) {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const config = showcase ? null : gatewayConfig();

  const load = useCallback(() => {
    let live = true;
    setError(null);
    gateway
      .mcpInfo()
      .then((i) => live && setInfo(i))
      .catch((e) => {
        if (!live) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(/HTTP 404/.test(message) ? "This Gateway doesn't describe an MCP server yet (GET /mcp/info is missing). Update the Gateway, then try again." : `${plainError(e).replace(/\.?$/, ".")} Try again, or check the Gateway in Settings.`);
      });
    return () => {
      live = false;
    };
  }, [gateway]);
  useEffect(load, [load]);

  // A Gateway that can't describe itself still has a likely address: its own, plus /mcp.
  const url = info?.url ?? (config ? `${config.url}/mcp` : "");
  const token = config?.token || PLACEHOLDER_TOKEN;
  const live = Boolean(config?.token);

  return (
    <section aria-labelledby="mcp-heading" className="rounded-2xl border border-white/10 bg-nexus-card p-4 text-slate-200 lg:p-5">
      <h2 id="mcp-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-50">
        <Bot size={20} aria-hidden className="shrink-0 text-indigo-300" /> Use Tempo from your AI (MCP)
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-300">
        Any AI app that speaks MCP, like Claude Code, Claude Desktop, Zed or Cursor, can ask Tempo to check a message, read a letter, start a claim or see what has been paid back.
      </p>
      <p className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm font-bold text-emerald-100">
        <Hand size={16} aria-hidden className="mt-0.5 shrink-0 text-emerald-300" />
        No tool can approve: the person says yes on their own device.
      </p>
      {showcase && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          There&apos;s no Gateway in the showcase, so there is no MCP server to connect to. The configs below show placeholders. Run Tempo locally and this page fills in your server&apos;s address and token.
        </p>
      )}
      {error && (
        <div className="mt-3">
          <EmptyState title="Couldn't load the MCP details" tone="error" action={<Button variant="quiet" onClick={load} className={TAP}>Try again</Button>}>
            {error}
          </EmptyState>
        </div>
      )}

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:items-center sm:gap-x-4">
        <dt className="text-xs text-slate-400">Server address</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          {url ? (
            <>
              <code className={`min-w-0 rounded-lg bg-black/30 px-2 py-1 font-mono text-[12px] text-slate-100 ${WRAP}`}>{url}</code>
              <CopyButton text={url} label="Copy the server address" done="Copied the server address." />
            </>
          ) : (
            <Skeleton className="h-6 w-64 max-w-full" />
          )}
        </dd>
        <dt className="text-xs text-slate-400">How it connects</dt>
        <dd className="text-slate-200">{info ? (TRANSPORT_WORDS[info.transport] ?? info.transport) : "Streamable HTTP"}, with the same token as this app</dd>
        <dt className="text-xs text-slate-400">Your token</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <code className={`min-w-0 rounded-lg bg-black/30 px-2 py-1 font-mono text-[12px] text-slate-100 ${WRAP}`}>{live && !shown ? MASK : token}</code>
          {live && (
            <Button
              variant="quiet"
              size="sm"
              aria-pressed={shown}
              className={`${TAP} px-3`}
              icon={shown ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              onClick={() => setShown((s) => !s)}
            >
              {shown ? "Hide" : "Show"}
            </Button>
          )}
          {!live && <span className="text-xs text-slate-400">Settings holds the token when Tempo runs locally.</span>}
        </dd>
      </dl>

      <h3 className="mt-5 text-sm font-semibold text-slate-100">What your AI may ask</h3>
      {info === null && !error && (
        <div role="status" aria-label="Loading the MCP tools" className="mt-2 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {info && (
        <table className="mt-2 w-full table-fixed border-separate border-spacing-0 text-left text-sm">
          <caption className="sr-only">The tools Tempo's MCP server offers</caption>
          <colgroup>
            <col className="w-[38%] sm:w-[30%]" />
            <col />
          </colgroup>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-400">
              <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">Tool</th>
              <th scope="col" className="border-b border-white/10 pb-2 font-semibold">What it does</th>
            </tr>
          </thead>
          <tbody>
            {info.tools.map((tool) => (
              <tr key={tool.name} className="align-top">
                <th scope="row" className="border-b border-white/5 py-2.5 pr-3 font-normal">
                  <code className={`block font-mono text-[12px] text-slate-100 ${WRAP}`}>
                    <ToolName name={tool.name} />
                  </code>
                </th>
                <td className="break-words border-b border-white/5 py-2.5 text-slate-300">
                  {tool.description}
                  <span className="mt-1 block">
                    {tool.read_only ? (
                      <Badge tone="emerald" className="whitespace-nowrap">
                        <Lock size={10} aria-hidden /> read-only
                      </Badge>
                    ) : (
                      <Badge tone="amber" className="whitespace-nowrap">
                        <Play size={10} aria-hidden /> starts, never approves
                      </Badge>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {info && (info.resources.length > 0 || info.prompts.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {info.resources.length > 0 && (
            <div className="min-w-0">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Things it can read</p>
              <ul className="space-y-1.5 text-sm">
                {info.resources.map((r) => (
                  <li key={entryName(r)} className="min-w-0">
                    <code className={`font-mono text-[12px] text-slate-100 ${WRAP}`}>{entryName(r)}</code>
                    {entryWords(r) && <span className="block text-xs text-slate-400">{entryWords(r)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {info.prompts.length > 0 && (
            <div className="min-w-0">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Ready-made prompts</p>
              <ul className="space-y-1.5 text-sm">
                {info.prompts.map((p) => (
                  <li key={entryName(p)} className="min-w-0">
                    <code className={`font-mono text-[12px] text-slate-100 ${WRAP}`}>{entryName(p)}</code>
                    {entryWords(p) && <span className="block text-xs text-slate-400">{entryWords(p)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <h3 className="mt-5 text-sm font-semibold text-slate-100">Connect your AI</h3>
      <p className="mt-1 text-xs text-slate-400">
        {live ? "Your token is hidden on screen; Copy puts the real one on your clipboard." : "Swap the placeholders for your Gateway's address and token."}
      </p>
      {url ? (
        <ul className="mt-2 grid gap-3 lg:grid-cols-2">
          {MCP_CLIENTS.map((client) => (
            <Snippet key={client.id} client={client} url={url} token={token} shown={shown} live={live} />
          ))}
        </ul>
      ) : (
        <Skeleton className="mt-2 h-24 w-full" />
      )}
    </section>
  );
}
