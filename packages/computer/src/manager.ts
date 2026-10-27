import { join, resolve } from "node:path";
import type { AuditLog, ComputerManager } from "@steward/shared";
import { AgentComputer } from "./computer.ts";
import { ComputerError } from "./errors.ts";
import { HostPolicy, type LookupFn } from "./network.ts";

export interface ComputerManagerOptions {
  /** `computers/<agentId>/{profile,workspace}` live under it. */
  dataDir: string;
  /** Show the browser window instead of running headless. */
  headful?: boolean;
  /** Let the agent's browser reach loopback and private networks. Cloud metadata stays refused. */
  allowPrivateHosts?: boolean;
  /** Receives computer.help_requested, computer.control_taken/released and secret.requested/filled. */
  audit?: AuditLog;
  /** Who the record names for the person's actions. `local` in single-user mode. */
  actorId?: string;
  /** DNS resolver for the host checks. Tests inject one; production uses the system resolver. */
  lookup?: LookupFn;
}

/** Agent ids become folder names, so they are held to a safe alphabet. */
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * One computer per agent id, created on first mention and started on first `get`. The manager
 * also serves the live screen (`subscribe`, `handle`) for the server's WebSocket.
 */
export function createComputerManager(opts: ComputerManagerOptions): ComputerManager {
  const root = join(resolve(opts.dataDir), "computers");
  const policy = new HostPolicy({
    allowPrivateHosts: opts.allowPrivateHosts ?? false,
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
  });
  const computers = new Map<string, AgentComputer>();

  const computer = (agentId: string): AgentComputer => {
    if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) {
      throw new ComputerError(
        "bad_input",
        "Agent ids use letters, digits, '-' and '_' only, up to 64 characters.",
      );
    }
    let found = computers.get(agentId);
    if (!found) {
      found = new AgentComputer({
        agentId,
        dir: join(root, agentId),
        headful: opts.headful ?? false,
        policy,
        ...(opts.audit ? { audit: opts.audit } : {}),
        actorId: opts.actorId ?? "local",
      });
      computers.set(agentId, found);
    }
    return found;
  };

  return {
    async get(agentId) {
      const found = computer(agentId);
      await found.start();
      return found;
    },
    status: (agentId) => computer(agentId).status(),
    activity: (agentId, limit) => computer(agentId).activity(limit),
    subscribe: (agentId, listener) => computer(agentId).subscribe(listener),
    handle: async (agentId, msg) => {
      await computer(agentId).handle(msg);
    },
    async reset(agentId) {
      const found = computer(agentId);
      await found.close();
      await found.start();
      return found.status();
    },
    async closeAll() {
      await Promise.all([...computers.values()].map((c) => c.close()));
    },
  };
}
