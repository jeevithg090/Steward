// "Add another device": a one-time QR code (2 minutes), the same link to copy, then the 6-digit
// code both screens show. Nothing joins until the person says the codes match.
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, QrCode, RefreshCw } from "lucide-react";
import { Button, Card, SectionTitle, Spinner, toast } from "@/components/ui";
import type { MeshClient } from "@/lib/mesh";
import { BigCode, clock, step, useSecondsLeft } from "./parts";

interface Pairing {
  pairing_id: string;
  link: string;
  qr_svg: string;
  expires_at: string;
}

interface Claimed {
  code: string;
  device_name: string | null;
}

/** segno's inline SVG has a fixed size and no viewBox; give it one so it can scale up for the camera. */
function scalable(svg: string): string {
  return svg.replace(/<svg width="(\d+)" height="(\d+)"/, '<svg viewBox="0 0 $1 $2" width="$1" height="$2" aria-hidden="true" focusable="false"');
}

export function PairDevice({ mesh, onChanged, pollMs = 1500 }: { mesh: MeshClient; onChanged: () => Promise<void> | void; pollMs?: number }) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [claimed, setClaimed] = useState<Claimed | null>(null);
  const [busy, setBusy] = useState<"start" | "confirm" | "cancel" | null>(null);
  const left = useSecondsLeft(pairing && !claimed ? pairing.expires_at : null);
  const expired = left === 0;
  const live = useRef(true);
  useEffect(() => {
    live.current = true; // StrictMode mounts twice: set it again on the second mount
    return () => {
      live.current = false;
    };
  }, []);

  // Wait for the other device to open the link, every pollMs, until it does or the code runs out.
  useEffect(() => {
    if (!pairing || claimed || expired) return;
    const timer = setInterval(async () => {
      const status = await mesh.pairingStatus(pairing.pairing_id).catch(() => null);
      if (live.current && status?.claimed && status.code) setClaimed({ code: status.code, device_name: status.device_name });
    }, pollMs);
    return () => clearInterval(timer);
  }, [mesh, pairing, claimed, expired, pollMs]);

  const start = useCallback(async () => {
    setBusy("start");
    setClaimed(null);
    await step(async () => setPairing(await mesh.startPairing())); // the QR code itself is the confirmation
    setBusy(null);
  }, [mesh]);

  const confirm = async () => {
    if (!pairing || !claimed) return;
    setBusy("confirm");
    const ok = await step(() => mesh.confirmPairing(pairing.pairing_id), `${claimed.device_name ?? "Your other device"} is added.`);
    setBusy(null);
    if (ok) {
      setPairing(null);
      setClaimed(null);
      await onChanged();
    }
  };

  const cancel = async () => {
    const name = claimed?.device_name;
    setBusy("cancel");
    if (name) {
      // The codes didn't match: whoever opened the link stays out. Remove the device it made.
      const waiting = (await mesh.devices().catch(() => [])).filter((d) => !d.active && d.name === name);
      for (const d of waiting) await mesh.remove(d.id).catch(() => undefined);
      toast.info(`Not added. ${name} can't do anything for you.`);
    } else {
      toast.info("Cancelled. The code no longer matters.");
    }
    setBusy(null);
    setPairing(null);
    setClaimed(null);
    await onChanged();
  };

  const copy = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.link);
      toast.success("Link copied. Open it on the other device.");
    } catch {
      toast.error("I couldn't copy it. Select the link and copy it by hand.");
    }
  };

  return (
    <Card as="section" aria-labelledby="pair-heading" className="space-y-3">
      <SectionTitle id="pair-heading">Add another device</SectionTitle>
      {!pairing && (
        <>
          <p className="text-sm text-slate-300">
            Show a code here, then scan it with your other phone or laptop. Both screens will show the same six numbers, and you say yes here.
          </p>
          <Button variant="primary" busy={busy === "start"} icon={<QrCode size={16} aria-hidden />} onClick={() => void start()}>
            Add another device
          </Button>
        </>
      )}

      {pairing && !claimed && !expired && (
        <div className="space-y-3">
          <p className="text-sm text-slate-200">Scan this with your other device&apos;s camera.</p>
          <div
            role="img"
            aria-label="QR code for adding your other device. Scan it with that device's camera, or open the link below on it."
            className="w-fit rounded-2xl bg-white p-3 [&_svg]:h-48 [&_svg]:w-48"
            dangerouslySetInnerHTML={{ __html: scalable(pairing.qr_svg) }}
          />
          <div>
            <p className="text-xs text-slate-400">Or open this link on the other device:</p>
            <p className="mt-1 break-all rounded-xl bg-black/40 px-3 py-2 font-mono text-xs text-slate-200" data-testid="pairing-link">
              {pairing.link}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button variant="quiet" size="sm" icon={<Copy size={14} aria-hidden />} onClick={() => void copy()}>
                Copy link
              </Button>
              <span className="text-xs text-slate-400">{left !== null && <>Works for {clock(left)} more. One use only.</>}</span>
            </div>
          </div>
          <Spinner label="Waiting for your other device" />
        </div>
      )}

      {pairing && !claimed && expired && (
        <div className="space-y-2" role="status">
          <p className="text-sm text-amber-200">That code has run out. Codes last two minutes, so nobody can use an old one.</p>
          <Button variant="primary" size="sm" busy={busy === "start"} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void start()}>
            Make a new code
          </Button>
        </div>
      )}

      {pairing && claimed && (
        <div className="space-y-3" role="status" aria-live="polite">
          <p className="text-sm text-slate-200">
            <span className="font-semibold">{claimed.device_name ?? "Your other device"}</span> wants to join. Do both screens show the same code?
          </p>
          <BigCode code={claimed.code} />
          <div className="flex flex-wrap gap-2">
            <Button variant="ok" busy={busy === "confirm"} disabled={busy === "cancel"} onClick={() => void confirm()}>
              Yes, the codes match
            </Button>
            <Button variant="quiet" busy={busy === "cancel"} disabled={busy === "confirm"} onClick={() => void cancel()}>
              No, cancel
            </Button>
          </div>
          <p className="text-xs text-slate-400">If the numbers differ, press No: someone else may have opened the link.</p>
        </div>
      )}
    </Card>
  );
}
