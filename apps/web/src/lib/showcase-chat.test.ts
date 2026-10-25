import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLES } from "./shield";
import { ShowcaseGateway } from "./showcase";
import { classify, extract, extractDate, extractStations, extractTime, mergeSlots, showcaseChat } from "./showcase-chat";

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
