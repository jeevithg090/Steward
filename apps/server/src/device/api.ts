import { deviceRefusal } from "@steward/gateway";
import {
  type Approval,
  type ApprovalDecider,
  type CatalogueEntry,
  DEVICE_ROUTES,
  DEVICE_SCOPE_LABELS,
  type Device,
  type DeviceApprovalItem,
  type DeviceApprovals,
  type DeviceBrief,
  type DeviceReply,
  type DeviceSayReply,
  type DeviceScope,
  type DeviceUi,
  newId,
  route,
  type ShortcutManifest,
  STEWARD_SHORTCUT,
} from "@steward/shared";
import type { StewardServices } from "../context.ts";
import { HttpError, notFound } from "../http/errors.ts";
import { decideApproval } from "../routes/governance.ts";
import { clip } from "../runtime/run-summary.ts";
import type { PhoneSettings } from "./phone.ts";
import type { DeviceStore } from "./store.ts";

/**
 * The device API's handlers (docs/plans/phone-and-shortcuts.md §3.3), shared by the device listener
 * (Shortcuts) and, later, the relay bridge (the phone app). Each one checks the device's scope,
 * goes through the same stores and the same gateway as the web app, and answers with finished JSON
 * in the fixed `DeviceUi` vocabulary, because a shortcut cannot read a stream.
 */

/** How long `/device/say` waits for the run before answering "still working". */
export const SAY_WAIT_MS = 20_000;
/** A spoken answer longer than this is cut, so Siri does not read a page aloud. */
const SPOKEN_MAX = 600;
const BRIEF_MAX = 300;

/** Markdown read aloud sounds like punctuation. Keep the words. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a phone can call, before the full catalogue (packages/phone) is wired in. */
export type CatalogueSource = (device: Device) => CatalogueEntry[];

export interface DeviceApiDeps {
  s: StewardServices;
  devices: DeviceStore;
  phone: PhoneSettings;
  /** The actions offered on the home menu and through `/device/run/:actionId`. */
  catalogue: CatalogueSource;
}

export class DeviceApi {
  constructor(private readonly deps: DeviceApiDeps) {}

  private get s(): StewardServices {
    return this.deps.s;
  }

  /** Refuses (403, recorded) when the device lacks the scope. */
  need(device: Device, scope: DeviceScope, what?: string): void {
    if (device.scopes.includes(scope)) return;
    this.deps.devices.record("device.refused", device, { scope, ...(what ? { what } : {}) });
    throw new HttpError(
      403,
      `This phone isn't allowed to ${DEVICE_SCOPE_LABELS[scope].label.toLowerCase()}. You can change that in Settings → Phone on your Mac.`,
    );
  }

  decider(device: Device, verified?: "webauthn"): ApprovalDecider {
    return {
      via: `device:${device.id}`,
      device: { id: device.id, name: device.name, kind: device.kind },
      ...(verified ? { verified } : {}),
    };
  }

  manifest(): ShortcutManifest {
    const base = this.deps.phone.url() ?? "";
    return {
      id: STEWARD_SHORTCUT.id,
      version: STEWARD_SHORTCUT.version,
      minVersion: STEWARD_SHORTCUT.minVersion,
      url: `${base}${DEVICE_ROUTES.shortcut}`,
      notes: STEWARD_SHORTCUT.notes,
    };
  }

  /** The main menu: every catalogue action this device's scopes allow. */
  home(device: Device): DeviceReply {
    const entries = this.allowed(device);
    if (entries.length === 0) {
      return {
        ui: [
          { say: "This phone can't do anything yet. Choose what it may do in Settings → Phone on your Mac." },
        ],
      };
    }
    return {
      ui: [
        {
          choose: {
            title: "Steward",
            options: entries.map((e) => ({
              label: e.title,
              post: route(DEVICE_ROUTES.run, { actionId: e.id }),
            })),
          },
        },
      ],
    };
  }

  private allowed(device: Device): CatalogueEntry[] {
    return this.deps
      .catalogue(device)
      .filter((e) => e.scopes.every((scope) => device.scopes.includes(scope)));
  }

  brief(device: Device): DeviceBrief {
    this.need(device, "brief:read");
    const { proactive, gateway } = this.s;
    const brief = proactive.brief.latest();
    const pending = gateway.approvals.list({ status: "pending", limit: 50 });
    const waiting = proactive.tasks.list({ state: "needs_you", limit: 20 });

    const items: string[] = [
      ...pending.map((a) => `Steward asks: ${clip(a.summary, 140)}`),
      ...(brief?.needsYou ?? []).map((t) => `${t.from.name || t.from.email}: ${clip(t.subject, 100)}`),
      ...waiting.map((t) => `Task: ${clip(t.title, 100)}`),
    ];
    const parts = [
      brief ? plainText(brief.summary) : "There's no brief yet today.",
      pending.length > 0
        ? `${plural(pending.length, "request waits", "requests wait")} for your answer.`
        : "",
    ].filter(Boolean);
    const say = clip(parts.join(" "), BRIEF_MAX);
    const ui: DeviceUi[] = [{ say }];
    if (items.length > 0) ui.push({ show: { title: "What needs you", body: items.slice(0, 12).join("\n") } });
    if (pending.length > 0 && device.scopes.includes("approvals:read")) {
      ui.push({
        choose: {
          title: "Answer them now?",
          options: [{ label: "Show what Steward asks", post: DEVICE_ROUTES.approvals }],
        },
      });
    }
    return { say, items, ui };
  }

  /** What this device may answer, and why not when it may not. Refusing is always possible. */
  item(device: Device, approval: Approval): DeviceApprovalItem {
    const base = {
      id: approval.id,
      summary: approval.summary,
      kind: approval.tool.kind,
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
    };
    if (!device.scopes.includes("approvals:decide")) {
      return {
        ...base,
        canDecideHere: false,
        reason: "This phone can refuse, but saying yes from it is switched off in Settings → Phone.",
      };
    }
    const preset = deviceRefusal(approval, "once", this.decider(device));
    return preset
      ? { ...base, canDecideHere: false, reason: preset.phoneMessage }
      : { ...base, canDecideHere: true };
  }

  approvals(device: Device): DeviceApprovals {
    this.need(device, "approvals:read");
    const items = this.s.gateway.approvals
      .list({ status: "pending", limit: 50 })
      .map((a) => this.item(device, a));
    if (items.length === 0) return { items, ui: [{ say: "Nothing needs your answer right now." }] };
    const ui: DeviceUi[] = [
      { say: `${plural(items.length, "thing needs", "things need")} your answer.` },
      {
        choose: {
          title: "Which one?",
          options: items.map((i) => ({
            label: clip(i.summary, 90),
            post: route(DEVICE_ROUTES.approval, { id: i.id }),
          })),
        },
      },
    ];
    return { items, ui };
  }

  /** One request and the answers this phone may give. */
  approval(device: Device, id: string): DeviceReply & { item: DeviceApprovalItem } {
    this.need(device, "approvals:read");
    const approval = this.s.gateway.approvals.get(id);
    if (!approval) throw notFound("that request");
    const item = this.item(device, approval);
    if (approval.status !== "pending") {
      return { item, ui: [{ say: "That one was already answered." }] };
    }
    const post = route(DEVICE_ROUTES.approvalDecide, { id });
    const options = [
      ...(item.canDecideHere ? [{ label: "Allow once", post, body: { answer: "once" } }] : []),
      { label: "Refuse", post, body: { answer: "refuse" } },
    ];
    return {
      item,
      ui: [
        { show: { title: "Steward asks", body: clip(approval.summary, 500) } },
        ...(item.reason ? [{ say: item.reason }] : []),
        { choose: { title: "Your answer", options } },
      ],
    };
  }

  decide(
    device: Device,
    id: string,
    answer: "once" | "refuse",
    note?: string,
    verified?: "webauthn",
  ): DeviceReply & { approval: Approval } {
    // Refusing never acts, so seeing a request is enough to refuse it. Saying yes is its own scope.
    this.need(device, answer === "refuse" ? "approvals:read" : "approvals:decide", "answer");
    const approval = decideApproval(this.s, id, answer, note, this.decider(device, verified));
    const say = answer === "refuse" ? "Refused. Steward won't do it." : "Allowed. Steward will carry on.";
    return { approval, ui: [{ say }] };
  }

  /** Starts a turn in Steward and waits up to 20 s for its answer. */
  async say(
    device: Device,
    body: { text: string; skill?: string; threadId?: string },
  ): Promise<DeviceSayReply> {
    this.need(device, "chat");
    const { s } = this;
    let threadId = body.threadId;
    if (threadId && !s.threads.exists(threadId)) throw notFound("that conversation");
    const agentId = (threadId && s.threads.getMeta(threadId)?.agentId) || s.defaultAgentId;
    if (!threadId) {
      threadId = newId("thr");
      s.threads.upsertMeta({ id: threadId, agentId, kind: "chat", title: clip(body.text, 80) });
    }
    const userText = body.skill ? `/${body.skill} ${body.text}` : body.text;
    const run = s.runs.start({ agentId, threadId, userText, initiator: { kind: "device", id: device.id } });

    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      run.done,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), SAY_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);

    if (!result) {
      return {
        threadId,
        pending: true,
        ui: [
          {
            say: "Steward is still working on it. The answer will be in Steward on your Mac when it's done.",
          },
        ],
      };
    }
    if (result.outcome === "interrupt") {
      const meta = result.interrupts[0]?.metadata as { approvalId?: string } | undefined;
      const approval = meta?.approvalId ? s.gateway.approvals.get(meta.approvalId) : undefined;
      if (approval && device.scopes.includes("approvals:read")) {
        const view = this.approval(device, approval.id);
        return { threadId, say: `Steward needs your answer first: ${approval.summary}`, ui: view.ui };
      }
      return {
        threadId,
        say: "Steward needs your answer first.",
        ui: [{ say: "Steward needs your answer before it can carry on. Answer it in Steward on your Mac." }],
      };
    }
    if (result.outcome === "error") {
      return {
        threadId,
        say: "That didn't work.",
        ui: [{ say: `That didn't work: ${clip(result.error ?? "", 200)}` }],
      };
    }
    const text = plainText(result.text) || "Done.";
    return { threadId, say: clip(text, 2000), ui: [{ say: clip(text, SPOKEN_MAX) }] };
  }

  /** Runs one catalogue action. Actions that need words ask for them first. */
  async run(device: Device, actionId: string, text?: string): Promise<DeviceReply> {
    const entry = this.deps.catalogue(device).find((e) => e.id === actionId);
    if (!entry) throw notFound("that action");
    for (const scope of entry.scopes) this.need(device, scope, actionId);
    const self = route(DEVICE_ROUTES.run, { actionId });
    const words = text?.trim();
    switch (entry.action.kind) {
      case "brief":
        return this.brief(device);
      case "approvals":
        return this.approvals(device);
      case "say":
      case "check":
        if (!words)
          return {
            ui: [
              {
                ask: {
                  prompt:
                    entry.action.kind === "check"
                      ? "What should Steward check?"
                      : "What would you like Steward to do?",
                  post: self,
                  field: "text",
                },
              },
            ],
          };
        return this.say(device, {
          text:
            entry.action.kind === "check"
              ? `Check this for me. Is it genuine, and does it need me?\n\n${words}`
              : words,
        });
      case "skill":
        if (!words)
          return {
            ui: [{ ask: { prompt: `${entry.title}: what should it work on?`, post: self, field: "text" } }],
          };
        return this.say(device, { text: words, ...(entry.action.ref ? { skill: entry.action.ref } : {}) });
      case "routine": {
        const routine = entry.action.ref ? this.s.proactive.routines.get(entry.action.ref) : undefined;
        if (!routine) throw notFound("that routine");
        if (!routine.enabled)
          return { ui: [{ say: `${routine.title} is paused. Turn it on in Steward first.` }] };
        this.s.workers.runRoutine(routine);
        return { ui: [{ say: `Started ${routine.title}. Steward will tell you when it's done.` }] };
      }
      default:
        return this.runOther(device, entry, words);
    }
  }

  /** Bot and tenant actions carry a prompt of their own (packages/phone fills these in). */
  private runOther(
    device: Device,
    entry: CatalogueEntry,
    words: string | undefined,
  ): Promise<DeviceReply> | DeviceReply {
    const { prompt } = entry;
    if (!prompt) return { ui: [{ say: "That action isn't available from a phone yet." }] };
    if (!words && prompt.includes("{input}")) {
      return {
        ui: [
          {
            ask: {
              prompt: entry.description || entry.title,
              post: route(DEVICE_ROUTES.run, { actionId: entry.id }),
              field: "text",
            },
          },
        ],
      };
    }
    return this.say(device, { text: prompt.replace("{input}", words ?? "") });
  }
}

/** The actions every phone has, filtered later by its scopes (docs/plans/phone-and-shortcuts.md §4.3). */
export function coreCatalogue(s: StewardServices): CatalogueEntry[] {
  const entries: CatalogueEntry[] = [
    {
      id: "ask",
      title: "Ask Steward",
      description: "Say or type what you need; Steward answers here.",
      siriPhrase: "Steward",
      action: { kind: "say" },
      scopes: ["chat"],
      source: "core",
    },
    {
      id: "brief",
      title: "What needs me?",
      description: "Today's brief, read aloud.",
      siriPhrase: "Steward: What needs me?",
      action: { kind: "brief" },
      scopes: ["brief:read"],
      source: "core",
    },
    {
      id: "approvals",
      title: "Needs you",
      description: "What Steward is waiting for you to answer.",
      siriPhrase: "Steward: Needs you",
      action: { kind: "approvals" },
      scopes: ["approvals:read"],
      source: "core",
    },
  ];
  for (const skill of s.proactive.skills.list()) {
    entries.push({
      id: `skill:${skill.name}`,
      title: skill.name,
      description: skill.description,
      siriPhrase: `Steward: ${skill.name}`,
      action: { kind: "skill", ref: skill.name },
      scopes: ["chat"],
      source: "skill",
    });
  }
  for (const routine of s.proactive.routines.list()) {
    entries.push({
      id: `routine:${routine.id}`,
      title: routine.title,
      description: "Run this routine now.",
      siriPhrase: `Steward: ${routine.title}`,
      action: { kind: "routine", ref: routine.id },
      scopes: ["routines:run"],
      source: "routine",
    });
  }
  return entries;
}
