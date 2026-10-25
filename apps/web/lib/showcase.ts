// Showcase mode (SHIPPING.md §4.6): Mission Control and every other page run with no Gateway,
// on responses recorded from a real replay-mode Gateway (showcase/*.json, see showcase/README.md).
// Margaret's missions walk through their recorded states in memory as the buttons are pressed,
// so everything on screen is something the Gateway really said; nothing is invented here.
import {
  Gateway,
  type CardReading,
  type Health,
  type LedgerTotals,
  type MemoryCardData,
  type MemoryItem,
  type MissionView,
  type PrivacyProofData,
  type VoiceProfileView,
} from "./api";
import { type Authenticator, type DeviceInfo, MeshClient, type Storage } from "./mesh";
import type { LetterReading, LettersFixture, ReadLetterRequest, ReplyDraft, ReplyRequest, SampleLetter } from "./letters";
import { draftReplyLocally } from "./letters";
import { type Catalog, type ProfileView, ProfileInvalid, type SkillManifest, decodeShareCode, encodeShareCode, toProfile, toView } from "./profiles";
import type { CatalogSource } from "./catalog-client";

import healthJson from "@/showcase/health.json";
import ledgerJson from "@/showcase/ledger.json";
import amirVerified from "@/showcase/mission-amir-verified.json";
import railAwaiting from "@/showcase/mission-rail-awaiting_consent.json";
import railWaiting from "@/showcase/mission-rail-waiting.json";
import railVerified from "@/showcase/mission-rail-verified.json";
import ofcomAwaiting from "@/showcase/mission-ofcom-awaiting_consent.json";
import ofcomWaiting from "@/showcase/mission-ofcom-waiting.json";
import ofcomActing from "@/showcase/mission-ofcom-waiting-acting.json";
import ofcomVerified from "@/showcase/mission-ofcom-verified.json";
import ofcomPaidOnItsOwn from "@/showcase/mission-ofcom2-verified.json";
import readCardJson from "@/showcase/read-card.json";
import memoriesJson from "@/showcase/memories-u_margaret.json";
import privacyJson from "@/showcase/privacy-u_margaret.json";
import voiceDilip from "@/showcase/voice-profile-u_dilip.json";
import voiceJoan from "@/showcase/voice-profile-u_joan.json";
import voiceMargaret from "@/showcase/voice-profile-u_margaret.json";
import catalogJson from "@/showcase/catalog.json";
import lettersJson from "@/showcase/letters.json";

export const SHOWCASE_LABEL = "SHOWCASE · recorded replay · no Gateway";
export const NO_GATEWAY = "There is no Gateway in the showcase: this page runs on recorded replies.";
const NO_MESH = "There's no Gateway in the showcase, so devices can't be paired or sign. Run Tempo locally to try the Mesh.";

/** Showcase is on for the whole build when NEXT_PUBLIC_TEMPO_SHOWCASE=1. */
export function isShowcaseEnv(): boolean {
  return process.env.NEXT_PUBLIC_TEMPO_SHOWCASE === "1";
}

/** Showcase is on for one page when its URL carries `?showcase=1`. */
export function isShowcaseQuery(search: string | null | undefined): boolean {
  if (!search) return false;
  return new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("showcase") === "1";
}

const view = (json: unknown): MissionView => structuredClone(json) as MissionView;

const RAIL = { awaiting_consent: railAwaiting, waiting: railWaiting, verified: railVerified };
const OFCOM = { awaiting_consent: ofcomAwaiting, waiting: ofcomWaiting, acting: ofcomActing, verified: ofcomVerified, paid_on_its_own: ofcomPaidOnItsOwn };

type Kind = "rail" | "ofcom" | "recorded";

interface Walk {
  kind: Kind;
  view: MissionView;
  credited: boolean;
}

const failingFetch: typeof fetch = async () => {
  throw new Error(NO_GATEWAY);
};

function nowIso(): string {
  return new Date().toISOString().replace("Z", "+00:00");
}

function pence(amount: string): number {
  return Math.round(Number(amount) * 100);
}

/**
 * A Gateway that never leaves the browser. `start`, `answer`, `tick`, `startOfcom`,
 * `advanceClock`, `creditArrives`, `readCard` and `stop` move the recorded missions exactly as
 * the real Gateway moved them when the fixtures were taken.
 */
export class ShowcaseGateway extends Gateway {
  private walks: Walk[];
  private serial = 0;
  private clockOffsetDays = 0;
  private totals: LedgerTotals;
  private memory: MemoryCardData;

  constructor() {
    super({ url: "showcase://no-gateway", token: "" }, failingFetch);
    // As `make seed` leaves the demo: Amir paid, Margaret's claim and her broadband case waiting for her OK.
    this.walks = [
      { kind: "ofcom", view: view(OFCOM.awaiting_consent), credited: false },
      { kind: "rail", view: view(RAIL.awaiting_consent), credited: false },
      { kind: "recorded", view: view(amirVerified), credited: false },
    ];
    this.totals = { ...ledgerJson };
    this.memory = structuredClone(memoriesJson) as MemoryCardData;
  }

  override eventsUrl(): string {
    return "";
  }

  override health = async (): Promise<Health> => ({
    ...(healthJson as Health),
    clock_offset_days: this.clockOffsetDays,
  });

  override missions = async (): Promise<MissionView[]> => this.walks.map((w) => structuredClone(w.view));

  override mission = async (id: string): Promise<MissionView> => structuredClone(this.find(id).view);

  override ledger = async (): Promise<LedgerTotals> => ({ ...this.totals });

  override start = async (body: Record<string, string>): Promise<MissionView> => {
    const fresh = this.fresh(RAIL.awaiting_consent, "rail");
    if (body.travel_date !== "2026-10-23" || body.departure !== "08:12") {
      // The recording only holds Margaret's 08:12. Say so the way the Gateway declines.
      const now = nowIso();
      Object.assign(fresh.view, {
        state: "declined",
        message: "I couldn't find that train in the rail records (the showcase only has Margaret's 08:12 Oxford to Paddington recorded).",
        ask: null,
        court: null,
        timeline: [{ to: "understood", at: now, latency_ms: 0 }, { to: "declined", at: now, latency_ms: 0 }],
      });
    }
    return structuredClone(fresh.view);
  };

  override startOfcom = async (_body: Record<string, string>): Promise<MissionView> => structuredClone(this.fresh(OFCOM.awaiting_consent, "ofcom").view);

  override readCard = async (_body: Record<string, string>): Promise<CardReading> => structuredClone(readCardJson) as CardReading;

  override answer = async (requestId: string, approved: boolean): Promise<MissionView> => {
    const walk = this.walks.find((w) => w.view.ask?.request_id === requestId);
    if (!walk) throw new Error("POST /approvals: HTTP 404 (nothing is waiting for this answer)");
    if (!approved) {
      this.decline(walk, "Stopped: you said no. Nothing was sent.");
    } else {
      this.move(walk, walk.kind === "rail" ? RAIL.waiting : OFCOM.waiting);
    }
    return structuredClone(walk.view);
  };

  override stop = async (id: string): Promise<MissionView> => {
    const walk = this.find(id);
    if (walk.view.state === "awaiting_consent") this.decline(walk, "Stopped: you said no. Nothing was sent.");
    else if (walk.view.state === "waiting" || walk.view.state === "checkpoint") {
      walk.view = {
        ...walk.view,
        state: "failed_safe",
        message: null, // as the Gateway returns it (doc.md §8.3)
        ask: null,
        outcome: null,
        timeline: [...walk.view.timeline, { to: "failed_safe", at: nowIso(), latency_ms: 0 }],
      };
    }
    return structuredClone(walk.view);
  };

  /** "Check the payment now": fires every timer that is due, as the scheduler would. */
  override tick = async (): Promise<{ fired: string[] }> => {
    const fired: string[] = [];
    for (const walk of this.walks) {
      if (walk.view.state !== "waiting") continue;
      if (walk.kind === "rail") {
        this.move(walk, RAIL.verified);
        fired.push(walk.view.id);
      } else if (walk.kind === "ofcom" && walk.view.plan?.action_today !== "wait") {
        this.move(walk, OFCOM.verified);
        fired.push(walk.view.id);
      }
      // An Ofcom case that is waiting on purpose has its timer on the next decision date (19 Nov).
    }
    return { fired };
  };

  /** The demo clock, forward only: the waiting broadband case wakes up and acts, or finds it was paid. */
  override advanceClock = async (days: number): Promise<{ now: string; offset_days: number; fired: string[] }> => {
    this.clockOffsetDays += Math.max(0, Math.floor(days));
    const fired: string[] = [];
    for (const walk of this.walks) {
      if (walk.kind !== "ofcom" || walk.view.state !== "waiting" || walk.view.plan?.action_today !== "wait") continue;
      this.move(walk, walk.credited ? OFCOM.paid_on_its_own : OFCOM.acting);
      fired.push(walk.view.id);
    }
    const now = new Date(Date.now() + this.clockOffsetDays * 86_400_000).toISOString().replace("Z", "+00:00");
    return { now, offset_days: this.clockOffsetDays, fired };
  };

  override creditArrives = async (id: string): Promise<{ credited: boolean }> => {
    this.find(id).credited = true;
    return { credited: true };
  };

  override revokeMandate = async (_id: string): Promise<{ status: string }> => {
    throw new Error("No mandate was signed in the showcase: a mandate needs a passkey and a Gateway.");
  };

  override privacy = async (_userId: string): Promise<PrivacyProofData> => structuredClone(privacyJson) as PrivacyProofData;

  override memories = async (userId: string): Promise<MemoryCardData> =>
    userId === "u_margaret" ? structuredClone(this.memory) : { memories: {}, timeline: [] };

  override voiceProfile = async (userId: string): Promise<VoiceProfileView> => {
    const recorded = { u_dilip: voiceDilip, u_joan: voiceJoan, u_margaret: voiceMargaret }[userId];
    if (!recorded) throw new Error(`GET /voice/profile?user_id=${userId}: HTTP 404`);
    return structuredClone(recorded) as VoiceProfileView;
  };

  override forgetMemory = async (_userId: string, id: string): Promise<{ forgotten: boolean }> => {
    let forgotten = false;
    for (const [category, entries] of Object.entries(this.memory.memories)) {
      const kept = entries.filter((e) => e.item.id !== id);
      forgotten ||= kept.length !== entries.length;
      if (kept.length) this.memory.memories[category] = kept;
      else delete this.memory.memories[category];
    }
    return { forgotten };
  };

  override forgetEpisode = async (_userId: string, episodeId: string): Promise<{ forgotten: boolean }> => {
    const before = this.memory.timeline.length;
    this.memory.timeline = this.memory.timeline.filter((f) => f.episode_id !== episodeId);
    return { forgotten: this.memory.timeline.length !== before };
  };

  override correctMemory = async (_userId: string, id: string, text: string): Promise<MemoryItem> => {
    for (const entries of Object.values(this.memory.memories)) {
      const entry = entries.find((e) => e.item.id === id);
      if (!entry) continue;
      const corrected: MemoryItem = {
        ...entry.item,
        id: `${id.slice(0, 8)}${(++this.serial).toString(16).padStart(24, "0")}`,
        text,
        source: "user_web",
        observed_at: nowIso(),
        confidence: 1,
        superseded_by: null,
      };
      entry.earlier = [{ ...entry.item, superseded_by: corrected.id }, ...entry.earlier];
      entry.item = corrected;
      return { ...corrected };
    }
    throw new Error(`POST /memories/${id}/correct: HTTP 404`);
  };

  // --- the walk -------------------------------------------------------------------------

  private find(id: string): Walk {
    const walk = this.walks.find((w) => w.view.id === id);
    if (!walk) throw new Error(`GET /missions/${id}: HTTP 404`);
    return walk;
  }

  /** A new mission from a recorded one, with its own id (newest first, as GET /missions lists them). */
  private fresh(recorded: unknown, kind: Kind): Walk {
    const next = view(recorded);
    const id = `m_${(0x5c0000000000 + ++this.serial).toString(16).padStart(12, "0")}`;
    const walk: Walk = { kind, view: this.reid(next, id), credited: false };
    this.walks.unshift(walk);
    return walk;
  }

  /** Move a mission to its next recorded state, keeping its own id and request ids. */
  private move(walk: Walk, recorded: unknown): void {
    const was = walk.view;
    walk.view = this.reid(view(recorded), was.id);
    if (walk.view.state === "verified" && was.state !== "verified") this.count(walk.view);
  }

  private reid(next: MissionView, id: string): MissionView {
    next.id = id;
    if (next.ask) {
      next.ask.request_id = `${id}-ask`;
      if (next.ask.proof_trace) next.ask.proof_trace.id = `pt_${id}`;
    }
    return next;
  }

  private decline(walk: Walk, message: string): void {
    walk.view = {
      ...walk.view,
      state: "declined",
      message,
      ask: null,
      outcome: { state: "declined", message, amount_gbp: null, reference: null },
      timeline: [...walk.view.timeline, { to: "declined", at: nowIso(), latency_ms: 0 }],
    };
  }

  /** The Time Ledger: pounds once the money has arrived, minutes as the Gateway counted them. */
  private count(verified: MissionView): void {
    const minutes = Number(/(\d+) minutes of your time back/.exec(verified.message ?? "")?.[1] ?? "0");
    const totalMinutes = Number(this.totals.minutes_returned) + minutes;
    const totalPence = pence(this.totals.gbp_recovered) + pence(verified.outcome?.amount_gbp ?? "0");
    this.totals = {
      minutes_returned: String(totalMinutes),
      hours_returned: (totalMinutes / 60).toFixed(1),
      gbp_recovered: (totalPence / 100).toFixed(2),
    };
  }
}

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = (key: string, value: string) => void this.data.set(key, value);
  removeItem = (key: string) => void this.data.delete(key);
}

const noAuthenticator: Authenticator = { create: async () => null, get: async () => null };

const refuse = async (): Promise<never> => {
  throw new Error(NO_MESH);
};

/** The Mesh with no Gateway: no devices, nothing to sign, nothing fetched. */
export class ShowcaseMesh extends MeshClient {
  constructor() {
    super({ url: "showcase://no-gateway", token: "" }, new MemoryStorage(), noAuthenticator, failingFetch);
  }

  override get token(): string | null {
    return null;
  }

  override get deviceId(): string | null {
    return null;
  }

  override registerThisDevice = (_userId: string, _name: string): Promise<DeviceInfo> => refuse();
  override devices = async (): Promise<DeviceInfo[]> => [];
  override remove = (_id: string): Promise<{ removed: boolean }> => refuse();
  override addPasskey = (): Promise<DeviceInfo> => refuse();
  override answer = (_requestId: string, _approved: boolean): Promise<MissionView> => refuse();
  override issueMandate = (_missionId: string): Promise<Record<string, unknown>> => refuse();
  override startPairing = (): Promise<{ pairing_id: string; link: string; qr_svg: string; expires_at: string }> => refuse();
  override pairingStatus = (_id: string): Promise<{ claimed: boolean; code: string | null; device_name: string | null }> => refuse();
  override confirmPairing = (_id: string): Promise<DeviceInfo> => refuse();
  override claim = (_link: string, _name: string): Promise<string> => refuse();
  override enablePush = async (): Promise<boolean> => false;
}

/** The catalogue and the sample letters, from the committed JSON. */
export class ShowcaseCatalog implements CatalogSource {
  readonly showcase = true;
  private readonly catalog = catalogJson as unknown as Catalog;
  private readonly letters = lettersJson as unknown as LettersFixture;

  skills = async (): Promise<SkillManifest[]> => this.catalog.skills;
  profiles = async (): Promise<ProfileView[]> => this.catalog.profiles.filter((p) => p.share.public);
  profile = async (id: string): Promise<ProfileView> => {
    const found = this.catalog.profiles.find((p) => p.id === id);
    if (!found) throw new Error(`There's no profile called "${id}".`);
    return found;
  };
  share = async (id: string, origin: string): Promise<{ code: string; url: string }> => {
    const code = encodeShareCode(toProfile(await this.profile(id)));
    return { code, url: `${origin}/profiles/import#p=${code}` };
  };
  /** Decodes and checks in the browser only: a Gateway has not seen it. */
  importProfile = async (code: string): Promise<ProfileView> => toView(decodeShareCode(code, this.catalog.skills), this.catalog.skills);
  sampleLetters = async (): Promise<SampleLetter[]> => this.letters.letters;
  readLetter = async (_body: ReadLetterRequest): Promise<LetterReading> => {
    throw new ProfileInvalid("The showcase can't read a new letter: that needs a Gateway. Pick one of the recorded letters instead.");
  };
  reply = async (body: ReplyRequest): Promise<ReplyDraft> => draftReplyLocally(body.reading, body.said, body.display_name);
}
