import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLES } from "./shield";
import { ShowcaseGateway } from "./showcase";
import { LATE_TRAIN, MISSED_VISIT, SCAM_SAMPLE, SUGGESTIONS, classify, extract, extractDate, extractStations, extractTime, limitNote, mergeSlots, profileRefusal, showcaseChat } from "./showcase-chat";

const TODAY = "2026-10-25";

describe("the showcase chat door classifies like the Gateway", () => {
  test.each([
    ["My 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40", "rail_delay"],
    ["The Broadbandly engineer never came on 19 October", "missed_visit"],
    [SAMPLES[0].text, "scam_check"],
    ["Is this a scam? " + SAMPLES[0].text, "scam_check"],
    ["Here is the link you asked for: rb.gy/4k2q", "scam_check"],
    ["What do you remember about me?", "memory_recall"],
    ["Forget that Sarah is my daughter", "memory_forget"],
    ["How much have you got back for me?", "ledger"],
    ["Am I owed anything?", "entitlement"],
    ["Read this letter", "letter"],
    ["Help", "help"],
    ["Which profile are you using?", "profiles"],
    ["STOP", "stop"],
    ["Hello there", "smalltalk"],
  ] as const)("%s → %s", (text, intent) => {
    expect(classify(text)).toBe(intent);
  });

  test("yes and no answer a pending question; otherwise they are small talk", () => {
    expect(classify("yes", true)).toBe("approve");
    expect(classify("No thanks", true)).toBe("decline");
    expect(classify("yes", false)).toBe("approve");
  });
});

describe("slot extraction", () => {
  test("the demo sentence yields all five facts", () => {
    expect(extract("My 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40", "rail_delay", TODAY)).toEqual({
      origin_crs: "OXF",
      destination_crs: "PAD",
      travel_date: "2026-10-23",
      departure: "08:12",
      fare_gbp: "28.40",
      delay_minutes: "38",
    });
  });

  test("from/to, CRS codes, times and relative dates", () => {
    expect(extractStations("to Paddington from Oxford")).toEqual({ origin: "OXF", destination: "PAD" });
    expect(extractStations("OXF to PAD")).toEqual({ origin: "OXF", destination: "PAD" });
    expect(extractTime("the 8am train")).toBe("08:00");
    expect(extractTime("left at 17.42")).toBe("17:42");
    expect(extractTime("left at 9:12am, fare £14.20")).toBe("09:12");
    expect(extractDate("yesterday", TODAY)).toBe("2026-10-24");
    expect(extractDate("on 23rd October", TODAY)).toBe("2026-10-23");
    expect(extractDate("on 2026-10-22", TODAY)).toBe("2026-10-22");
    expect(extractDate("last Friday", TODAY)).toBe("2026-10-23");
    expect(extract("The Broadbandly engineer never came on 19 October", "missed_visit", TODAY)).toEqual({ operator: "Broadbandly", event_date: "2026-10-19", notice_hours: null, account_ref: null });
  });

  test("merging keeps earlier facts and never overwrites with nothing", () => {
    expect(mergeSlots({ origin_crs: "OXF", fare_gbp: null }, { origin_crs: null, fare_gbp: "28.40" })).toEqual({ origin_crs: "OXF", fare_gbp: "28.40" });
  });
});

describe("answers from the recordings", () => {
  const turn = (text: string, slots?: Record<string, string | null>) => ({ user_id: "u_margaret", display_name: "Margaret", text, language: "en", slots });

  test("a late train with a fact missing asks one question, then starts the recorded mission", async () => {
    const gateway = new ShowcaseGateway();
    const first = await showcaseChat(turn("My 08:12 Oxford to Paddington was late on 23 October"), gateway);
    expect(first.intent).toBe("rail_delay");
    expect(first.needs).toEqual([{ field: "fare_gbp", question: "What did the ticket cost?" }]);
    expect(first.reply).toBe("Your 08:12 from Oxford to Paddington on 23 October. What did the ticket cost?");
    expect(first.mission).toBeNull();
    // A bare number has no door words of its own: the echoed slots say it continues the rail flow and fills the fare.
    const second = await showcaseChat(turn("28.40", first.slots), gateway);
    expect(second.intent).toBe("rail_delay");
    expect(second.mission?.state).toBe("awaiting_consent");
    expect(second.ask?.amount_gbp).toBe("14.20");
    expect(second.slots).toEqual({});
    expect(second.actions?.[0]?.href).toBe(`#/missions/${second.mission!.id}`);
    // Yes answers the newest pending ask: the mission just started.
    const yes = await showcaseChat(turn("yes"), gateway);
    expect(yes.intent).toBe("approve");
    expect(yes.mission?.id).toBe(second.mission!.id);
    expect(yes.mission?.state).toBe("waiting");
    // The seed left Margaret's broadband case and her earlier claim waiting too; after those, nothing is left.
    const broadband = await showcaseChat(turn("yes"), gateway);
    expect(broadband.mission?.skill_id).toContain("ofcom");
    const seeded = await showcaseChat(turn("yes"), gateway);
    expect(seeded.mission?.skill_id).toContain("rail");
    const again = await showcaseChat(turn("yes"), gateway);
    expect(again.reply).toBe("Nothing is waiting for your answer.");
  });

  test("a lone station after the origin is known fills the destination", async () => {
    const gateway = new ShowcaseGateway();
    const first = await showcaseChat(turn("Oxford"), gateway);
    expect(first.needs?.[0]?.field).toBe("destination_crs");
    const second = await showcaseChat(turn("Paddington", first.slots), gateway);
    expect(second.slots).toMatchObject({ origin_crs: "OXF", destination_crs: "PAD" });
    expect(second.needs?.[0]?.field).toBe("travel_date");
    const third = await showcaseChat(turn("19 October", second.slots), gateway);
    expect(third.intent).toBe("rail_delay");
    expect(third.slots).toMatchObject({ travel_date: "2026-10-19" });
    expect(third.needs?.[0]?.field).toBe("departure");
  });

  test("the HMRC sample gets its recorded verdict; other texts get an honest refusal", async () => {
    const gateway = new ShowcaseGateway();
    const hmrc = await showcaseChat(turn(SAMPLES[0].text), gateway);
    expect(hmrc.intent).toBe("scam_check");
    expect(hmrc.verdict?.level).toBe("likely_scam");
    const other = await showcaseChat(turn("Is this a scam? Your parcel is waiting, pay £2.99 at http://evri-fee.example/track"), gateway);
    expect(other.verdict).toBeNull();
    expect(other.reply).toMatch(/only check the sample messages/);
  });

  test("memories and the ledger come from the recordings", async () => {
    const gateway = new ShowcaseGateway();
    const memories = await showcaseChat(turn("What do you remember about me?"), gateway);
    expect(memories.memories?.map((m) => m.text)).toContain("has a stammer");
    expect(memories.reply).toMatch(/^Here's what I remember: .*has a stammer \(you said, by voice, 24 Oct\)/);
    const ledger = await showcaseChat(turn("How much have you got back for me?"), gateway);
    expect(ledger.ledger?.gbp_recovered).toBe("28.40");
    expect(ledger.reply).toBe("So far Tempo has got back £28.40 and 20 minutes of your time.");
  });

  test("help and small talk suggest the doors, as chat.py does; each is short and goes where it says", async () => {
    const gateway = new ShowcaseGateway();
    for (const text of ["Help", "Hello there"]) {
      const said = await showcaseChat(turn(text), gateway);
      expect(said.suggestions).toEqual([LATE_TRAIN, MISSED_VISIT, SCAM_SAMPLE, "Am I owed anything?"]);
    }
    for (const list of Object.values(SUGGESTIONS)) {
      expect(list.length).toBeLessThanOrEqual(4);
      for (const s of list) if (s !== SCAM_SAMPLE) expect(s.length).toBeLessThanOrEqual(120);
    }
    expect(SUGGESTIONS.doors.map((s) => classify(s))).toEqual(["rail_delay", "missed_visit", "scam_check", "entitlement"]);
    expect(extract(LATE_TRAIN, "rail_delay", TODAY)).toMatchObject({ origin_crs: "OXF", destination_crs: "PAD", travel_date: "2026-10-23", departure: "08:12", fare_gbp: "28.40" });
    expect(extract(MISSED_VISIT, "missed_visit", TODAY)).toMatchObject({ operator: "Broadbandly", event_date: "2026-10-19" });
    expect(classify(SUGGESTIONS.profiles[0])).toBe("profiles");
    // The suggested late train starts the recorded mission.
    expect((await showcaseChat(turn(LATE_TRAIN), gateway)).mission?.state).toBe("awaiting_consent");
  });

  test("the recorded journey's fare question offers its fare; another journey is not found and offers the recorded one", async () => {
    const gateway = new ShowcaseGateway();
    const ask = await showcaseChat(turn("My 08:12 Oxford to Paddington was late on 23 October"), gateway);
    expect(ask.needs?.[0]?.field).toBe("fare_gbp");
    expect(ask.suggestions).toEqual(["£28.40"]);
    const other = await showcaseChat(turn("My 08:12 Oxford to Paddington was late yesterday"), gateway);
    expect(other.suggestions).toBeNull(); // not the recorded journey: no fare is offered
    const missing = await showcaseChat(turn("My 08:12 Oxford to Paddington was 38 minutes late yesterday, ticket £28.40"), gateway);
    expect(missing.mission?.state).toBe("declined");
    expect(missing.ask).toBeNull();
    expect(missing.reply).toBe("I couldn't find the 08:12 from Oxford to Paddington on 24 October in the rail records. This showcase only has the 08:12 from 23 October.");
    expect(missing.slots).toMatchObject({ origin_crs: "OXF", travel_date: "2026-10-24" }); // kept, so a corrected date starts again
    expect(missing.suggestions).toEqual([LATE_TRAIN]);
    const fixed = await showcaseChat(turn("It was on 23 October", missing.slots), gateway);
    expect(fixed.mission?.state).toBe("awaiting_consent");
    expect(fixed.suggestions).toBeNull();
  });

  test("a ledger reply suggests what next; a memory reply carries no suggestions", async () => {
    const gateway = new ShowcaseGateway();
    expect((await showcaseChat(turn("How much have you got back for me?"), gateway)).suggestions).toEqual(["What do you remember about me?", "Am I owed anything?"]);
    expect((await showcaseChat(turn("What do you remember about me?"), gateway)).suggestions).toBeNull();
  });

  test("a profile that may not do what the skill needs refuses before asking, in tempo_core's words", async () => {
    const gateway = new ShowcaseGateway();
    const withProfile = (text: string, profile_id: string) => ({ ...turn(text), profile_id });
    const rail = await showcaseChat(withProfile(LATE_TRAIN, "read-it-to-me"), gateway);
    expect(rail.intent).toBe("rail_delay");
    expect(rail.mission).toBeNull();
    expect(rail.ask).toBeNull();
    expect(rail.reply).toBe("Your profile, Read It To Me, doesn't let me file a claim or accept cash, so I haven't started. Choose another profile if you want me to file a claim.");
    expect(rail.actions).toEqual([{ label: "Show my profiles", href: "#/profiles" }]);
    expect(rail.suggestions).toEqual(["Show me my profiles"]);
    expect(rail.slots).toMatchObject({ origin_crs: "OXF", fare_gbp: "28.40" }); // the facts stay for another profile
    // Refused before any question, too.
    expect((await showcaseChat(withProfile("my train was late", "read-it-to-me"), gateway)).needs).toBeNull();
    // The Commuter may claim for a train but may not phone the company about a missed visit.
    const ofcom = await showcaseChat(withProfile(MISSED_VISIT, "commuter"), gateway);
    expect(ofcom.mission).toBeNull();
    expect(ofcom.reply).toBe("Your profile, The Commuter, doesn't let me phone the company, so I haven't started. Choose another profile if you want me to phone the company.");
    expect(profileRefusal("am-i-owed", "rail_delay")).toMatch(/^Your profile, Am I Owed Anything, doesn't let me/);
    const allowed = await showcaseChat(withProfile(LATE_TRAIN, "commuter"), gateway);
    expect(allowed.mission?.state).toBe("awaiting_consent");
    expect(await gateway.missions()).toHaveLength(4); // only the allowed one started
    expect(profileRefusal(null, "rail_delay")).toBeNull();
    // Within every installed profile's limit, the recorded ask is unchanged; above it, the ask says so.
    expect(allowed.ask?.summary).not.toMatch(/limit/);
    expect(limitNote("commuter", "14.20")).toBeNull();
    expect(limitNote("commuter", "300.00")).toBe("This is above your profile's limit of £250.00, so I'm asking you first.");
    expect(limitNote(null, "300.00")).toBeNull();
    expect(profileRefusal("take-your-time", "missed_visit")).toBeNull();
    expect(profileRefusal("read-it-to-me", "ledger")).toBeNull();
  });

  test("STOP halts the open missions", async () => {
    const gateway = new ShowcaseGateway();
    const stopped = await showcaseChat(turn("STOP"), gateway);
    expect(stopped.intent).toBe("stop");
    expect(stopped.reply).toBe("Stopped. Nothing more will be sent.");
    const missions = await gateway.missions();
    expect(missions.filter((m) => m.user_id === "u_margaret").every((m) => m.state === "declined")).toBe(true);
  });
});

// Track A's vector file: the same texts the Gateway's router is tested on (plan.md §3).
const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = resolve(here, "../../../../fixtures/chat/intents.json");

interface Vector {
  text: string;
  intent: string;
  slots?: Record<string, string | null>;
}

if (existsSync(vectorsPath)) {
  const file = JSON.parse(readFileSync(vectorsPath, "utf8")) as { today?: string; vectors: Vector[] };
  describe("fixtures/chat/intents.json", () => {
    test.each(file.vectors.map((v) => [v.text, v] as const))("%s", (_text, vector) => {
      const intent = classify(vector.text);
      expect(intent).toBe(vector.intent);
      if (vector.slots) {
        const mine = extract(vector.text, intent, file.today ?? TODAY);
        for (const [key, value] of Object.entries(vector.slots)) {
          expect(mine[key] ?? null, `slot ${key}`).toBe(value ?? null);
        }
      }
    });
  });
} else {
  test.skip("fixtures/chat/intents.json is not written yet (track A); the vector check is skipped", () => {});
}
