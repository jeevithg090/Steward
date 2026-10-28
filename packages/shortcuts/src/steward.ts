/**
 * The shortcuts Steward hands out (docs/plans/phone-and-shortcuts.md §4.1, §4.2):
 *
 * - **Steward**, the generic thin client. No address, no key, no personal data, so it can be signed
 *   for anyone once per release. It pairs from `steward-pair:` text, keeps its key in iCloud Drive,
 *   and otherwise asks the person's own Steward what to show (the `DeviceUi` vocabulary).
 * - **The personal file**, the same client with the address and key inside. Signed only on the
 *   person's own Mac, for their own devices, and served once.
 * - **Launchers**, one per action, which run Steward with `action:<id>` so Siri phrases, the
 *   Action button and the Home Screen can reach one action directly.
 *
 * Logic and wording live on the server, so the client seldom changes.
 */
import { DEVICE_ROUTES, SHORTCUT_HEADER, STEWARD_SHORTCUT } from "@steward/shared";
import {
  attachment,
  Builder,
  Condition,
  fields,
  output,
  REPEAT_ITEM,
  SHORTCUT_INPUT,
  type Token,
  text,
  variable,
} from "./builder.ts";
import type { PlistDict } from "./plist.ts";

/** Where the paired address and key live on iOS 26 and 27: iCloud Drive/Shortcuts/Steward/device.json. */
export const STORAGE_PATH = "Steward/device.json";
export const SHORTCUT_NAME = STEWARD_SHORTCUT.name;
export const VERSION_HEADER = `${STEWARD_SHORTCUT.id}@${STEWARD_SHORTCUT.version}`;

/**
 * Pairing addresses the shortcut accepts: https anywhere, plain http only at home or on a tailnet
 * (`.local`, RFC 1918, 100.64/10). ICU syntax, as Match Text uses.
 */
export const PAIR_URL_PATTERN =
  "^(https://[A-Za-z0-9.-]+(:[0-9]{1,5})?|http://([A-Za-z0-9-]+\\.local|10(\\.[0-9]{1,3}){3}|192\\.168(\\.[0-9]{1,3}){2}|172\\.(1[6-9]|2[0-9]|3[01])(\\.[0-9]{1,3}){2}|100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])(\\.[0-9]{1,3}){2})(:[0-9]{1,5})?)$";

export interface Workflow extends PlistDict {
  WFWorkflowActions: PlistDict[];
}

/** The top-level keys every Steward shortcut carries. */
function workflow(b: Builder, opts: { shareSheet: boolean }): Workflow {
  return {
    WFWorkflowClientVersion: "2700.0.4",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowIcon: { WFWorkflowIconStartColor: 463140863, WFWorkflowIconGlyphNumber: 59511 },
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: opts.shareSheet ? ["ActionExtension"] : [],
    WFWorkflowInputContentItemClasses: ["WFStringContentItem", "WFURLContentItem"],
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowHasShortcutInputVariables: true,
    WFQuickActionSurfaces: [],
    WFWorkflowActions: b.actions,
  };
}

/** `Get Contents of URL`: a POST with the device key, the version header and `{ "text": … }`. */
function request(
  b: Builder,
  url: PlistDict,
  headers: [string, PlistDict][],
  body: [string, PlistDict][],
): Token {
  return output(
    b.add("downloadurl", {
      WFURL: url,
      WFHTTPMethod: "POST",
      ShowHeaders: true,
      WFHTTPHeaders: fields([...headers, [SHORTCUT_HEADER, text(VERSION_HEADER)]]),
      WFHTTPBodyType: "JSON",
      WFJSONValues: fields(body),
    }),
    "Contents of URL",
  );
}

/** Runs this same shortcut again with new input: how a choice or an answer becomes the next call. */
function runSelf(b: Builder, input: PlistDict): void {
  b.run("runworkflow", { WFWorkflowName: SHORTCUT_NAME, WFInput: input, WFShowWorkflow: false });
}

/** `steward-pair:1:<base64url>` → asks "Pair with Steward on <name> at <address>?", then pairs. */
function pairingBranch(b: Builder, input: Token): void {
  const matched = b.match(input, "^steward-pair:1:([A-Za-z0-9_=-]+)$");
  const isPairing = b.if(matched, Condition.hasAnyValue);
  b.comment(
    "Pairing. Any web page can open this shortcut with any text, so it shows where it would pair and waits for a tap.",
  );
  const encoded = b.group(matched, 1);
  const standard = b.replace(b.replace(encoded, "-", "+"), "_", "/");
  const decoded = output(
    b.add("base64encode", { WFInput: attachment(standard), WFEncodeMode: "Decode" }),
    "Base64 Encoded",
  );
  const offer = b.dictionary(decoded);
  const url = b.valueFor(offer, "u");
  const code = b.valueFor(offer, "c");
  const name = b.valueFor(offer, "n");
  b.stopIf(
    b.match(url, PAIR_URL_PATTERN),
    Condition.hasNoValue,
    "That pairing code doesn't point at a Steward I can pair with: it must be https, or plain http at home. Nothing was changed.",
  );
  const menu = b.menu(text("Pair with Steward on ", name, " at ", url, "?"), ["Pair", "Cancel"]);
  menu.item("Pair");
  menu.item("Cancel");
  b.exit();
  menu.end();
  const deviceName = output(b.add("getdevicedetails", { WFDeviceDetail: "Device Name" }), "Device Details");
  const reply = b.dictionary(
    request(
      b,
      text(url, DEVICE_ROUTES.pair),
      [],
      [
        ["code", text(code)],
        ["deviceName", text(deviceName)],
        ["kind", text("shortcut")],
      ],
    ),
  );
  const token = b.valueFor(reply, "token");
  const failed = b.if(token, Condition.hasNoValue);
  b.show("Pairing didn't work: ", b.valueFor(reply, "error"));
  b.exit();
  b.otherwise(failed);
  b.endIf(failed);
  // Behind Cloudflare Access, the reply carries the service token every later call must show.
  const access = b.valueFor(reply, "access");
  saveDevice(b, {
    url,
    token,
    name,
    accessId: b.valueFor(access, "clientId"),
    accessSecret: b.valueFor(access, "clientSecret"),
  });
  b.show("Paired with Steward on ", name, ". Try asking: Hey Siri, Steward.");
  b.exit();
  b.otherwise(isPairing);
  b.endIf(isPairing);
}

interface Saved {
  url: Token | string;
  token: Token | string;
  name: Token | string;
  /** A Cloudflare Access service token, when the tunnel has one. Empty otherwise. */
  accessId: Token | string;
  accessSecret: Token | string;
}

function saveDevice(b: Builder, saved: Saved): void {
  const stored = output(
    b.add("dictionary", {
      WFItems: fields([
        ["u", text(saved.url)],
        ["token", text(saved.token)],
        ["n", text(saved.name)],
        ["ai", text(saved.accessId)],
        ["as", text(saved.accessSecret)],
      ]),
    }),
    "Dictionary",
  );
  b.run("documentpicker.save", {
    WFInput: attachment(stored),
    WFAskWhereToSave: false,
    WFSaveFileOverwrite: true,
    WFFileDestinationPath: text(STORAGE_PATH),
  });
}

function loadDevice(b: Builder): { url: Token; token: Token; accessId: Token; accessSecret: Token } {
  const file = output(
    b.add("documentpicker.open", {
      WFGetFilePath: text(STORAGE_PATH),
      WFFileErrorIfNotFound: false,
      WFShowFilePicker: false,
    }),
    "File",
  );
  const stored = b.dictionary(file);
  return {
    url: b.valueFor(stored, "u"),
    token: b.valueFor(stored, "token"),
    accessId: b.valueFor(stored, "ai"),
    accessSecret: b.valueFor(stored, "as"),
  };
}

/**
 * Picks the route from the input: `action:<id>` from a launcher, `post:<route>` from a choice or
 * an answer, shared text from the share sheet ("Check this"), and nothing for the home menu.
 */
function chooseRoute(b: Builder, input: Token): void {
  b.set("Route", b.text(DEVICE_ROUTES.home));
  b.set("Words", b.text(""));
  const action = b.match(input, "^action:([a-z0-9][a-z0-9:_.-]{0,120})$");
  const isAction = b.if(action, Condition.hasAnyValue);
  b.set("Route", b.text("/device/run/", b.group(action, 1)));
  b.otherwise(isAction);
  const post = b.match(input, "^post:(/device/[^\\s]{1,2000})$");
  const isPost = b.if(post, Condition.hasAnyValue);
  b.set("Route", b.group(post, 1));
  b.otherwise(isPost);
  const shared = b.if(input, Condition.hasAnyValue);
  b.set("Route", b.text("/device/run/check"));
  b.set("Words", input);
  b.otherwise(shared);
  b.endIf(shared);
  b.endIf(isPost);
  b.endIf(isAction);
}

/**
 * Acts on the reply's `ui`: every `say` and `show` in order, then the one `choose`, `ask` or
 * `open` the server may put last. A choice or an answer runs this shortcut again with `post:`.
 */
function interpret(b: Builder, reply: Token): void {
  const ui = b.valueFor(b.dictionary(reply), "ui");
  const loop = b.repeatEach(ui);
  b.set("Item", REPEAT_ITEM);
  const item = variable("Item");
  const say = b.valueFor(item, "say");
  const hasSay = b.if(say, Condition.hasAnyValue);
  b.show(say);
  b.otherwise(hasSay);
  b.endIf(hasSay);
  const show = b.valueFor(item, "show");
  const hasShow = b.if(show, Condition.hasAnyValue);
  b.show(b.valueFor(show, "title"), "\n\n", b.valueFor(show, "body"));
  b.otherwise(hasShow);
  b.endIf(hasShow);
  for (const key of ["choose", "ask", "open"] as const) {
    const value = b.valueFor(item, key);
    const has = b.if(value, Condition.hasAnyValue);
    b.set(key === "choose" ? "Choice" : key === "ask" ? "Question" : "Link", value);
    b.otherwise(has);
    b.endIf(has);
  }
  b.endRepeat(loop);

  // A choice: the labels, then the route of the one picked.
  const choice = variable("Choice");
  const hasChoice = b.if(choice, Condition.hasAnyValue);
  const options = b.valueFor(choice, "options");
  const labelsLoop = b.repeatEach(options);
  b.valueFor(REPEAT_ITEM, "label");
  const labels = b.endRepeat(labelsLoop);
  const picked = output(
    b.add("choosefromlist", {
      WFInput: attachment(labels),
      WFChooseFromListActionPrompt: text(b.valueFor(choice, "title")),
      WFChooseFromListActionSelectMultiple: false,
    }),
    "Chosen Item",
  );
  const findLoop = b.repeatEach(options);
  const label = b.valueFor(REPEAT_ITEM, "label");
  const same = b.if(label, Condition.equals, picked);
  b.set("Next", b.valueFor(REPEAT_ITEM, "post"));
  b.otherwise(same);
  b.endIf(same);
  b.endRepeat(findLoop);
  runSelf(b, text("post:", variable("Next")));
  b.exit();
  b.otherwise(hasChoice);
  b.endIf(hasChoice);

  // A question: ask, then post the answer as `text` in the address (no JSON to build on the phone).
  const question = variable("Question");
  const hasQuestion = b.if(question, Condition.hasAnyValue);
  const answer = output(
    b.add("ask", { WFAskActionPrompt: text(b.valueFor(question, "prompt")), WFInputType: "Text" }),
    "Provided Input",
  );
  const encoded = output(
    b.add("urlencode", { WFInput: text(answer), WFEncodeMode: "Encode" }),
    "URL Encoded Text",
  );
  runSelf(b, text("post:", b.valueFor(question, "post"), "?text=", encoded));
  b.exit();
  b.otherwise(hasQuestion);
  b.endIf(hasQuestion);

  const link = variable("Link");
  const hasLink = b.if(link, Condition.hasAnyValue);
  b.run("openurl", { WFInput: text(link) });
  b.otherwise(hasLink);
  b.endIf(hasLink);
}

export interface StewardShortcutOptions {
  /** The personal file: the address and key built in. Never sign this for anyone. */
  personal?: {
    url: string;
    token: string;
    name: string;
    access?: { clientId: string; clientSecret: string };
  };
}

/** The Steward shortcut: generic by default, personal when given an address and key. */
export function buildStewardShortcut(opts: StewardShortcutOptions = {}): Workflow {
  const b = new Builder();
  b.comment(
    `Steward ${VERSION_HEADER}. Your own Steward decides what this shows. ${
      opts.personal
        ? "This copy was made for you and holds your phone's key: don't share it."
        : "It holds no address and no key: pairing stores them in iCloud Drive/Shortcuts/Steward."
    } docs/phone.md says more.`,
  );
  b.set("Input", b.text(SHORTCUT_INPUT));
  const input = variable("Input");

  let url: Token;
  let token: Token;
  if (opts.personal) {
    // Keep a copy in the shared file too, so the generic shortcut and its updates stay paired.
    const { personal } = opts;
    const existing = loadDevice(b);
    const missing = b.if(existing.token, Condition.hasNoValue);
    saveDevice(b, {
      url: personal.url,
      token: personal.token,
      name: personal.name,
      accessId: personal.access?.clientId ?? "",
      accessSecret: personal.access?.clientSecret ?? "",
    });
    b.otherwise(missing);
    b.endIf(missing);
    b.set("Address", b.text(personal.url));
    b.set("Key", b.text(personal.token));
    b.set("AccessId", b.text(personal.access?.clientId ?? ""));
    b.set("AccessSecret", b.text(personal.access?.clientSecret ?? ""));
    url = variable("Address");
    token = variable("Key");
  } else {
    pairingBranch(b, input);
    const stored = loadDevice(b);
    b.stopIf(
      stored.token,
      Condition.hasNoValue,
      "Pair me first: open Steward on your Mac, go to Settings → Phone, and scan the pairing code.",
    );
    b.set("Address", stored.url);
    b.set("Key", stored.token);
    b.set("AccessId", stored.accessId);
    b.set("AccessSecret", stored.accessSecret);
    url = variable("Address");
    token = variable("Key");
  }

  chooseRoute(b, input);
  const reply = request(
    b,
    text(url, variable("Route")),
    [
      ["Authorization", text("Bearer ", token)],
      ["CF-Access-Client-Id", text(variable("AccessId"))],
      ["CF-Access-Client-Secret", text(variable("AccessSecret"))],
    ],
    [["text", text(variable("Words"))]],
  );
  interpret(b, reply);
  return workflow(b, { shareSheet: true });
}

/** A launcher: runs Steward with `action:<id>`. Named for the action, so Siri can call it. */
export function buildLauncher(actionId: string): Workflow {
  if (!/^[a-z0-9][a-z0-9:_.-]{0,120}$/.test(actionId)) throw new Error(`"${actionId}" is not an action id.`);
  const b = new Builder();
  b.comment(`Runs Steward with action:${actionId}. Needs the Steward shortcut, paired.`);
  runSelf(b, text(`action:${actionId}`));
  return workflow(b, { shareSheet: false });
}

/** What a shortcut does, in plain steps, for "what you're about to install". */
export function previewSteps(kind: "steward" | "personal" | "launcher", title?: string): string[] {
  if (kind === "launcher") {
    return [
      `Runs the Steward shortcut and goes straight to “${title ?? "this action"}”.`,
      "Holds no address and no key; it needs the Steward shortcut, paired.",
    ];
  }
  return [
    kind === "personal"
      ? "Already holds your Steward's address and this phone's key, so it works at once."
      : "Pairs with your Steward when you scan the pairing code on your Mac, after you tap Pair.",
    "Keeps the address and key in iCloud Drive → Shortcuts → Steward. Your other shortcuts can read that file.",
    "Asks your Steward what to show, and shows it: your brief, what needs you, a reply.",
    "Sends text you share to it to Steward, to check.",
    "Talks only to your own Steward, at the address you paired.",
  ];
}
