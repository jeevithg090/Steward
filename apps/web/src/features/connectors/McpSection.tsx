// "Use Tempo from your AI (MCP)" (plan.md §14.1, §14.2): the Gateway's MCP server URL, its
// transport, the tools with read-only badges, and a config to copy for Claude Code, Zed, Cursor and
// Claude Desktop. No tool approves anything: a started claim waits for the person's own yes.
import { useCallback, useEffect, useState } from "react";
import { BookOpen, Bot, Check, Copy, Eye, EyeOff, FileJson, Hand, Info, Lock, MessageSquareText, Play, Terminal } from "lucide-react";
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
      className={`${TAP} shrink-0 px-3 ${copied ? "!border-emerald-400/40 !bg-emerald-500/10 !text-emerald-100" : ""}`}
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
  const shell = client.id === "claude-code";
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/80 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_18px_36px_-26px_rgb(0_0_0/0.9)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.025] py-1.5 pl-3.5 pr-1.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="flex shrink-0 gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          </span>
          {shell ? <Terminal size={13} aria-hidden className="shrink-0 text-accent-300" /> : <FileJson size={13} aria-hidden className="shrink-0 text-accent-300" />}
          <h4 className="min-w-0 truncate text-sm font-semibold text-slate-100">{client.name}</h4>
        </div>
        <CopyButton
          text={real}
          label={`Copy the ${client.name} config`}
          done={live ? `Copied the ${client.name} config. It has your token in it: keep it private.` : `Copied the ${client.name} config. Put in your own Gateway address and token.`}
        />
      </div>
      <p className="px-3.5 pt-3 text-xs leading-relaxed text-slate-400">{client.where}</p>
      <pre className={`m-3 mt-2 max-w-full flex-1 overflow-hidden whitespace-pre-wrap rounded-xl border border-white/[0.05] bg-black/40 p-3.5 font-mono text-[12px] leading-relaxed text-slate-200 ${WRAP}`}>
        <code>
          {shell && (
            <span aria-hidden className="select-none text-accent-300">
              ${" "}
            </span>
          )}
          {visible}
        </code>
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
    <section aria-labelledby="mcp-heading" className="surface relative overflow-hidden rounded-3xl p-5 text-slate-200 lg:p-7">
      <span aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-accent-600/10 blur-3xl" />
      <div className="relative flex items-start gap-4">
        <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-accent-500/30 to-accent-700/10 text-accent-100 ring-1 ring-inset ring-accent-300/25 shadow-[0_12px_30px_-14px_rgb(var(--accent-600)/0.9)]">
          <Bot size={22} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 id="mcp-heading" className="text-xl font-semibold tracking-[-0.01em] text-white">
            Use Tempo from your AI (MCP)
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-300">
            Any AI app that speaks MCP, like Claude Code, Claude Desktop, Zed or Cursor, can ask Tempo to check a message, read a letter, start a claim or see what has been paid back.
          </p>
        </div>
      </div>
      <p className="relative mt-5 flex items-start gap-2.5 rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.09] px-4 py-3 text-[15px] font-bold text-emerald-50">
        <Hand size={17} aria-hidden className="mt-0.5 shrink-0 text-emerald-300" />
        No tool can approve: the person says yes on their own device.
      </p>
      {showcase && (
        <p className="relative mt-3 flex items-start gap-2.5 rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-sm leading-relaxed text-amber-50">
          <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
          <span>
            There&apos;s no Gateway in the showcase, so there is no MCP server to connect to. The configs below show placeholders. Run Tempo locally and this page fills in your server&apos;s address and token.
          </span>
        </p>
      )}
      {error && (
        <div className="relative mt-3">
          <EmptyState title="Couldn't load the MCP details" tone="error" action={<Button variant="quiet" onClick={load} className={TAP}>Try again</Button>}>
            {error}
          </EmptyState>
        </div>
      )}

      <dl className="relative mt-5 grid gap-x-5 gap-y-3 rounded-2xl border border-white/[0.06] bg-black/20 p-4 text-sm sm:grid-cols-[auto_1fr] sm:items-center">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Server address</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          {url ? (
            <>
              <code className={`min-w-0 rounded-lg border border-white/[0.06] bg-ink-900/80 px-2.5 py-1.5 font-mono text-[12px] text-slate-100 ${WRAP}`}>{url}</code>
              <CopyButton text={url} label="Copy the server address" done="Copied the server address." />
            </>
          ) : (
            <Skeleton className="h-6 w-64 max-w-full" />
          )}
        </dd>
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">How it connects</dt>
        <dd className="text-slate-200">{info ? (TRANSPORT_WORDS[info.transport] ?? info.transport) : "Streamable HTTP"}, with the same token as this app</dd>
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Your token</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <code className={`min-w-0 rounded-lg border border-white/[0.06] bg-ink-900/80 px-2.5 py-1.5 font-mono text-[12px] text-slate-100 ${WRAP}`}>{live && !shown ? MASK : token}</code>
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

      <h3 className="relative mt-7 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">What your AI may ask</h3>
      {info === null && !error && (
        <div role="status" aria-label="Loading the MCP tools" className="mt-3 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {info && (
        <div className="relative mt-3 overflow-hidden rounded-2xl border border-white/[0.07]">
          <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
            <caption className="sr-only">The tools Tempo's MCP server offers</caption>
            <colgroup>
              <col className="w-[38%] sm:w-[30%]" />
              <col />
            </colgroup>
            <thead>
              <tr className="bg-white/[0.03] text-[11px] uppercase tracking-[0.12em] text-slate-400">
                <th scope="col" className="border-b border-white/[0.07] px-4 py-2.5 font-semibold">Tool</th>
                <th scope="col" className="border-b border-white/[0.07] py-2.5 pr-4 font-semibold">What it does</th>
              </tr>
            </thead>
            <tbody>
              {info.tools.map((tool, i) => (
                <tr key={tool.name} className={`align-top transition-colors hover:bg-white/[0.02] ${i % 2 ? "bg-white/[0.012]" : ""}`}>
                  <th scope="row" className="border-b border-white/[0.05] px-4 py-3 font-normal">
                    <code className={`block font-mono text-[12px] text-accent-100 ${WRAP}`}>
                      <ToolName name={tool.name} />
                    </code>
                  </th>
                  <td className="break-words border-b border-white/[0.05] py-3 pr-4 leading-relaxed text-slate-300">
                    {tool.description}
                    <span className="mt-1.5 block">
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
        </div>
      )}
      {info && (info.resources.length > 0 || info.prompts.length > 0) && (
        <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
          {info.resources.length > 0 && (
            <div className="min-w-0 rounded-2xl border border-white/[0.06] bg-black/20 p-4">
              <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                <BookOpen size={12} aria-hidden /> Things it can read
              </p>
              <ul className="space-y-2 text-sm">
                {info.resources.map((r) => (
                  <li key={entryName(r)} className="min-w-0">
                    <code className={`font-mono text-[12px] text-accent-100 ${WRAP}`}>{entryName(r)}</code>
                    {entryWords(r) && <span className="block text-xs text-slate-400">{entryWords(r)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {info.prompts.length > 0 && (
            <div className="min-w-0 rounded-2xl border border-white/[0.06] bg-black/20 p-4">
              <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                <MessageSquareText size={12} aria-hidden /> Ready-made prompts
              </p>
              <ul className="space-y-2 text-sm">
                {info.prompts.map((p) => (
                  <li key={entryName(p)} className="min-w-0">
                    <code className={`font-mono text-[12px] text-accent-100 ${WRAP}`}>{entryName(p)}</code>
                    {entryWords(p) && <span className="block text-xs text-slate-400">{entryWords(p)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <h3 className="relative mt-7 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Connect your AI</h3>
      <p className="relative mt-1 text-sm text-slate-400">
        {live ? "Your token is hidden on screen; Copy puts the real one on your clipboard." : "Swap the placeholders for your Gateway's address and token."}
      </p>
      {url ? (
        <ul className="relative mt-3 grid gap-3 lg:grid-cols-2">
          {MCP_CLIENTS.map((client) => (
            <Snippet key={client.id} client={client} url={url} token={token} shown={shown} live={live} />
          ))}
        </ul>
      ) : (
        <Skeleton className="mt-3 h-24 w-full" />
      )}
    </section>
  );
}
