import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BotPackError, type PackProblem, parseBotFolder, validatePack, writeBotFolder } from "@steward/bots";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { type BotAuthor, type BotPack, TOOLS } from "@steward/shared";
import type { Catalogue } from "./catalogue.ts";
import { type FetchedPack, GitHubError, type PackSource, parsePackUrl } from "./github.ts";
import type { DirectoryStore, Submission, Submitter } from "./store.ts";

/**
 * Submissions and claims (plan §3.2). A person points at a public repository folder or gist; the
 * server reads the pack, checks it exactly as the directory build does (tools from the catalogue,
 * rules through the gateway's own engine, the injection and personal-data scans) and keeps it as
 * pending. A reviewer approves it from `/admin`, which writes the folder into `bots/`, rebuilds the
 * index and reloads. A pack that fails the checks is refused with the reasons and never stored.
 */
export class SubmissionError extends Error {
  override name = "SubmissionError";
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 422 | 502 | 503 = 400,
    readonly problems: PackProblem[] = [],
  ) {
    super(message);
  }
}

export interface PackReader {
  fetchPack(source: PackSource): Promise<FetchedPack>;
}

export interface SubmissionsOptions {
  store: DirectoryStore;
  catalogue: Catalogue;
  github: PackReader;
  now?: () => Date;
}

export interface SubmitInput {
  url: string;
  confirmItsMine: boolean;
  submitter: Submitter;
}

export interface ClaimInput {
  botId: string;
  confirmItsMine: boolean;
  submitter: Submitter;
}

export interface CheckedPack {
  pack: BotPack;
  warnings: PackProblem[];
  fetched: FetchedPack;
}

export type PendingSubmission = Submission & { blocked?: string };

export const CONFIRM_FIRST =
  "Confirm the pack is yours, or that you may share it under MIT, before submitting it.";

const profileUrl = (login: string) => `https://github.com/${encodeURIComponent(login)}`;

export class Submissions {
  private readonly engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);

  constructor(private readonly opts: SubmissionsOptions) {}

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** Reads and checks a pack at a GitHub address. Nothing is stored. */
  async check(url: string): Promise<CheckedPack> {
    const source = parsePackUrl(url);
    const fetched = await this.opts.github.fetchPack(source);
    // The paths were built by the GitHub client from checked names, so none can leave the folder.
    const dir = await mkdtemp(join(tmpdir(), "steward-submission-"));
    try {
      for (const [path, text] of fetched.files) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), text, "utf8");
      }
      let parsed: BotPack;
      try {
        parsed = await parseBotFolder(dir);
      } catch (error) {
        const message = error instanceof BotPackError ? error.message : (error as Error).message;
        throw new SubmissionError(`The pack could not be read: ${message}`, 422, [
          { path: "pack", message, severity: "error" },
        ]);
      }
      const result = validatePack(parsed, {
        tools: Object.keys(TOOLS),
        validateRule: (when) => this.engine.validate(when),
      });
      const errors = result.problems.filter((p) => p.severity === "error");
      if (!result.ok || !result.pack) {
        throw new SubmissionError(
          `The pack was refused: ${errors.map((p) => `${p.path}: ${p.message}`).join("; ")}`,
          422,
          errors,
        );
      }
      return { pack: result.pack, warnings: result.problems.filter((p) => p.severity === "warn"), fetched };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Whether the submitter owns a listing now. Once a submission for it was approved, only that
   * person's GitHub id counts: a handle can be renamed and then registered by someone else. A
   * listing nobody has had approved here (a seed) can only be matched by handle, and the reviewer
   * is told so.
   */
  private ownership(botId: string, existing: BotPack, submitter: Submitter): "id" | "handle" | undefined {
    const owner = this.opts.store.approvedFor(botId);
    if (owner?.submitter.githubId !== undefined) {
      return submitter.githubId !== undefined && owner.submitter.githubId === submitter.githubId
        ? "id"
        : undefined;
    }
    const handle =
      owner?.submitter.login ?? (existing.author.kind === "person" ? existing.author.handle : "");
    return submitter.verified && handle !== "" && handle.toLowerCase() === submitter.login.toLowerCase()
      ? "handle"
      : undefined;
  }

  /** Who a listing belongs to now, for a refusal: the approved owner, or the credited author. */
  private ownerName(botId: string, existing: BotPack): string | undefined {
    const owner = this.opts.store.approvedFor(botId)?.submitter.login;
    return owner ?? (existing.author.kind === "person" ? existing.author.handle : undefined);
  }

  /**
   * The reviewer's warning for a claim of a listing another GitHub account had approved here, or
   * undefined. A handle that matches may be the owner's old one, renamed and registered again.
   */
  private ownedElsewhere(botId: string, submitter: Submitter): PackProblem | undefined {
    const owner = this.opts.store.approvedFor(botId)?.submitter;
    if (owner?.githubId === undefined || owner.githubId === submitter.githubId) return undefined;
    return {
      path: "submitter",
      message: `It belongs to another GitHub account (approved here as @${owner.login}). The same handle does not mean the same person. Approving gives the listing to @${submitter.login}.`,
      severity: "warn",
    };
  }

  /**
   * Why a pending submission can no longer be approved, or undefined when it still can. The checks
   * made at submit time held for the listing as it was then; if another approval moved it on since
   * (a competing claim, a new owner), only its current owner may still change it.
   */
  stale(submission: Submission): string | undefined {
    const previous = this.opts.catalogue.pack(submission.botId);
    if (!previous) return undefined;
    if (submission.baseVersion !== undefined && previous.version === submission.baseVersion) return undefined;
    // Made before the base was kept: a claim was the reviewer's call then, and still is.
    if (submission.baseVersion === undefined && submission.kind === "claim") return undefined;
    if (this.ownership(submission.botId, previous, submission.submitter)) return undefined;
    const owner = this.ownerName(submission.botId, previous);
    return owner
      ? `The id "${submission.botId}" now belongs to @${owner}. Ask the submitter to pick another id.`
      : `"${submission.botId}" changed since this was submitted. Ask the submitter to send it again.`;
  }

  /** New listing, update of the submitter's own, or a claim of an AI-made one. Anything else is refused. */
  private kindFor(pack: BotPack, submitter: Submitter): Submission["kind"] {
    const existing = this.opts.catalogue.pack(pack.id);
    if (!existing) return "new";
    const next = existing.version + 1;
    if (existing.author.kind === "ai") {
      if (pack.version <= existing.version) {
        throw new SubmissionError(
          `"${pack.id}" is an AI-made bot at version ${existing.version}. To claim and improve it, set version: ${next} in bot.yaml.`,
          409,
        );
      }
      return "claim";
    }
    if (!this.ownership(pack.id, existing, submitter)) {
      throw new SubmissionError(
        `The id "${pack.id}" is taken by a bot made by @${existing.author.handle}. Pick another id, or claim that listing if it is yours.`,
        409,
      );
    }
    if (pack.version <= existing.version) {
      throw new SubmissionError(
        `${existing.name} is already at version ${existing.version}. Set version: ${next} in bot.yaml.`,
        409,
      );
    }
    return "update";
  }

  /** The author a claimed listing gets: the claimer, with the AI-made draft remembered. */
  private claimedAuthor(existing: BotPack, submitter: Submitter, submitted?: BotPack): BotAuthor {
    const basedOnAi = existing.author.kind === "ai" || existing.author.basedOnAi === true;
    const url =
      submitted?.author.kind === "person" &&
      submitted.author.handle.toLowerCase() === submitter.login.toLowerCase()
        ? (submitted.author.url ?? profileUrl(submitter.login))
        : profileUrl(submitter.login);
    return { kind: "person", handle: submitter.login, url, ...(basedOnAi ? { basedOnAi: true } : {}) };
  }

  async submit(input: SubmitInput): Promise<Submission> {
    if (!input.confirmItsMine) throw new SubmissionError(CONFIRM_FIRST, 400);
    const login = input.submitter.login.replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) {
      throw new SubmissionError("Give a GitHub handle: letters, digits and hyphens.", 400);
    }
    const submitter: Submitter = { ...input.submitter, login };
    const { pack, warnings, fetched } = await this.check(input.url);
    const kind = this.kindFor(pack, submitter);
    const ownerMatches = fetched.owner !== "" && fetched.owner.toLowerCase() === login.toLowerCase();
    const notes: PackProblem[] = [...warnings];
    if (!ownerMatches) {
      notes.push({
        path: "source",
        message: `The address belongs to ${fetched.owner ? `@${fetched.owner}` : "another account"}, not to @${login}.`,
        severity: "warn",
      });
    }
    if (pack.author.kind === "person" && pack.author.handle.toLowerCase() !== login.toLowerCase()) {
      notes.push({
        path: "author.handle",
        message: `bot.yaml names @${pack.author.handle} as the author; the submission comes from @${login}.`,
        severity: "warn",
      });
    }
    if (!submitter.verified) {
      notes.push({
        path: "submitter",
        message: "Submitted without signing in (through MCP). The handle is not verified.",
        severity: "warn",
      });
    }
    const existing = this.opts.catalogue.pack(pack.id);
    const elsewhere = kind === "claim" ? this.ownedElsewhere(pack.id, submitter) : undefined;
    if (elsewhere) notes.push(elsewhere);
    if (kind === "update" && existing && this.ownership(pack.id, existing, submitter) === "handle") {
      notes.push({
        path: "submitter",
        message: `Matched to this listing by GitHub handle only: nobody has had it approved here yet. Check @${login} made it.`,
        severity: "warn",
      });
    }
    const { hash: _hash, ...withoutHash } = pack;
    const stored: BotPack =
      kind === "claim" && existing
        ? { ...withoutHash, author: this.claimedAuthor(existing, submitter, pack) }
        : withoutHash;
    return this.opts.store.addSubmission({
      botId: pack.id,
      kind,
      pack: stored,
      sourceUrl: fetched.source.url,
      submitter,
      ownerMatches,
      baseVersion: existing?.version ?? 0,
      warnings: notes,
      createdAt: this.now().toISOString(),
    });
  }

  /** Claims an existing listing as the signed-in person's, without a new pack. */
  async claim(input: ClaimInput): Promise<Submission> {
    if (!input.confirmItsMine)
      throw new SubmissionError("Confirm this bot is yours before claiming it.", 400);
    if (!input.submitter.verified || input.submitter.githubId === undefined) {
      throw new SubmissionError("Sign in with GitHub to claim a bot.", 403);
    }
    const existing = this.opts.catalogue.pack(input.botId);
    if (!existing) throw new SubmissionError(`There is no bot "${input.botId}" in the directory.`, 404);
    const already = this.opts.store
      .submissions({ botId: input.botId, status: "pending" })
      .find((s) => s.kind === "claim" && s.submitter.githubId === input.submitter.githubId);
    if (already) throw new SubmissionError("You already claimed this bot; a reviewer will look at it.", 409);
    const owner = this.opts.store.approvedFor(input.botId);
    if (owner?.submitter.githubId === input.submitter.githubId) {
      throw new SubmissionError("This bot is already yours.", 409);
    }
    const notes: PackProblem[] = [];
    const elsewhere = this.ownedElsewhere(input.botId, input.submitter);
    if (elsewhere) {
      notes.push(elsewhere);
    } else if (
      existing.author.kind === "person" &&
      existing.author.handle.toLowerCase() !== input.submitter.login.toLowerCase()
    ) {
      notes.push({
        path: "author.handle",
        message: `The listing credits @${existing.author.handle}; the claim comes from @${input.submitter.login}.`,
        severity: "warn",
      });
    }
    const { hash: _hash, ...withoutHash } = existing;
    const pack: BotPack = {
      ...withoutHash,
      version: existing.version + 1,
      author: this.claimedAuthor(existing, input.submitter),
    };
    return this.opts.store.addSubmission({
      botId: input.botId,
      kind: "claim",
      pack,
      sourceUrl: profileUrl(input.submitter.login),
      submitter: input.submitter,
      ownerMatches: true,
      baseVersion: existing.version,
      warnings: notes,
      createdAt: this.now().toISOString(),
    });
  }

  /** What waits for a reviewer, each with the reason it cannot be approved now, if there is one. */
  pending(): PendingSubmission[] {
    return this.opts.store.submissions({ status: "pending" }).map((s) => {
      const blocked = this.blocked(s);
      return blocked ? { ...s, blocked } : s;
    });
  }

  /**
   * Why a reviewer cannot approve a pending submission now, or undefined. A claim sent through MCP
   * under someone's handle waits until that person signs in and confirms it, and one whose listing
   * has moved on to another owner since is refused (see `stale`).
   */
  blocked(submission: Submission): string | undefined {
    if (submission.kind !== "new" && !submission.submitter.verified) {
      return `@${submission.submitter.login} has not confirmed this is theirs yet. They sign in on /submit to confirm it.`;
    }
    return this.stale(submission);
  }

  /** Submissions sent through MCP under this person's handle, waiting for them to say yes or no. */
  unconfirmed(user: { login: string }): Submission[] {
    return this.opts.store.unconfirmedFor(user.login);
  }

  private unconfirmedOne(id: string, user: { login: string }): Submission {
    const submission = this.opts.store.submission(id);
    if (submission?.status !== "pending" || submission.submitter.verified) {
      throw new SubmissionError("That submission is not waiting for you to confirm it.", 404);
    }
    if (submission.submitter.login.toLowerCase() !== user.login.toLowerCase()) {
      throw new SubmissionError("That submission names someone else.", 403);
    }
    return submission;
  }

  /** "This is mine": the signed-in person the submission names takes it as theirs. */
  confirm(id: string, user: { githubId: number; login: string }): Submission {
    const submission = this.unconfirmedOne(id, user);
    const warnings = [
      ...submission.warnings.filter((w) => w.path !== "submitter"),
      {
        path: "submitter",
        message: `Sent through MCP; @${user.login} signed in and confirmed it is theirs.`,
        severity: "warn" as const,
      },
    ];
    return this.opts.store.confirmSubmission(id, user.githubId, warnings) ?? submission;
  }

  /** "Not mine": the person it names says they did not send it, so it is rejected. */
  disown(id: string, user: { githubId: number; login: string }): Submission {
    const submission = this.unconfirmedOne(id, user);
    const note = `@${user.login} said this was not theirs.`;
    return (
      this.opts.store.decideSubmission(id, "rejected", user.login, note, this.now().toISOString()) ??
      submission
    );
  }

  mine(githubId: number): Submission[] {
    return this.opts.store.submissions({ githubId });
  }

  get(id: string): Submission | undefined {
    return this.opts.store.submission(id);
  }

  /**
   * Writes the pack into `bots/<id>/` and rebuilds the directory. If the build then leaves the bot
   * out (it re-checks every pack), the folder is put back as it was and the approval is refused.
   */
  async approve(id: string, by: string, note = ""): Promise<Submission> {
    const submission = this.opts.store.submission(id);
    if (!submission) throw new SubmissionError("That submission no longer exists.", 404);
    if (submission.status !== "pending")
      throw new SubmissionError(`That submission was already ${submission.status}.`, 409);
    const blocked = this.blocked(submission);
    if (blocked) throw new SubmissionError(blocked, 409);
    const catalogue = this.opts.catalogue;
    const previous = catalogue.pack(submission.botId);
    let pack = submission.pack;
    if (previous && pack.version <= previous.version) {
      // The owner's own earlier change was approved since; keep the versions in order.
      pack = { ...pack, version: previous.version + 1 };
    }
    const folder = join(catalogue.dir, "bots", submission.botId);
    await rm(folder, { recursive: true, force: true });
    await writeBotFolder(folder, pack);
    await catalogue.rebuild();
    if (!catalogue.listing(submission.botId)) {
      if (previous) await writeBotFolder(folder, previous);
      else await rm(folder, { recursive: true, force: true });
      await catalogue.rebuild();
      throw new SubmissionError(
        "The directory build left this pack out (see the server log for the reason), so it was not approved.",
        422,
      );
    }
    return this.opts.store.decideSubmission(id, "approved", by, note, this.now().toISOString()) ?? submission;
  }

  async reject(id: string, by: string, note = ""): Promise<Submission> {
    const submission = this.opts.store.submission(id);
    if (!submission) throw new SubmissionError("That submission no longer exists.", 404);
    if (submission.status !== "pending")
      throw new SubmissionError(`That submission was already ${submission.status}.`, 409);
    return this.opts.store.decideSubmission(id, "rejected", by, note, this.now().toISOString()) ?? submission;
  }
}

/** The status and sentence for an error from this module or the GitHub client. */
export function submissionProblem(
  error: unknown,
): { status: number; message: string; problems: PackProblem[] } | undefined {
  if (error instanceof SubmissionError)
    return { status: error.status, message: error.message, problems: error.problems };
  if (error instanceof GitHubError) return { status: error.status, message: error.message, problems: [] };
  return undefined;
}
