// Test doubles for Tempo Mesh: a real MeshClient over an in-memory store, a fake authenticator
// (WebAuthn) and a routed fake fetch, so tests exercise the client's own requests.
import { type Authenticator, type DeviceInfo, DEVICE_ID_KEY, DEVICE_KEY, MeshClient } from "@/lib/mesh";

export const CONFIG = { url: "http://gw.test", token: "owner" };

export class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

const buf = (...bytes: number[]) => new Uint8Array(bytes).buffer;

export class FakeAuthenticator implements Authenticator {
  created = 0;
  requests: CredentialRequestOptions[] = [];
  async create(): Promise<Credential> {
    this.created += 1;
    return {
      id: "cred",
      type: "public-key",
      rawId: buf(1, 2),
      response: { clientDataJSON: buf(3), attestationObject: buf(4) },
      getClientExtensionResults: () => ({}),
    } as unknown as Credential;
  }
  async get(options: CredentialRequestOptions): Promise<Credential> {
    this.requests.push(options);
    return {
      id: "cred",
      type: "public-key",
      rawId: buf(1, 2),
      response: { clientDataJSON: buf(5), authenticatorData: buf(6), signature: buf(7), userHandle: null },
      getClientExtensionResults: () => ({}),
    } as unknown as Credential;
  }
}

export interface Call {
  url: string;
  init: RequestInit;
}

/** A route's answer: a body (200), or a function of the call returning [status, body]. */
export type Route = unknown | ((call: Call) => [number, unknown]);

/** Keys are "METHOD path" with the Gateway's address removed, e.g. "GET /mesh/devices". */
export function fakeFetch(routes: Record<string, Route>, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit = {}) => {
    const call = { url, init };
    calls.push(call);
    const key = `${init.method ?? "GET"} ${url.replace(CONFIG.url, "")}`;
    if (!(key in routes)) return new Response(JSON.stringify({ detail: `no route ${key}` }), { status: 404 });
    const route = routes[key];
    const [status, body] = typeof route === "function" ? (route as (c: Call) => [number, unknown])(call) : [200, route];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

export function device(over: Partial<DeviceInfo> = {}): DeviceInfo {
  return { id: "d_1", name: "Safari on iPhone", capabilities: ["approve.biometric"], active: true, passkey: false, push: false, last_active: "2026-10-25T05:00:00+00:00", ...over };
}

/** A MeshClient as a browser that is already device `id` (or not a device at all, with `id` null). */
export function fakeMesh(routes: Record<string, Route>, { id = "d_1" as string | null, calls = [] as Call[], authenticator = new FakeAuthenticator() } = {}) {
  const storage = new MemoryStorage();
  if (id) {
    storage.setItem(DEVICE_KEY, `token-${id}`);
    storage.setItem(DEVICE_ID_KEY, id);
  }
  const mesh = new MeshClient(CONFIG, storage, authenticator, fakeFetch(routes, calls));
  return { mesh, storage, calls, authenticator };
}
