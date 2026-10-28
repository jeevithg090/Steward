import { DEVICE_SCOPE_LABELS, type Device, type PhoneCatalogue, type ShortcutInstall } from "@steward/shared";
import { Check, Copy, Download as DownloadIcon } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button.tsx";
import { Card, CardHeader } from "@/components/ui/Card.tsx";
import { ErrorNotice, Loading, Notice } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { useDevices, usePhoneCatalogue, useShortcutInstall } from "@/lib/api.ts";
import { formatTime, relativeTime } from "@/lib/utils.ts";
import { QrCode } from "./settings/phone/QrCode.tsx";

type Entry = PhoneCatalogue["entries"][number];

/**
 * The Shortcuts page (docs/plans/phone-and-shortcuts.md §4.4), Steward's own RoutineHub: the one
 * Steward shortcut, launchers suggested from your skills and routines, your setup's own
 * shortcuts, and which phones have which version. Every QR code has a link and a copy button.
 */
export function ShortcutsPage() {
  const catalogue = usePhoneCatalogue();
  const devices = useDevices();
  return (
    <Page
      title="Shortcuts"
      description="Steward on your iPhone: one Steward shortcut for everything, and launchers for Siri, the Action button and the Home Screen."
    >
      {catalogue.isPending ? (
        <Loading>Loading your shortcuts…</Loading>
      ) : catalogue.data ? (
        <Shortcuts catalogue={catalogue.data} devices={devices.data ?? []} />
      ) : (
        <ErrorNotice
          title="Couldn't load your shortcuts"
          error={catalogue.error}
          onRetry={() => catalogue.refetch()}
        />
      )}
    </Page>
  );
}

function Shortcuts({ catalogue, devices }: { catalogue: PhoneCatalogue; devices: Device[] }) {
  const suggested = catalogue.entries.filter((e) => e.source !== "tenant" && e.launcher);
  const fromSetup = catalogue.entries.filter((e) => e.source === "tenant");
  const builtIn = catalogue.entries.filter((e) => !e.launcher);
  const phones = devices.filter((d) => d.kind === "shortcut");
  const behind = phones.filter(
    (d) => versionOf(d) !== undefined && versionOf(d)! < catalogue.shortcut.version,
  );

  return (
    <>
      <StewardCard catalogue={catalogue} builtIn={builtIn} />

      <Card as="section" aria-labelledby="shortcuts-suggested">
        <CardHeader
          id="shortcuts-suggested"
          title="Suggested for you"
          description="One tap each. They open the Steward shortcut at one action, so Siri, the Action button and the Home Screen can reach it. New skills and routines also appear in the Steward menu with nothing to add."
        />
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {suggested.map((e) => (
            <EntryCard key={e.id} entry={e} canSign={catalogue.signing.available} />
          ))}
        </ul>
        {!catalogue.signing.available ? (
          <p className="mt-3 text-caption text-ink-2">{catalogue.signing.reason}</p>
        ) : null}
      </Card>

      {fromSetup.length > 0 ? (
        <Card as="section" aria-labelledby="shortcuts-setup">
          <CardHeader
            id="shortcuts-setup"
            title="From your setup"
            description="Shortcuts that come with the setup Steward runs. Each one asks Steward, through the same checks as anything you type."
          />
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {fromSetup.map((e) => (
              <EntryCard key={e.id} entry={e} canSign={catalogue.signing.available} />
            ))}
          </ul>
        </Card>
      ) : null}

      <Card as="section" aria-labelledby="shortcuts-installed">
        <CardHeader
          id="shortcuts-installed"
          title="Installed"
          description="Phones that have called Steward, with the version of the Steward shortcut they use."
        />
        {phones.length === 0 ? (
          <p className="mt-3 text-ink-2 text-sub">No phone has called Steward yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {phones.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-tile px-3 py-2"
              >
                <span className="font-medium text-ink text-sub">{d.name}</span>
                <span className="text-caption text-ink-2">
                  {d.shortcutVersion ?? "version not known yet"} · last used{" "}
                  {d.lastSeenAt ? relativeTime(d.lastSeenAt) : "never"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" aria-labelledby="shortcuts-updates">
        <CardHeader id="shortcuts-updates" title="Updates" />
        {behind.length === 0 ? (
          <p className="mt-2 text-ink-2 text-sub">
            Every phone has the newest Steward shortcut (version {catalogue.shortcut.version}).
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            <Notice tone="needs" title="An update is ready">
              {behind.map((d) => d.name).join(", ")} {behind.length === 1 ? "has" : "have"} an older Steward
              shortcut. Open the download on that phone and tap Add Shortcut; it stays paired.
            </Notice>
            {catalogue.steward.downloadUrl ? (
              <Download
                url={catalogue.steward.downloadUrl}
                label="QR code to download the newest Steward shortcut"
              />
            ) : null}
          </div>
        )}
      </Card>

      {catalogue.automation ? (
        <Card as="section" aria-labelledby="shortcuts-morning">
          <CardHeader
            id="shortcuts-morning"
            title="Your brief, every weekday morning"
            description={`Your brief is ready at ${catalogue.automation.time}. An automation on the phone can read it to you then.`}
          />
          <ol className="mt-3 list-decimal pl-6 text-ink text-sub marker:text-ink-2">
            <li>In Shortcuts on the iPhone, open Automation and add a Time of Day automation.</li>
            <li>Choose {catalogue.automation.time}, weekdays, and Run Immediately.</li>
            <li>
              Add the action Run Shortcut, choose Steward, and set its input to the text{" "}
              <code className="font-mono">{catalogue.automation.input}</code>.
            </li>
          </ol>
        </Card>
      ) : null}
    </>
  );
}

const versionOf = (d: Device): number | undefined => {
  const m = /@(\d+)$/.exec(d.shortcutVersion ?? "");
  return m ? Number(m[1]) : undefined;
};

function CopyLink({ text, what = "Link" }: { text: string; what?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      icon={copied ? <Check /> : <Copy />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success(`${what} copied`);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Couldn't copy. Select the link and copy it yourself.");
        }
      }}
    >
      {copied ? "Copied" : `Copy ${what.toLowerCase()}`}
    </Button>
  );
}

/** A download as a QR code, a link for when this page is open on the phone, and a copy button. */
function Download({ url, label }: { url: string; label: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <QrCode value={url} label={label} size={152} />
      <div className="flex flex-col items-start gap-2">
        <a
          href={url}
          className="inline-flex min-h-target items-center gap-2 text-accent text-sub underline underline-offset-4"
        >
          <DownloadIcon aria-hidden="true" className="size-4" />
          On this iPhone? Download it
        </a>
        <CopyLink text={url} />
      </div>
    </div>
  );
}

function StewardCard({ catalogue, builtIn }: { catalogue: PhoneCatalogue; builtIn: Entry[] }) {
  const install = useShortcutInstall();
  const [personal, setPersonal] = useState<ShortcutInstall | undefined>();
  const statusId = useId();
  const { steward } = catalogue;

  return (
    <Card as="section" aria-labelledby="shortcuts-steward">
      <CardHeader
        id="shortcuts-steward"
        title="The Steward shortcut"
        description="One shortcut for everything. Your Steward decides what its menu shows, so new skills and routines appear in it without adding anything."
      />
      <h3 className="mt-4 font-medium text-ink text-sub">What it does</h3>
      <ul className="mt-1 list-disc pl-6 text-ink-2 text-sub">
        {steward.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      {builtIn.length > 0 ? (
        <p className="mt-2 text-ink-2 text-sub">
          Built in:{" "}
          {builtIn.map((e, i) => (
            <span key={e.id}>
              {i > 0 ? "; " : ""}
              {e.title} ({e.steps[0]?.replace(/\.$/, "")})
            </span>
          ))}
          .
        </p>
      ) : null}

      <h3 className="mt-5 font-medium text-ink text-sub">Get it</h3>
      {steward.downloadUrl ? (
        <div className="mt-2 flex flex-col gap-3">
          <Download url={steward.downloadUrl} label="QR code to download the Steward shortcut" />
          {!steward.shipped ? (
            <Notice tone="needs" role="note">
              No signed copy of the Steward shortcut ships with this build yet, so the download will not work.
              A maintainer signs it at release (docs/phone.md).
            </Notice>
          ) : null}
          <p className="text-ink-2 text-sub">
            Then pair it:{" "}
            <Link to="/settings#settings-phone" className="text-accent underline underline-offset-4">
              Settings → Phone → Add iPhone
            </Link>
            .
          </p>
        </div>
      ) : (
        <p className="mt-1 text-ink-2 text-sub">
          First set the address your phone uses, in{" "}
          <Link to="/settings#settings-phone" className="text-accent underline underline-offset-4">
            Settings → Phone
          </Link>
          .
        </p>
      )}

      <h3 className="mt-5 font-medium text-ink text-sub">Or one tap, with the key inside</h3>
      <p className="mt-1 text-ink-2 text-sub">
        This Mac can make a copy that already holds your phone's key, signed here for your own devices only.
        Nothing is sent to Apple. Whether your iPhone accepts it without Private Sharing switched on is still
        to be checked on a device; pairing with the code always works.
      </p>
      <div id={statusId} role="status" aria-live="polite" className="mt-2">
        {personal ? (
          <span className="sr-only">One-tap file ready until {formatTime(personal.expiresAt)}.</span>
        ) : null}
      </div>
      {personal ? (
        <div className="mt-2 flex flex-col gap-3">
          <Notice tone="needs" title="This file holds your phone's key">
            Open it only on your own iPhone, before {formatTime(personal.expiresAt)}. The link works once.
            Don't share the file, and delete the download afterwards.
          </Notice>
          <Download url={personal.url} label="QR code to download your one-tap Steward shortcut" />
          <ul className="list-disc pl-6 text-ink-2 text-sub">
            {steward.personalSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {install.error ? (
        <ErrorNotice className="mt-2" title="Couldn't make the file" error={install.error} />
      ) : null}
      <div className="mt-3">
        <Button
          disabled={!catalogue.signing.available || !steward.downloadUrl}
          loading={install.isPending}
          onClick={() => install.mutate("steward", { onSuccess: setPersonal })}
        >
          {personal ? "Make a new one-tap file" : "Make a one-tap file"}
        </Button>
        {!catalogue.signing.available ? (
          <p className="mt-2 text-caption text-ink-2">{catalogue.signing.reason}</p>
        ) : null}
      </div>
    </Card>
  );
}

function EntryCard({ entry, canSign }: { entry: Entry; canSign: boolean }) {
  const install = useShortcutInstall();
  const [ready, setReady] = useState<ShortcutInstall | undefined>();
  const headingId = useId();
  return (
    <li
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-field p-4 shadow-[inset_0_0_0_1px_var(--st-line)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="font-semibold text-ink text-sub">
          {entry.title}
        </h3>
        <Pill tone="neutral">{SOURCE_LABELS[entry.source]}</Pill>
      </div>
      {entry.description ? <p className="text-ink-2 text-sub">{entry.description}</p> : null}
      {entry.siriPhrase ? (
        <p className="text-caption text-ink-2">Siri: “Hey Siri, {entry.siriPhrase.replace(/[:?]/g, "")}”</p>
      ) : null}
      <p className="text-caption text-ink-2">
        Needs: {entry.scopes.map((s) => DEVICE_SCOPE_LABELS[s].label.toLowerCase()).join(", ") || "nothing"}
      </p>
      <ul className="list-disc pl-5 text-caption text-ink-2">
        {entry.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      {ready ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="text-caption text-ink-2">Works once, until {formatTime(ready.expiresAt)}.</p>
          <Download url={ready.url} label={`QR code to add ${entry.title} to your iPhone`} />
        </div>
      ) : null}
      {install.error ? <ErrorNotice title="Couldn't make it" error={install.error} /> : null}
      <div>
        <Button
          size="sm"
          variant={ready ? "secondary" : "primary"}
          loading={install.isPending}
          disabled={!canSign && entry.source !== "core"}
          onClick={() => install.mutate(entry.id, { onSuccess: setReady })}
        >
          {ready ? "Make a new link" : "Add to iPhone"}
        </Button>
      </div>
    </li>
  );
}

const SOURCE_LABELS: Record<Entry["source"], string> = {
  core: "Steward",
  skill: "Your skill",
  routine: "Your routine",
  bot: "From a bot",
  tenant: "From your setup",
};
