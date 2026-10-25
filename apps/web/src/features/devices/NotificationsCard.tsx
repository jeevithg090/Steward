// Notifications: Web Push that wakes this device when Tempo needs an answer. A push only ever
// says "sync"; the details come over the device's own session. Honest when the Gateway has no
// VAPID key, or the browser can't or won't.
import { useEffect, useState } from "react";
import { BellRing, Info } from "lucide-react";
import { Card, SectionTitle, Switch, toast } from "@/components/ui";
import { type MeshClient, meshWords } from "@/lib/mesh";

export const NO_VAPID = "This Gateway has no Web Push key (VAPID), so it can't wake this device. While Tempo is open, its questions still appear here straight away.";

function whyNot(): string {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "This browser can't receive push messages. On an iPhone, add Tempo to the Home Screen first.";
  }
  if (typeof Notification !== "undefined" && Notification.permission === "denied") {
    return "Notifications are blocked for this site. Allow them in the browser's site settings, then try again.";
  }
  return "Notifications weren't allowed, so this device won't be woken.";
}

export function NotificationsCard({ mesh, on, onChanged }: { mesh: MeshClient; on: boolean; onChanged: () => Promise<void> | void }) {
  const [vapid, setVapid] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    mesh
      .meshConfig()
      .then((c) => live && setVapid(c.vapid_public_key))
      .catch(() => live && setVapid(undefined));
    return () => {
      live = false;
    };
  }, [mesh]);

  const noKey = vapid === null;

  const toggle = async (want: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      if (want) {
        if (await mesh.enablePush()) {
          toast.success("Notifications are on. A push only ever says “sync”.");
        } else {
          const why = noKey ? NO_VAPID : whyNot();
          setNote(why);
          toast.info(why);
        }
      } else {
        await mesh.disablePush();
        toast.success("Notifications are off for this device.");
      }
      await onChanged();
    } catch (e) {
      toast.error(meshWords(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="notify-heading">
      <SectionTitle id="notify-heading">Notifications</SectionTitle>
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.06] bg-black/20 px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200 ring-1 ring-inset ring-violet-400/25">
            <BellRing size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Wake this device when Tempo needs an answer</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">A push says only &quot;sync&quot;: no names, no amounts, no companies. This device then asks Tempo for the details itself.</p>
          </div>
        </div>
        <Switch checked={on} disabled={busy || (noKey && !on)} onChange={(v) => void toggle(v)} label="Wake this device when Tempo needs an answer" />
      </div>
      {noKey && !on && (
        <p className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-amber-100">
          <Info size={14} aria-hidden className="mt-px shrink-0 text-amber-300" />
          <span>{NO_VAPID}</span>
        </p>
      )}
      {note && !noKey && (
        <p role="status" className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-amber-100">
          {note}
        </p>
      )}
    </Card>
  );
}
