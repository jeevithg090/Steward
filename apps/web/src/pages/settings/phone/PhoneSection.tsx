import {
  DEVICE_KIND_LABELS,
  DEVICE_SCOPE_LABELS,
  DEVICE_SCOPES,
  type Device,
  type DeviceScope,
  type PairingOffer,
  type PhoneInfo,
} from "@steward/shared";
import { Check, Copy, Lock, Smartphone } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button.tsx";
import { Card, CardHeader } from "@/components/ui/Card.tsx";
import { Checkbox, Field, Input, Switch } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading, Notice } from "@/components/ui/Notice.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import {
  api,
  useDevices,
  usePairDevice,
  usePatchDevice,
  usePhone,
  useRemotePairing,
  useRevokeDevice,
  useSetPhoneUrl,
} from "@/lib/api.ts";
import { formatTime, relativeTime } from "@/lib/utils.ts";
import { QrCode } from "./QrCode.tsx";

/**
 * Settings → Phone (docs/plans/phone-and-shortcuts.md §3.2, §4.1): the address the phone uses, a
 * pairing offer to scan, the paired phones with what each may do, and the rules no phone can lift.
 * Every QR code has a button and a copyable link beside it, and every step is announced.
 */
export function PhoneSection() {
  const phone = usePhone();
  return (
    <Card as="section" aria-labelledby="settings-phone">
      <CardHeader
        id="settings-phone"
        title={
          <span className="flex items-center gap-2">
            <Smartphone aria-hidden="true" className="size-5 text-ink-2" />
            Phone
          </span>
        }
        description="Use Steward from your iPhone: hear what needs you, answer requests and ask for things. Steward stays on this computer. The phone reaches it through a port of its own, with a key you can take back at any time."
      />
      {phone.isPending ? (
        <Loading>Loading phone settings…</Loading>
      ) : phone.data ? (
        <div className="mt-5 flex flex-col gap-8">
          <Connection info={phone.data} />
          <AddPhone info={phone.data} />
          <AddApp info={phone.data} />
          <PairedPhones />
          <NeverFromAPhone info={phone.data} />
        </div>
      ) : (
        <ErrorNotice className="mt-4" title="Couldn't load phone settings" error={phone.error} />
      )}
    </Card>
  );
}

function CopyButton({ text, what }: { text: string; what: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${what} copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it yourself.");
    }
  }
  return (
    <Button size="sm" icon={copied ? <Check /> : <Copy />} onClick={copy}>
      {copied ? "Copied" : `Copy ${what.toLowerCase()}`}
    </Button>
  );
}

function Connection({ info }: { info: PhoneInfo }) {
  const save = useSetPhoneUrl();
  const [url, setUrl] = useState(info.url ?? "");
  const port = info.listener.port ?? 8788;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(url.trim(), {
      onSuccess: (next) => toast.success(next.url ? "Phone address saved" : "Phone address cleared"),
    });
  }

  return (
    <section aria-labelledby="phone-connection">
      <h3 id="phone-connection" className="font-semibold text-body text-ink">
        Connection
      </h3>
      <p className="mt-1 text-ink-2 text-sub">
        {info.listener.running
          ? `Steward's phone port is open on this computer at port ${port}. It answers only paired phones, and only with what you allow below.`
          : "The phone port is switched off (STEWARD_DEVICE_PORT=off)."}
      </p>
      <Notice tone="needs" className="mt-3" role="note" title="Point a tunnel at the phone port only">
        Tunnel port {port}, never Steward's main port {info.mainPort}: that one has no sign-in, so anyone who
        reached it could act as you.
      </Notice>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <Field
          label="Phone address"
          description={`The https address your tunnel gives the phone port, such as https://your-mac.your-tailnet.ts.net. At home, http://your-mac.local:${port} also works.`}
          error={save.error?.message}
        >
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-mac.your-tailnet.ts.net"
          />
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save address
          </Button>
        </div>
      </form>
      {info.urlWarning ? (
        <Notice tone="needs" className="mt-3" role="status">
          {info.urlWarning}
        </Notice>
      ) : null}
      <div className="mt-4">
        <h4 className="font-medium text-ink text-sub">Ways to reach it</h4>
        <ul className="mt-2 flex flex-col gap-3">
          {info.transports.map((t) => (
            <li key={t.id} className="rounded-field bg-tile px-3 py-2">
              <p className="text-ink text-sub">
                {t.id === "tailscale"
                  ? "Tailscale Serve (recommended: only your own devices)"
                  : "Cloudflare tunnel"}
                {" · "}
                <span className="text-ink-2">{t.found ? "installed on this computer" : "not installed"}</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all font-mono text-caption text-ink">{t.command}</code>
                <CopyButton text={t.command} what="Command" />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-caption text-ink-2">
          Steward never starts a tunnel by itself. The guide is in docs/phone.md.
        </p>
      </div>
    </section>
  );
}

function AddPhone({ info }: { info: PhoneInfo }) {
  const pair = usePairDevice();
  const [offer, setOffer] = useState<PairingOffer | undefined>();
  const [pairedName, setPairedName] = useState<string | undefined>();
  const devices = useDevices({ refetchInterval: offer ? 2000 : false });
  const [known, setKnown] = useState<Set<string> | undefined>();
  const statusId = useId();

  // A phone that appears while the offer is up is the one that just paired.
  useEffect(() => {
    if (!offer || !devices.data || !known) return;
    const fresh = devices.data.find((d) => !known.has(d.id));
    if (fresh) {
      setPairedName(fresh.name);
      setOffer(undefined);
    }
  }, [offer, devices.data, known]);

  // The code dies after ten minutes; take it off the screen then.
  useEffect(() => {
    if (!offer) return;
    const left = Date.parse(offer.expiresAt) - Date.now();
    const timer = setTimeout(() => setOffer(undefined), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [offer]);

  function start() {
    setPairedName(undefined);
    setKnown(new Set((devices.data ?? []).map((d) => d.id)));
    pair.mutate("shortcut", { onSuccess: setOffer });
  }

  const ready = Boolean(info.url) && info.listener.running;
  const grouped = offer ? `${offer.code.slice(0, 4)} ${offer.code.slice(4)}` : "";

  return (
    <section aria-labelledby="phone-add" aria-describedby={statusId}>
      <h3 id="phone-add" className="font-semibold text-body text-ink">
        Add an iPhone
      </h3>
      <p className="mt-1 text-ink-2 text-sub">
        Two scans and one tap: get the Steward shortcut, then pair it. You never type an address or a key.
      </p>
      <div id={statusId} role="status" aria-live="polite" className="mt-3">
        {pairedName ? (
          <Notice tone="done" title={`${pairedName} paired`}>
            Try: “Hey Siri, Steward”. You can choose what it may do under Paired phones.
          </Notice>
        ) : offer ? (
          <span className="sr-only">
            Pairing offer ready. It works once, until {formatTime(offer.expiresAt)}.
          </span>
        ) : null}
      </div>
      {!ready ? (
        <p className="mt-3 text-ink-2 text-sub">Set the phone address under Connection first.</p>
      ) : null}
      {pair.error ? (
        <ErrorNotice className="mt-3" title="Couldn't make a pairing code" error={pair.error} />
      ) : null}
      {offer ? (
        <ol className="mt-4 grid gap-4 md:grid-cols-2" aria-label="Pairing steps">
          <li className="flex flex-col gap-3 rounded-field bg-tile p-4">
            <h4 className="font-semibold text-ink text-sub">1. Get the Steward shortcut</h4>
            <QrCode value={offer.shortcutUrl} label="QR code to download the Steward shortcut" />
            <p className="text-caption text-ink-2">
              Scan with the iPhone's Camera, open the download, then tap Add Shortcut. Only needed once.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={offer.shortcutUrl}
                className="inline-flex min-h-target items-center rounded-field px-3 text-accent text-sub underline underline-offset-4"
              >
                On this iPhone? Get the shortcut
              </a>
              <CopyButton text={offer.shortcutUrl} what="Link" />
            </div>
          </li>
          <li className="flex flex-col gap-3 rounded-field bg-tile p-4">
            <h4 className="font-semibold text-ink text-sub">2. Pair it</h4>
            <QrCode value={offer.qrText} label="QR code to pair your iPhone with Steward" />
            <p className="text-caption text-ink-2">
              Scan it, let Shortcuts open, check it names this computer, and tap Pair. Code{" "}
              <span className="font-mono text-ink">{grouped}</span>, single use, until{" "}
              {formatTime(offer.expiresAt)}.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={offer.qrText}
                className="inline-flex min-h-target items-center rounded-field px-3 text-accent text-sub underline underline-offset-4"
              >
                On this iPhone? Pair it
              </a>
              <CopyButton text={offer.qrText} what="Pairing link" />
            </div>
          </li>
        </ol>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant={offer ? "secondary" : "primary"}
          disabled={!ready}
          loading={pair.isPending}
          onClick={start}
        >
          {offer ? "Make a new code" : "Add iPhone"}
        </Button>
        {offer ? (
          <Button variant="ghost" onClick={() => setOffer(undefined)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Add phone (app): the encrypted relay (§5.2). The QR code holds a one-time key in the address's
 * fragment; the phone and this page then show the same code, and the person confirms here.
 */
function AddApp({ info }: { info: PhoneInfo }) {
  const [offer, setOffer] = useState<{ pairingId: string; url: string; expiresAt: string } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const state = useRemotePairing(offer?.pairingId);
  const statusId = useId();
  const relay = info.relay;
  const current = state.data;

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      setOffer(await api.devices.remotePair());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="phone-app" aria-describedby={statusId}>
      <h3 id="phone-app" className="font-semibold text-body text-ink">
        Add phone (app)
      </h3>
      <p className="mt-1 text-ink-2 text-sub">
        The Steward phone app: live chat, notifications, and answers signed by the phone, through a relay you
        host. Everything is sealed end to end: the relay passes on ciphertext only.
      </p>
      {!relay.configured ? (
        <p className="mt-2 text-ink-2 text-sub">
          Not set up: run a relay and set STEWARD_RELAY_URL and STEWARD_RELAY_TOKEN (docs/phone.md).
        </p>
      ) : (
        <>
          <p className="mt-2 text-caption text-ink-2">
            Relay {relay.url} · {relay.connected ? "connected" : "not connected"}
          </p>
          <details className="mt-2">
            <summary className="min-h-target cursor-pointer text-accent text-sub">
              What the relay can see
            </summary>
            <ul className="mt-1 list-disc pl-6 text-ink-2 text-sub">
              {relay.sees.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      <div id={statusId} role="status" aria-live="polite" className="mt-3">
        {current?.state === "check" ? (
          <Notice tone="accent" title={`Pair “${current.name}”? Code ${current.code}`}>
            The phone shows a code too. Confirm only if they are the same.
          </Notice>
        ) : current?.state === "paired" ? (
          <Notice tone="done" title={`${current.name ?? "The phone"} paired`}>
            Its keys never left it. Choose what it may do under Paired phones.
          </Notice>
        ) : current?.state === "expired" || current?.state === "refused" ? (
          <Notice title="That pairing ended">Make a new code to try again.</Notice>
        ) : null}
      </div>
      {error ? (
        <ErrorNotice className="mt-3" title="Couldn't start pairing" error={new Error(error)} />
      ) : null}
      {offer && (!current || current.state === "waiting") ? (
        <div className="mt-3 flex flex-col gap-3 rounded-field bg-tile p-4 sm:flex-row sm:items-center">
          <QrCode value={offer.url} label="QR code to pair the Steward phone app" />
          <div className="flex flex-col items-start gap-2">
            <p className="text-caption text-ink-2">
              Scan with the phone's camera. Works once, for two minutes, until {formatTime(offer.expiresAt)}.
            </p>
            <a
              href={offer.url}
              className="inline-flex min-h-target items-center text-accent text-sub underline underline-offset-4"
            >
              On this phone? Open the app
            </a>
            <CopyButton text={offer.url} what="Link" />
          </div>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {current?.state === "check" && offer ? (
          <>
            <Button
              variant="primary"
              onClick={async () => {
                await api.devices.remoteConfirm(offer.pairingId).catch((err: Error) => setError(err.message));
                void state.refetch();
              }}
            >
              The codes match: pair
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await api.devices.remoteRefuse(offer.pairingId).catch(() => {});
                setOffer(undefined);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button disabled={!relay.connected} loading={busy} onClick={start}>
            {offer ? "Make a new code" : "Add phone (app)"}
          </Button>
        )}
      </div>
    </section>
  );
}

function PairedPhones() {
  const devices = useDevices();
  return (
    <section aria-labelledby="phone-paired">
      <h3 id="phone-paired" className="font-semibold text-body text-ink">
        Paired phones
      </h3>
      {devices.isPending ? (
        <Loading>Loading phones…</Loading>
      ) : devices.data?.length ? (
        <ul className="mt-3 flex flex-col gap-4">
          {devices.data.map((d) => (
            <PhoneRow key={d.id} device={d} />
          ))}
        </ul>
      ) : devices.data ? (
        <p className="mt-1 text-ink-2 text-sub">No phone is paired.</p>
      ) : (
        <ErrorNotice className="mt-3" title="Couldn't load paired phones" error={devices.error} />
      )}
    </section>
  );
}

const PLAIN_SCOPES = DEVICE_SCOPES.filter((s) => s !== "approvals:decide");

function PhoneRow({ device }: { device: Device }) {
  const patch = usePatchDevice();
  const revoke = useRevokeDevice();
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();

  function setScope(scope: DeviceScope, on: boolean) {
    const scopes = on ? [...device.scopes, scope] : device.scopes.filter((s) => s !== scope);
    patch.mutate(
      { id: device.id, scopes },
      {
        onSuccess: () =>
          toast.success(
            scope === "approvals:decide"
              ? on
                ? `${device.name} can now say yes`
                : `${device.name} can no longer say yes`
              : "Saved",
          ),
      },
    );
  }

  return (
    <li aria-labelledby={headingId} className="rounded-field p-4 shadow-[inset_0_0_0_1px_var(--st-line)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={headingId} className="font-semibold text-ink text-sub">
            {device.name}
          </h4>
          <p className="text-caption text-ink-2">
            {DEVICE_KIND_LABELS[device.kind]}
            {device.shortcutVersion ? ` · ${device.shortcutVersion}` : ""} · last seen{" "}
            {device.lastSeenAt ? relativeTime(device.lastSeenAt) : "never"}
          </p>
        </div>
        {device.scopes.includes("approvals:decide") ? <Pill tone="needs">Can say yes</Pill> : null}
      </div>
      <Switch
        className="mt-3"
        checked={device.scopes.includes("approvals:decide")}
        onCheckedChange={(on) => setScope("approvals:decide", on)}
        disabled={patch.isPending}
        label="Say yes to requests"
        description="This phone can say yes to things Steward asks about. Payments, signing and passwords are still finished on your Mac."
      />
      <fieldset className="mt-2">
        <legend className="font-medium text-ink text-sub">It may also</legend>
        <div className="grid sm:grid-cols-2">
          {PLAIN_SCOPES.map((scope) => (
            <Checkbox
              key={scope}
              checked={device.scopes.includes(scope)}
              disabled={patch.isPending}
              onChange={(e) => setScope(scope, e.target.checked)}
              label={DEVICE_SCOPE_LABELS[scope].label}
              description={DEVICE_SCOPE_LABELS[scope].description}
            />
          ))}
        </div>
      </fieldset>
      {patch.error ? <ErrorNotice className="mt-2" title="Couldn't save" error={patch.error} /> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-ink text-sub" role="status">
              Remove {device.name}? Its key stops working at once.
            </span>
            <Button
              variant="danger"
              loading={revoke.isPending}
              onClick={() =>
                revoke.mutate(device.id, { onSuccess: () => toast.success(`${device.name} removed`) })
              }
            >
              Remove phone
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button onClick={() => setConfirming(true)}>Revoke</Button>
        )}
      </div>
    </li>
  );
}

function NeverFromAPhone({ info }: { info: PhoneInfo }) {
  return (
    <section aria-labelledby="phone-never">
      <h3 id="phone-never" className="font-semibold text-body text-ink">
        What a phone can never do
      </h3>
      <p className="mt-1 text-ink-2 text-sub">
        These come with Steward and can't be switched off. A phone can always refuse.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {info.presets.map((p) => (
          <li key={p.id} className="flex items-start gap-3 rounded-field bg-tile px-3 py-2">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-2" />
            <div>
              <p className="font-medium text-ink text-sub">{p.name}</p>
              <p className="text-caption text-ink-2">{p.description}</p>
            </div>
          </li>
        ))}
        <li className="flex items-start gap-3 rounded-field bg-tile px-3 py-2">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-2" />
          <div>
            <p className="font-medium text-ink text-sub">
              Rules, settings, connections and the computer stay here
            </p>
            <p className="text-caption text-ink-2">
              A phone can't change what Steward may do, add connections, see secrets, run commands or use the
              computer. Always allow is chosen on your Mac.
            </p>
          </div>
        </li>
      </ul>
    </section>
  );
}
