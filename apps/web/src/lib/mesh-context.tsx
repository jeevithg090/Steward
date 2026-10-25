// Tempo Mesh in the app (plan.md §12.3): one MeshClient for the whole app, this person's devices,
// and whether this device signs approvals with a passkey. The chat, Mission Control and the
// Devices page read it with useMesh(); App.tsx mounts <MeshProvider>.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GatewayConfig } from "./config";
import { type DeviceInfo, MeshClient } from "./mesh";
import { ShowcaseMesh } from "./showcase";

export interface MeshState {
  mesh: MeshClient;
  /** This person's devices, or null when this browser is not a device yet (or the call failed). */
  devices: DeviceInfo[] | null;
  /** This browser is a device and holds a passkey: yes/no answers and mandates are signed here. */
  signs: boolean;
  /** WebAuthn is available in this browser (a secure context with navigator.credentials). */
  canPasskey: boolean;
  showcase: boolean;
  refresh: () => Promise<void>;
}

const MeshContext = createContext<MeshState | null>(null);

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function browserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    window.localStorage.getItem("tempo.probe");
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

function browserCanPasskey(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof navigator !== "undefined" && "credentials" in navigator && "PublicKeyCredential" in window;
}

export interface MeshProviderProps {
  config: GatewayConfig;
  showcase: boolean;
  children: ReactNode;
  /** A ready-made client (tests, or a host app with its own storage). */
  client?: MeshClient;
  /** Override WebAuthn detection (tests: jsdom has no WebAuthn). */
  canPasskey?: boolean;
}

export function MeshProvider({ config, showcase, children, client, canPasskey: canPasskeyOverride }: MeshProviderProps) {
  const mesh = useMemo<MeshClient>(() => client ?? (showcase ? new ShowcaseMesh() : new MeshClient(config, browserStorage())), [client, config, showcase]);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const canPasskey = canPasskeyOverride ?? browserCanPasskey();

  const refresh = useCallback(async () => {
    if (!mesh.token) {
      setDevices(null);
      return;
    }
    try {
      setDevices(await mesh.devices());
    } catch {
      setDevices(null);
    }
  }, [mesh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signs = Boolean(mesh.deviceId && devices?.find((d) => d.id === mesh.deviceId)?.passkey);
  const value = useMemo<MeshState>(() => ({ mesh, devices, signs, canPasskey, showcase, refresh }), [mesh, devices, signs, canPasskey, showcase, refresh]);
  return <MeshContext.Provider value={value}>{children}</MeshContext.Provider>;
}

let outside: MeshState | null = null;

/** The app's Mesh state. Outside a provider (tests), one showcase Mesh that signs nothing. */
export function useMesh(): MeshState {
  const value = useContext(MeshContext);
  if (value) return value;
  outside ??= { mesh: new ShowcaseMesh(), devices: null, signs: false, canPasskey: false, showcase: true, refresh: async () => {} };
  return outside;
}
