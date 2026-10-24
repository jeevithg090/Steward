"use client";

import { useCallback, useEffect, useState } from "react";
import { type DeviceInfo, type MeshClient, formatCode } from "@/lib/mesh";

interface Pairing {
  pairing_id: string;
  link: string;
  qr_svg: string;
  code: string | null;
  device_name: string | null;
}

/** Tempo Mesh v0: this person's devices, Face ID for approvals, and adding a device by QR code. */
export function DevicePanel({
  mesh, userId, onChange, pollMs = 1000,
}: { mesh: MeshClient; userId: string; onChange?: (devices: DeviceInfo[]) => void; pollMs?: number }) {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!mesh.token) return setDevices(null);
    try {
      const found = await mesh.devices();
      setDevices(found);
      onChange?.(found);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }, [mesh, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pairing || pairing.code) return;
    const timer = setInterval(async () => {
      const status = await mesh.pairingStatus(pairing.pairing_id).catch(() => null);
      if (status?.claimed) setPairing({ ...pairing, code: status.code, device_name: status.device_name });
    }, pollMs);
    return () => clearInterval(timer);
  }, [mesh, pairing, pollMs]);

  const step = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      setNote(done ?? null);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  const me = devices?.find((d) => d.id === mesh.deviceId);

  return (
    <section aria-labelledby="devices-heading" className="rounded-xl border-2 border-slate-200 bg-white p-4">
      <h2 id="devices-heading" className="mb-2 text-lg font-semibold">Your devices</h2>
      {devices === null ? (
        <button type="button" onClick={() => step(() => mesh.registerThisDevice(userId, "This browser"))}
          className="rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white">
          Use this device for approvals
        </button>
      ) : (
        <>
          <ul className="space-y-1">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{d.name}</span>
                  {d.id === mesh.deviceId ? " (this one)" : ""}
                  <span className="block text-sm text-slate-700">
                    {d.passkey ? "Face ID or fingerprint" : "No passkey yet"} · {d.push ? "notifications on" : "no notifications"}
                  </span>
                </span>
                {d.id !== mesh.deviceId && (
                  <button type="button" onClick={() => step(() => mesh.remove(d.id), `${d.name} removed.`)}
                    aria-label={`Remove ${d.name}`} className="text-sm text-rose-800 underline">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {me && !me.passkey && (
              <button type="button" onClick={() => step(() => mesh.addPasskey(), "Face ID is on for approvals.")}
                className="rounded-lg bg-teal-800 px-3 py-2 font-semibold text-white">
                Add Face ID or fingerprint
              </button>
            )}
            {me && !me.push && (
              <button type="button" onClick={() => step(async () => {
                if (!(await mesh.enablePush())) throw new Error("Notifications aren't available here.");
              }, "Notifications are on.")} className="rounded-lg border-2 border-slate-800 px-3 py-2 font-semibold">
                Turn on notifications
              </button>
            )}
            <button type="button" onClick={() => step(async () => setPairing({ ...(await mesh.startPairing()), code: null, device_name: null }))}
              className="rounded-lg border-2 border-slate-800 px-3 py-2 font-semibold">
              Add another device
            </button>
          </div>
        </>
      )}

      {pairing && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3" aria-live="polite">
          {pairing.code === null ? (
            <>
              <p>Scan this with your other device&apos;s camera. It works for 2 minutes.</p>
              <div aria-label="Pairing QR code" role="img" className="my-2 w-fit bg-white"
                dangerouslySetInnerHTML={{ __html: pairing.qr_svg }} />
              <p className="break-all text-xs text-slate-700">{pairing.link}</p>
            </>
          ) : (
            <>
              <p>
                Does {pairing.device_name ?? "your other device"} show{" "}
                <strong className="font-mono text-xl">{formatCode(pairing.code)}</strong>?
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => step(async () => {
                  await mesh.confirmPairing(pairing.pairing_id);
                  setPairing(null);
                }, "Device added.")} className="rounded-lg bg-teal-800 px-3 py-2 font-semibold text-white">
                  Yes, the codes match
                </button>
                <button type="button" onClick={() => setPairing(null)} className="rounded-lg border-2 border-slate-800 px-3 py-2">
                  No
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {note && <p role="status" className="mt-2 text-sm">{note}</p>}
    </section>
  );
}

/** On the new device, opened from the QR code: join, then compare the code. */
export function JoinMesh({ mesh, link }: { mesh: MeshClient; link: string }) {
  const [name, setName] = useState("My phone");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="join-heading" className="mx-auto mt-6 max-w-md rounded-xl border-4 border-teal-700 bg-white p-4">
      <h2 id="join-heading" className="text-xl font-semibold">Add this device to Tempo</h2>
      {code === null ? (
        <form className="mt-3 space-y-2" onSubmit={async (e) => {
          e.preventDefault();
          try {
            setCode(await mesh.claim(link, name));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}>
          <label htmlFor="device-name" className="block">What should Tempo call this device?</label>
          <input id="device-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border-2 px-2 py-1" />
          <button type="submit" className="rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white">Join</button>
        </form>
      ) : (
        <p className="mt-3 text-lg">
          Check your other device shows <strong className="font-mono text-2xl">{formatCode(code)}</strong>, then
          press &quot;Yes, the codes match&quot; there.
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-rose-800">{error}</p>}
    </section>
  );
}
