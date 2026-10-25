// Devices (plan.md §12, Tempo Mesh): make this browser one of the person's devices, add Face ID or
// a fingerprint so each yes is signed here, pair another device by QR code and a 6-digit code,
// remove a lost one, and turn on notifications that say only "sync". `/pair` (the QR link) shows
// the Join view on the new device. The Gateway checks every signature.
import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, MonitorSmartphone, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageTitle, SectionTitle, SkeletonCards } from "@/components/ui";
import { type DeviceInfo, meshWords } from "@/lib/mesh";
import { useMesh } from "@/lib/mesh-context";
import type { PageProps } from "@/types/page";
import { DeviceList } from "./DeviceList";
import { friendlyName } from "./deviceName";
import { JoinDevice, NOT_SECURE } from "./JoinDevice";
import { NotificationsCard } from "./NotificationsCard";
import { PairDevice } from "./PairDevice";
import { LinkButton, step } from "./parts";

type Problem = { kind: "unpaired" | "pending" | "unreachable" | "other"; text: string };

function problemOf(err: unknown): Problem {
  const text = meshWords(err);
  if (/isn't paired/i.test(text)) return { kind: "unpaired", text };
  if (/confirm the pairing code/i.test(text)) return { kind: "pending", text };
  if (/can't reach/i.test(text)) return { kind: "unreachable", text };
  return { kind: "other", text };
}

function onPairRoute(): boolean {
  return typeof window !== "undefined" && /^#\/?pair\b/.test(window.location.hash);
}

export default function DevicesPage({ user, showcase, params, pollMs = 1500 }: PageProps & { pollMs?: number }) {
  const { mesh, refresh, canPasskey, showcase: meshShowcase } = useMesh();
  const joining = Boolean(params.link) || onPairRoute();
  const lede = joining ? "Add this device to your Tempo." : "Your phone and laptop, and Face ID for approvals. Every yes is signed on the device you hold.";

  if (showcase || meshShowcase) {
    return (
      <div>
        <PageTitle lede={lede}>Devices</PageTitle>
        <EmptyState
          title="Pairing needs a running Gateway"
          icon={<MonitorSmartphone size={28} aria-hidden />}
          action={
            <LinkButton to="/settings" icon={<SettingsIcon size={14} aria-hidden />}>
              Open Settings
            </LinkButton>
          }
        >
          This is the showcase: recorded replies, no Gateway. A device can&apos;t be paired or sign with Face ID here. Run Tempo locally (<code>make demo</code>), switch the
          showcase off in Settings, and come back to pair your phone.
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageTitle lede={lede}>Devices</PageTitle>
      {joining ? (
        <div className="max-w-xl">
          <JoinDevice mesh={mesh} link={params.link ?? null} canPasskey={canPasskey} onJoined={refresh} pollMs={pollMs} />
        </div>
      ) : (
        <MyDevices userId={user.id} pollMs={pollMs} />
      )}
    </div>
  );
}

function MyDevices({ userId, pollMs }: { userId: string; pollMs: number }) {
  const { mesh, refresh, canPasskey } = useMesh();
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"register" | "passkey" | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true; // StrictMode mounts twice: set it again on the second mount
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!mesh.token) {
      setDevices(null);
      setProblem(null);
    } else {
      try {
        const found = await mesh.devices();
        if (!live.current) return;
        setDevices(found);
        setProblem(null);
      } catch (e) {
        if (!live.current) return;
        setDevices(null);
        setProblem(problemOf(e));
      }
    }
    setLoaded(true);
    void refresh(); // the rest of the app (the chat, Mission Control) learns whether this device signs
  }, [mesh, refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  const register = async () => {
    setBusy("register");
    await step(() => mesh.registerThisDevice(userId, friendlyName()), "This browser is now one of your devices. Next, add Face ID.");
    setBusy(null);
    await load();
  };

  const addPasskey = async () => {
    setBusy("passkey");
    await step(() => mesh.addPasskey(), "Face ID is on for approvals.");
    setBusy(null);
    await load();
  };

  const remove = async (device: DeviceInfo) => {
    const ok = await step(() => mesh.remove(device.id), `${device.name} is removed.`);
    if (ok) await load();
    return ok;
  };

  if (!loaded) return <SkeletonCards count={2} label="Loading your devices" />;

  // A device that joined by QR code but whose code hasn't been confirmed on the other screen yet.
  if (problem?.kind === "pending") {
    return (
      <Card as="section" aria-labelledby="pending-heading" tone="amber" className="max-w-xl space-y-3">
        <SectionTitle id="pending-heading">Waiting for your other device</SectionTitle>
        <p className="text-sm text-amber-100">
          This browser has joined, but the code hasn&apos;t been confirmed yet. On your other device, press &quot;Yes, the codes match&quot;.
        </p>
        <Button variant="quiet" size="sm" onClick={() => void load()}>
          Check again
        </Button>
      </Card>
    );
  }

  if (problem?.kind === "unreachable" || problem?.kind === "other") {
    return (
      <EmptyState
        title="Your devices didn't load"
        tone="error"
        action={
          <Button variant="quiet" onClick={() => void load()}>
            Try again
          </Button>
        }
      >
        {problem.text}
      </EmptyState>
    );
  }

  const me = devices?.find((d) => d.id === mesh.deviceId) ?? null;

  if (!devices || !me) {
    return (
      <Card as="section" aria-labelledby="register-heading" tone="indigo" className="max-w-2xl space-y-3">
        <SectionTitle id="register-heading">This browser</SectionTitle>
        <p className="text-sm text-slate-100">
          Tempo asks before it does anything that matters. Make this browser one of your devices, then add Face ID or a fingerprint, so each yes is signed on the device in your
          hand.
        </p>
        {problem?.kind === "unpaired" && (
          <p role="status" className="text-xs text-amber-200">
            The Gateway doesn&apos;t know this browser any more (it was removed, or the Gateway started again without its device list). Set it up again below.
          </p>
        )}
        <Button variant="primary" size="lg" busy={busy === "register"} icon={<MonitorSmartphone size={18} aria-hidden />} onClick={() => void register()}>
          Use this browser for approvals
        </Button>
        <p className="text-xs text-slate-400">It will be called &quot;{friendlyName()}&quot;. Joining from another device&apos;s QR code instead? Open the link it shows.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card as="section" aria-labelledby="this-device-heading" tone={me.passkey ? "emerald" : "indigo"} className="space-y-3">
        <SectionTitle id="this-device-heading" right={me.passkey ? <Badge tone="emerald">Face ID on</Badge> : <Badge tone="amber">no Face ID yet</Badge>}>
          This browser: {me.name}
        </SectionTitle>
        {me.passkey ? (
          <p className="flex items-start gap-2 text-sm text-emerald-100">
            <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0" />
            Your answers from here are signed with Face ID or your fingerprint. From now on Tempo only accepts a signed yes for you, from one of your devices.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-100">
              Add Face ID, Touch ID, a fingerprint or Windows Hello. Each yes or no is then signed on this device; the fingerprint never leaves it, and Tempo keeps only a public
              key.
            </p>
            <Button variant="primary" size="lg" busy={busy === "passkey"} disabled={!canPasskey} icon={<Fingerprint size={18} aria-hidden />} onClick={() => void addPasskey()}>
              Add Face ID or fingerprint
            </Button>
            <p className={`text-xs ${canPasskey ? "text-slate-400" : "text-amber-200"}`}>
              {canPasskey ? "Passkeys (WebAuthn) only work on a secure page: localhost or https. This one is." : NOT_SECURE}
            </p>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <DeviceList devices={devices} thisId={mesh.deviceId} onRemove={remove} />
        <PairDevice mesh={mesh} onChanged={load} pollMs={pollMs} />
      </div>

      <NotificationsCard mesh={mesh} on={me.push} onChanged={load} />
    </div>
  );
}
