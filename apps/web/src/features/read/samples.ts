// The two sample photos for Read It To Me (plan.md §12.1 finding 8). They are the fixtures'
// PNGs (fixtures/vision/*.png, copied to public/demo/) and go through exactly the path an uploaded
// photo takes: fetched, base64-encoded and posted to `POST /letters/read`. A replay-mode Gateway's
// ReplayVision recognises each one by its SHA-256 (fixtures/vision/<sha256>.json); a Gateway with
// a Gemini key reads it for real. With no Gateway (the showcase) `withRecordedVision` stands in
// for ReplayVision the same way: by the photo's fingerprint, returning the recorded reading.
import type { CatalogSource } from "@/lib/catalog-client";
import type { LetterReading, ReadLetterRequest } from "@/lib/letters";

export interface SamplePhoto {
  /** The id of the reading recorded from it, in src/showcase/letters.json. */
  id: string;
  file: string;
  /** SHA-256 of the PNG, the name of its reading in fixtures/vision/. */
  sha256: string;
  title: string;
  description: string;
}

export const SAMPLE_PHOTOS: SamplePhoto[] = [
  {
    id: "thames-water-overpayment",
    file: "thames_water_overpayment.png",
    sha256: "12bc8229a9c508e6a74ae04198a36f2bc6f4f0ba6eb0b00e2c479f85a0c6254c",
    title: "A water bill: you paid too much",
    description: "Thames Water owes you £23.40. Nothing to do.",
  },
  {
    id: "council-tax-reminder",
    file: "council_tax_reminder.png",
    sha256: "49262884b4398d730dc4a04091bf714285a8cb29c4e16bf4d085fb9dbeae76ea",
    title: "A council tax reminder",
    description: "£112.00 to pay by 10 November. One date Tempo reads back first.",
  },
];

export function photoUrl(photo: SamplePhoto): string {
  return `${import.meta.env.BASE_URL ?? "/"}demo/${photo.file}`;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Lower-case hex SHA-256, or null where the browser has no Web Crypto (an insecure origin). */
export async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** The request body for a sample photo: the same shape an uploaded photo produces. */
export async function samplePhotoBody(photo: SamplePhoto, user: { id: string; name: string }, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<ReadLetterRequest> {
  const response = await fetchImpl(photoUrl(photo));
  if (!response.ok) throw new Error(`The sample photo didn't load (HTTP ${response.status}). Reload the page and try again.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { image_b64: toBase64(bytes), filename: photo.file, user_id: user.id, display_name: user.name };
}

export const SHOWCASE_CANNOT_READ = "The showcase has no Gateway, so it can only read the two sample photos. To read your own letter, run Tempo with a Gemini key on the Gateway.";

/**
 * In the showcase, the vision step answers the way the Gateway's ReplayVision does: a sample photo
 * is recognised by its fingerprint and gets the reading recorded from it; anything else is refused
 * in plain words. With a Gateway, the source is returned unchanged.
 */
export function withRecordedVision(source: CatalogSource): CatalogSource {
  if (!source.showcase) return source;
  return {
    showcase: true,
    skills: () => source.skills(),
    profiles: () => source.profiles(),
    profile: (id) => source.profile(id),
    share: (id, origin) => source.share(id, origin),
    importProfile: (code) => source.importProfile(code),
    sampleLetters: () => source.sampleLetters(),
    reply: (body) => source.reply(body),
    readLetter: async (body: ReadLetterRequest): Promise<LetterReading> => {
      let digest: string | null = null;
      try {
        digest = await sha256Hex(fromBase64(body.image_b64));
      } catch {
        digest = null;
      }
      // Without Web Crypto (an http:// address on a phone), fall back to the sample's file name.
      const photo = SAMPLE_PHOTOS.find((p) => (digest ? p.sha256 === digest : p.file === body.filename));
      const recorded = photo ? (await source.sampleLetters()).find((l) => l.id === photo.id) : undefined;
      if (!recorded) throw new Error(SHOWCASE_CANNOT_READ);
      return structuredClone(recorded.reading);
    },
  };
}
