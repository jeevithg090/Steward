// "Join": this browser was opened from another device's QR code. Name it, join, compare the code,
// wait for the yes on the other screen, then add Face ID here.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Fingerprint, Smartphone } from "lucide-react";
import { Button, Card, SectionTitle, Spinner, toast } from "@/components/ui";
import { type MeshClient, meshWords } from "@/lib/mesh";
import { friendlyName } from "./deviceName";
import { BigCode, LinkButton, step } from "./parts";

type Stage = "name" | "code" | "confirmed" | "done";

export const NOT_SECURE = "This page isn't secure, so this browser can't make a passkey. Face ID needs Tempo on localhost or over https.";

export function JoinDevice({
  mesh,
  link,
  canPasskey,
  onJoined,
  pollMs = 1500,
}: {
  mesh: MeshClient;
  link: string | null;
  canPasskey: boolean;
  onJoined: () => Promise<void> | void;
  pollMs?: number;
}) {
  const [name, setName] = useState(() => friendlyName());
  const [stage, setStage] = useState<Stage>("name");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const live = useRef(true);
  useEffect(() => {
    live.current = true; // StrictMode mounts twice: set it again on the second mount
    return () => {
      live.current = false;
    };
  }, []);

  // After joining, wait for the other device's "Yes, the codes match": until then this device's
  // calls are refused (403), then the device list loads.
  useEffect(() => {
    if (stage !== "code") return;
    const timer = setInterval(async () => {
      try {
        await mesh.devices();
        if (!live.current) return;
        setStage("confirmed");
        toast.success("Your other device said yes. This device is in.");
        await onJoined();
      } catch {
        /* not confirmed yet */
      }
    }, pollMs);
    return () => clearInterval(timer);
  }, [stage, mesh, onJoined, pollMs]);

  if (!link) {
    return (
      <Card as="section" aria-labelledby="join-heading" className="space-y-3">
        <SectionTitle id="join-heading">Join from a QR code</SectionTitle>
        <p className="text-sm text-slate-300">
          On a device that already uses Tempo, open Devices and press &quot;Add another device&quot;. Scan the QR code with this device&apos;s camera, or open the link it shows.
        </p>
        <LinkButton to="/devices" icon={<Smartphone size={14} aria-hidden />}>
          Open Devices
        </LinkButton>
      </Card>
    );
  }

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const got = await mesh.claim(link, name.trim() || friendlyName());
      setCode(got);
      setStage("code");
      toast.success("Joined. Now compare the code on both screens.");
      // The link's one-time secret is spent; take it out of the address bar and history.
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/pair`);
      } catch {
        /* not in a browser */
      }
    } catch (err) {
      const words = meshWords(err);
      setError(words);
      toast.error(words);
    } finally {
      setBusy(false);
    }
  };

  const addFaceId = async () => {
    setBusy(true);
    const ok = await step(() => mesh.addPasskey(), "Face ID is on. You can answer Tempo on this device.");
    setBusy(false);
    if (ok) {
      setStage("done");
      await onJoined();
    }
  };

  return (
    <Card as="section" aria-labelledby="join-heading" tone="indigo" className="space-y-3">
      <SectionTitle id="join-heading">Add this device to Tempo</SectionTitle>

      {stage === "name" && (
        <form className="space-y-3" onSubmit={(e) => void join(e)}>
          <div>
            <label htmlFor={inputId} className="block text-sm text-slate-200">
              What should Tempo call this device?
            </label>
            <input
              id={inputId}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full max-w-sm rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
            Join
          </Button>
          {error && (
            <p role="alert" className="text-sm text-rose-200">
              {error} {/already used|expired|isn't valid/i.test(error) ? "Ask your other device for a new code." : ""}
            </p>
          )}
        </form>
      )}

      {stage === "code" && code && (
        <div className="space-y-3" role="status">
          <p className="text-sm text-slate-200">Your code is</p>
          <BigCode code={code} />
          <p className="text-sm text-slate-300">Check your other screen shows the same numbers, then press &quot;Yes, the codes match&quot; there.</p>
          <Spinner label="Waiting for your other device to say yes" />
        </div>
      )}

      {stage === "confirmed" && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-emerald-200" role="status">
            <CheckCircle2 size={16} aria-hidden /> This device is in.
          </p>
          <p className="text-sm text-slate-300">Now add Face ID or your fingerprint, so a yes from this device is signed here.</p>
          <Button variant="primary" busy={busy} disabled={!canPasskey} icon={<Fingerprint size={16} aria-hidden />} onClick={() => void addFaceId()}>
            Now add Face ID
          </Button>
          {!canPasskey && <p className="text-xs text-amber-200">{NOT_SECURE}</p>}
        </div>
      )}

      {stage === "done" && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-emerald-200" role="status">
            <CheckCircle2 size={16} aria-hidden /> Face ID is on for this device.
          </p>
          <LinkButton to="/devices" icon={<Smartphone size={14} aria-hidden />}>
            See your devices
          </LinkButton>
        </div>
      )}
    </Card>
  );
}
