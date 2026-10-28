import { briefAutomation, buildCatalogue, type PhoneProfile, type TenantShortcut } from "@steward/phone";
import {
  type CatalogueEntry,
  DEVICE_ROUTES,
  type PhoneCatalogue,
  route,
  type ShortcutInstall,
  STEWARD_SHORTCUT,
} from "@steward/shared";
import {
  buildLauncher,
  buildStewardShortcut,
  previewSteps,
  readSigned,
  SigningError,
  sign,
} from "@steward/shortcuts";
import type { StewardServices } from "../context.ts";
import { HttpError, notFound } from "../http/errors.ts";
import type { InstallStore } from "./installs.ts";
import { machineName } from "./phone.ts";

/**
 * The person's profile as the phone catalogue reads it (docs/plans/phone-and-shortcuts.md §4.3):
 * their skills and the tenant's, routines, installed bots' launchers, mail, the brief time, and
 * the tenant's `shortcuts.yaml`.
 */
export function phoneProfile(s: StewardServices, tenantShortcuts: readonly TenantShortcut[]): PhoneProfile {
  const own = s.proactive.skills.list();
  const names = new Set(own.map((k) => k.name));
  const skills = [...own, ...s.tenant.skills.filter((k) => !names.has(k.name))].map((k) => ({
    name: k.name,
    description: k.description,
  }));
  return {
    skills,
    routines: s.proactive.routines.list().map((r) => ({ id: r.id, title: r.title, enabled: r.enabled })),
    bots: s.installedBots.list().map((b) => ({ id: b.id, name: b.name, shortcuts: b.pack.shortcuts ?? [] })),
    mailConnected: Boolean(s.mail()),
    briefTime: s.settings.briefTime(),
    tenant: { id: s.config.tenantId, name: s.tenant.brand.name, shortcuts: [...tenantShortcuts] },
  };
}

/** Asking and checking need the main shortcut's input; every other action can have a launcher. */
const NO_LAUNCHER = new Set(["ask", "check"]);

/** The launcher's name is what Siri hears: "Steward What needs me". */
export function launcherName(entry: CatalogueEntry): string {
  const name = (entry.siriPhrase ?? `Steward ${entry.title}`)
    .replace(/[:?/\\"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return name.slice(0, 60) || "Steward";
}

export function signingAvailable(platform: NodeJS.Platform = process.platform): {
  available: boolean;
  reason?: string;
} {
  return platform === "darwin"
    ? { available: true }
    : {
        available: false,
        reason:
          "Only a Mac can sign shortcuts. Pair with the code instead; the Steward menu has every action.",
      };
}

export function phoneCatalogue(s: StewardServices, profile: PhoneProfile): PhoneCatalogue {
  const url = s.phone.url();
  const automation = briefAutomation(profile);
  return {
    entries: buildCatalogue(profile).map((e) => ({
      ...e,
      launcher: !NO_LAUNCHER.has(e.id),
      steps: NO_LAUNCHER.has(e.id)
        ? [
            e.id === "check"
              ? "Share text or a link to the Steward shortcut from any app."
              : "Say “Hey Siri, Steward”, or open the Steward shortcut.",
          ]
        : previewSteps("launcher", e.title),
    })),
    steward: {
      steps: previewSteps("steward"),
      personalSteps: previewSteps("personal"),
      downloadUrl: url ? `${url}${DEVICE_ROUTES.shortcut}` : null,
      shipped: readSigned("Steward.shortcut") !== undefined,
    },
    ...(automation ? { automation } : {}),
    shortcut: s.deviceApi.manifest(),
    signing: signingAvailable(),
  };
}

/**
 * Makes a one-time download: the personal Steward file (`steward`) or a launcher (a catalogue id).
 *
 * The personal file holds a new phone key, so it is signed only `people-who-know-me`, on this Mac,
 * and kept in memory for ten minutes. A key whose file was never fetched is revoked when the link
 * dies. Launchers that ship signed for anyone are used as they are, so a Linux host can offer them.
 */
export async function makeInstall(
  s: StewardServices,
  id: string,
  deps: { installs: InstallStore; profile: () => PhoneProfile; platform?: NodeJS.Platform },
): Promise<ShortcutInstall> {
  const url = s.phone.url();
  if (!url)
    throw new HttpError(409, "First set the address your phone uses to reach Steward, in Settings → Phone.");
  if (!s.phoneListener.running) throw new HttpError(409, "The phone port is switched off.");
  const platform = deps.platform ?? process.platform;

  const offer = (
    bytes: Uint8Array,
    name: string,
    personal: boolean,
    onExpire?: () => void,
  ): ShortcutInstall => {
    const held = deps.installs.add({ bytes, name, personal, ...(onExpire ? { onExpire } : {}) });
    return {
      url: `${url}${route(DEVICE_ROUTES.install, { id: `${held.id}.shortcut` })}`,
      expiresAt: held.expiresAt,
      name,
      personal,
    };
  };

  const signLocally = async (
    workflow: ReturnType<typeof buildLauncher>,
    name: string,
  ): Promise<Uint8Array> => {
    if (!signingAvailable(platform).available) throw new HttpError(409, signingAvailable(platform).reason!);
    try {
      const bytes = await sign(workflow, "people-who-know-me", { name, platform });
      if (!bytes) throw new HttpError(409, signingAvailable("linux").reason!);
      return bytes;
    } catch (err) {
      if (err instanceof SigningError) throw new HttpError(err.problem === "icloud" ? 409 : 502, err.message);
      throw err;
    }
  };

  if (id === "steward") {
    if (!signingAvailable(platform).available) {
      throw new HttpError(
        409,
        "Only a Mac can make the one-tap file. Use the pairing code in Settings → Phone instead.",
      );
    }
    const { device, token } = s.devices.issue({ deviceName: "iPhone (one-tap file)", kind: "shortcut" });
    let bytes: Uint8Array;
    try {
      bytes = await signLocally(
        buildStewardShortcut({
          personal: {
            url,
            token,
            name: machineName(),
            ...(s.config.deviceAccess ? { access: s.config.deviceAccess } : {}),
          },
        }),
        STEWARD_SHORTCUT.name,
      );
    } catch (err) {
      s.devices.revoke(device.id);
      throw err;
    }
    return offer(bytes, STEWARD_SHORTCUT.name, true, () => {
      if (!s.devices.get(device.id)?.lastSeenAt) s.devices.revoke(device.id);
    });
  }

  const entry = buildCatalogue(deps.profile()).find((e) => e.id === id);
  if (!entry) throw notFound("that shortcut");
  if (NO_LAUNCHER.has(entry.id)) {
    throw new HttpError(400, "That one is part of the Steward shortcut itself; it needs no launcher.");
  }
  const name = launcherName(entry);
  const shipped = readSigned(`launchers/${entry.id}.shortcut`);
  if (shipped) return offer(shipped, name, false);
  return offer(await signLocally(buildLauncher(entry.id), name), name, false);
}
