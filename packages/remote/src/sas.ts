import { concat, fromBase64, sha256 } from "./bytes.ts";

/**
 * The confirmation code shown on both screens while pairing ("Pair 'iPhone'? Code 482 913"). It is
 * computed on each side from the one-time key and the phone's own keys, so a relay that swapped the
 * phone's keys for its own would show a different code: the person sees them differ and cancels.
 * Happy has no such step (docs/research/happy.md §3).
 */
export async function confirmationCode(
  ephemeralPublicKey: string,
  boxKey: string,
  signKey: string,
): Promise<string> {
  const digest = await sha256(
    concat(fromBase64(ephemeralPublicKey), fromBase64(boxKey), fromBase64(signKey)),
  );
  const n = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  const code = String(n % 1_000_000).padStart(6, "0");
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
